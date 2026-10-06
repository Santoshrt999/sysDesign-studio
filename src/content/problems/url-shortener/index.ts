import type { Problem } from "../../types";

/**
 * URL Shortener (TinyURL / bit.ly)
 *
 * Narrative spine: this is a READ-dominated, KEY-VALUE-shaped, IMMUTABLE-mapping system.
 * Almost every decision follows from those three facts:
 *  - read-dominated  -> the redirect path is the product; cache/CDN carry it
 *  - key-value shape -> no joins, partition by short code, a distributed KV store fits
 *  - immutable       -> caching has (almost) no invalidation problem
 * The interesting engineering is in ID generation (unique, short, non-guessable, no hot coordination)
 * and in surviving skew (viral links) and failures (cache node loss, region loss).
 */
export const urlShortener: Problem = {
  slug: "url-shortener",
  title: "URL Shortener",
  tagline: "TinyURL / bit.ly — a read-heavy key-value system where ID generation is the hard part",
  difficulty: "Medium",

  // ───────────────────────────── Stage 1 — Understand ─────────────────────────────
  interviewQuestion:
    "Design a URL shortening service like TinyURL. Users paste a long URL and get back a short link; anyone clicking the short link is redirected to the original.",

  clarifyingQuestions: [
    {
      question: "Roughly how many new short links are created per day?",
      whyItMatters:
        "Write volume sets the size of the keyspace (how many characters the code needs), the total storage over the retention period, and whether a single database can ever be enough.",
      answer: "About 100 million new links per day.",
      designImpact:
        "100M/day × 5 years ≈ 180B links. That forces 7-character codes and tens of terabytes of storage, so we know up front that the data will not stay on one machine.",
    },
    {
      question: "What's the read-to-write ratio? How often is a link clicked compared to created?",
      whyItMatters:
        "It tells you which path to optimise. In a read-heavy system the redirect is the product and its latency and availability matter most.",
      answer: "Around 100:1. Most links are clicked rarely, but a small share go viral.",
      designImpact:
        "The read path becomes the centre of the design: caching, a CDN, and a data layout tuned for point lookups. The 'small share go viral' part warns us early about hot keys.",
    },
    {
      question: "If the same long URL is shortened twice, should it return the same short code?",
      whyItMatters:
        "Deduplication needs a lookup by long URL on every write. That means a second, very large index on a column of up to 2 KB, and it ties ID generation to the content.",
      answer: "No. Each request can get a new code. Different users may want separate links.",
      designImpact:
        "No index on long_url and no read-before-write. The write path becomes a pure insert, and ID generation is free to ignore the URL entirely.",
    },
    {
      question: "Do links expire? How long must we keep them?",
      whyItMatters:
        "Retention bounds total storage, and expiry adds a cleanup mechanism plus a check on the read path.",
      answer: "Optional expiry per link; otherwise we keep links for 5 years.",
      designImpact:
        "We size storage for 5 years. Expiry uses the store's native TTL plus an expires_at check on read, because TTL deletion is lazy.",
    },
    {
      question: "Is it acceptable if short codes are guessable or sequential?",
      whyItMatters:
        "Sequential codes let anyone enumerate every link (aZ3k9Qa, aZ3k9Qb, …). People shorten private docs and pre-signed URLs, so this is a privacy leak.",
      answer: "They should not be trivially enumerable.",
      designImpact:
        "A raw auto-increment counter can't be exposed. We either use randomness or scramble a counter with a reversible permutation. This one constraint drives the ID-generation deep dive.",
    },
    {
      question: "Do we need click analytics?",
      whyItMatters:
        "It decides between HTTP 301 and 302. A 301 is cached by browsers forever, which cuts our traffic but means we never see repeat clicks and can't expire or take down a link for that browser.",
      answer: "Not in v1, but the business will almost certainly want it later.",
      designImpact:
        "Use 302 so every click passes through infrastructure we control (our CDN plus origin). That keeps analytics, expiry and takedown possible, and we pay for it in read QPS.",
    },
    {
      question: "Are users global, or concentrated in one region?",
      whyItMatters:
        "A cross-ocean round trip costs 150–250 ms, which alone breaks a 'fast redirect' goal, and a single region is a single point of failure.",
      answer: "Global.",
      designImpact:
        "Redirects must be served near the user (CDN edge plus multi-region reads). Multi-region writes then raise questions about ID uniqueness and replication lag.",
    },
    {
      question: "Custom aliases (tinyurl.com/my-launch)?",
      whyItMatters:
        "Custom aliases share a namespace with generated codes, so they need a uniqueness check and conflict handling that generated IDs otherwise avoid.",
      answer: "Not for now. Treat it as a follow-up.",
      designImpact:
        "Keep it out of v1, but don't make choices that rule it out. It comes back as a follow-up question.",
    },
  ],

  requirements: {
    functional: [
      "Create: given a long URL (and optional expiry), return a unique short URL.",
      "Redirect: GET /{code} responds with an HTTP 302 to the original URL.",
      "Expired or taken-down links return 404/410, not a redirect.",
    ],
    nonFunctional: [
      {
        name: "Redirect latency",
        target: "p99 < 50 ms server-side; < 100 ms end-to-end for most users",
        why: "Redirects sit in front of every click, so any latency we add is latency the user feels.",
      },
      {
        name: "Availability (reads)",
        target: "99.99%",
        why: "Short links are embedded across the internet. If redirects go down, millions of links in emails and docs break at once.",
      },
      {
        name: "Availability (writes)",
        target: "99.9%",
        why: "A failed create is visible to one user, who can retry. Read availability matters more.",
      },
      {
        name: "Durability",
        target: "A created link is never lost",
        why: "A lost mapping is a permanent broken link that nobody can repair.",
      },
      {
        name: "Consistency",
        target: "Read-your-writes for the creator; eventual (seconds) for everyone else",
        why: "Creators click their own link immediately. Others clicking a few seconds later is fine.",
      },
      {
        name: "Security",
        target: "Codes are not enumerable; creation is rate-limited",
        why: "This prevents scraping private links and stops the service becoming a spam or phishing amplifier.",
      },
    ],
    outOfScope: [
      "Click analytics (follow-up)",
      "Custom aliases (follow-up)",
      "User accounts, dashboards, link editing",
      "Billing / tiers",
    ],
  },

  // ───────────────────────────── Stage 2 — Size ─────────────────────────────
  estimates: [
    {
      title: "Write QPS",
      reasoning: ["100M creates/day ÷ ~86,400 s/day ≈ 1,160 writes/s", "Peak ≈ 3× average ≈ 3,500 writes/s"],
      result: "~1.2K avg, ~3.5K peak writes/s",
      soWhat:
        "A single well-tuned database could absorb this write rate. Writes are not the scaling problem, storage is (see below).",
    },
    {
      title: "Read QPS",
      reasoning: ["100 reads per write → 10B redirects/day", "10B ÷ 86,400 ≈ 116K reads/s", "Peak ≈ 3× ≈ 350K reads/s"],
      result: "~116K avg, ~350K peak reads/s",
      soWhat:
        "That's roughly 20–30× what a single relational primary serves for point reads. The read path needs a cache or CDN layer. Replicas alone would take dozens of nodes.",
    },
    {
      title: "Keyspace → code length",
      reasoning: [
        "Total links over 5 years: 100M × 365 × 5 ≈ 182B",
        "Base62 (a–z, A–Z, 0–9): 62^6 ≈ 56.8B (too small)",
        "62^7 ≈ 3.5 trillion (≈ 19× headroom)",
      ],
      result: "7-character base62 codes",
      soWhat:
        "Seven characters are enough with lots of room to spare. That headroom matters later: we can waste IDs (for example, ranges lost when a server crashes) and it costs nothing.",
    },
    {
      title: "Storage",
      reasoning: [
        "Per record: code 7 B + long URL ~200 B avg (2 KB max) + timestamps/metadata ~50 B ≈ ~500 B with overhead",
        "182B records × 500 B ≈ 91 TB",
        "× 3 replicas ≈ ~275 TB raw",
      ],
      result: "~91 TB logical, ~275 TB replicated over 5 years",
      soWhat:
        "This won't fit on one machine, so data must be partitioned. The access pattern is a pure key lookup, so the partition key is obvious: the short code.",
    },
    {
      title: "Bandwidth",
      reasoning: ["Reads: 116K/s × ~500 B ≈ 58 MB/s egress", "Writes: 1.2K/s × ~500 B ≈ 0.6 MB/s ingress"],
      result: "~60 MB/s, which is trivial",
      soWhat:
        "Bandwidth isn't a constraint. Don't spend interview time on it. The bottlenecks are request rate, tail latency and skew.",
    },
    {
      title: "Cache size",
      reasoning: [
        "Assume ~1B distinct links are clicked per day",
        "Traffic is skewed (Pareto). The hottest 20% serve the bulk of clicks: 200M × 500 B ≈ 100 GB",
      ],
      result: "~100 GB hot set",
      soWhat:
        "The hot set fits in the RAM of a small Redis cluster (a handful of nodes with replicas). A cache is cheap and can absorb 90%+ of reads, so it's the first scaling move.",
    },
  ],

  // ───────────────────────────── Stage 3 — Start simple ─────────────────────────────
  api: [
    {
      method: "POST",
      path: "/api/v1/urls",
      request: `{ "longUrl": "https://…", "expiresAt": "2027-01-01T00:00:00Z" }`,
      response: `201 Created\n{ "code": "aZ3k9Qx", "shortUrl": "https://tny.io/aZ3k9Qx" }`,
      notes:
        "Accepts an Idempotency-Key header so client retries don't mint duplicate links. Validates scheme (http/https only) and length (≤ 2 KB).",
    },
    {
      method: "GET",
      path: "/{code}",
      response: "302 Found\nLocation: https://original…\nCache-Control: public, s-maxage=300, max-age=0",
      notes:
        "302 rather than 301 keeps us in the loop for expiry, takedown and future analytics. s-maxage lets OUR CDN cache it while browsers don't.",
    },
  ],

  dataModel: [
    {
      entity: "url_mapping",
      fields: [
        { name: "code", type: "CHAR(7)", note: "primary/partition key" },
        { name: "long_url", type: "VARCHAR(2048)" },
        { name: "created_at", type: "TIMESTAMP" },
        { name: "expires_at", type: "TIMESTAMP NULL", note: "also drives native TTL" },
        { name: "status", type: "ENUM(ACTIVE, BLOCKED)", note: "set by async safety scan" },
      ],
      accessPatterns: [
        "Get by code (≈99% of traffic): point lookup",
        "Insert new code: put-if-absent",
        "No range scans, no joins, no lookup by long_url (we chose not to dedupe)",
      ],
      insight:
        "This is a key-value workload that happens to be shown as a table. Any store that does fast single-key gets and partitions by key will work, so the choice comes down to operations at 91 TB rather than features.",
    },
  ],

  v1: {
    title: "v1: one server, one database",
    description: [
      "A single application server (say, a Spring Boot service) in front of a single PostgreSQL instance.",
      "Create: generate a random 7-char base62 code, INSERT it, and retry if the UNIQUE constraint fires.",
      "Redirect: SELECT long_url WHERE code = ? and return 302.",
      "This genuinely works for 1,000 users and even ~1,000 QPS. It's the correct starting point because every component we add from here must be justified by a specific failure of this design.",
    ],
    diagram: {
      nodes: [
        { id: "client", label: "Client", sub: "browser / app", kind: "client", x: 0, y: 200 },
        { id: "api", label: "App server", sub: "single instance", kind: "service", x: 680, y: 200 },
        { id: "db", label: "PostgreSQL", sub: "single primary", kind: "db", x: 960, y: 320 },
      ],
      edges: [
        { id: "client-api", from: "client", to: "api", label: "HTTPS" },
        { id: "api-db", from: "api", to: "db", label: "SQL" },
      ],
    },
    whatBreaksFirst: [
      "The app server: one JVM handles maybe 5–10K simple req/s, and we need 350K at peak. It's also a single point of failure, so one deploy or crash takes every link on the internet down.",
      "Then the database: even after fixing the app tier, every redirect is a DB read, and 350K reads/s is 20–30× what one primary serves.",
      "Then storage: 91 TB doesn't fit on one machine.",
      "Order matters: fix the cheapest, most immediate failure first.",
    ],
  },

  // ───────────────────────────── Stage 4 — Evolve ─────────────────────────────
  evolution: [
    {
      version: "v2",
      title: "Stateless app tier behind a load balancer",
      problem: "One app server can't serve 350K req/s at peak, and it's a single point of failure.",
      evidence: "350K peak req/s ÷ ~7K req/s per instance ≈ 50 instances, before allowing for headroom or zone failure.",
      options: [
        {
          name: "Vertical scaling (bigger box)",
          pros: ["Zero architectural change", "No distributed-systems concerns"],
          cons: ["Hard ceiling far below 350K req/s", "Still a single point of failure", "Deploys mean downtime"],
          verdict: "Lost: it doesn't remove the single point of failure, and there's no box big enough.",
        },
        {
          name: "DNS round-robin across servers",
          pros: ["No extra component"],
          cons: ["No health checks: dead servers keep receiving traffic until the TTL expires", "Clients and resolvers cache DNS unpredictably"],
          verdict: "Lost: failover takes minutes, but a 99.99% target allows only ~4 minutes of downtime a month.",
        },
        {
          name: "Stateless servers behind an L7 load balancer",
          pros: ["Horizontal scale by adding instances", "Health checks remove bad nodes in seconds", "Rolling deploys with zero downtime"],
          cons: ["The LB itself must be highly available", "Servers must hold no session state"],
          verdict: "Chosen: the service is naturally stateless, since each request carries everything it needs.",
          chosen: true,
        },
      ],
      decision:
        "Run N stateless API servers across 3 availability zones behind a managed L7 load balancer (which is itself redundant). Autoscale on CPU and request rate.",
      newRisks: [
        {
          risk: "The load balancer is now on every request path.",
          mitigation: "Use a managed, multi-AZ LB (ALB/NLB, or an active-passive HAProxy/Envoy pair with a floating IP).",
        },
        {
          risk: "50 servers now generate random codes concurrently, so the database is the only arbiter of uniqueness.",
          mitigation: "This is acceptable for now: the UNIQUE constraint plus a retry handles it. We revisit it when the DB is sharded and a global uniqueness check stops being cheap.",
        },
      ],
      sayIt:
        "The service holds no state, so I scale it horizontally behind a load balancer. That fixes throughput and removes the app-tier single point of failure in one move. The database is now the bottleneck.",
      delta: {
        addNodes: [{ id: "lb", label: "Load balancer", sub: "L7, multi-AZ", kind: "lb", x: 440, y: 200 }],
        updateNodes: [{ id: "api", label: "API servers", sub: "stateless × N" }],
        removeEdges: ["client-api"],
        addEdges: [
          { id: "client-lb", from: "client", to: "lb", label: "HTTPS" },
          { id: "lb-api", from: "lb", to: "api" },
        ],
      },
    },
    {
      version: "v3",
      title: "Cache the read path",
      problem: "Every redirect hits the database: 350K reads/s at peak against one primary.",
      evidence:
        "A single Postgres primary does roughly 10–20K simple PK lookups/s, so we're 20–30× over. Reads outnumber writes 100:1 and are heavily skewed.",
      options: [
        {
          name: "Read replicas",
          pros: ["No application change beyond read routing", "Data is always complete (no misses)"],
          cons: [
            "Needs ~25+ replicas, each holding the full dataset",
            "Replication lag breaks the 'creator clicks immediately' case",
            "Still a disk/B-tree lookup per request, so tail latency suffers",
          ],
          verdict: "Lost: it's the expensive way to buy throughput, and it doesn't use the skew in the traffic.",
        },
        {
          name: "Cache-aside with Redis",
          pros: [
            "Sub-millisecond reads",
            "~100 GB hot set fits in a small cluster",
            "Skewed traffic gives a 90%+ hit rate",
            "Mappings are immutable, so there's almost nothing to invalidate",
          ],
          cons: ["Misses still hit the DB", "New failure modes: stampede, cache node loss"],
          verdict:
            "Chosen: immutability makes the classic cache headache (invalidation) mostly disappear, which makes this the highest-leverage move.",
          chosen: true,
        },
        {
          name: "Shard the database now",
          pros: ["Solves throughput and storage together"],
          cons: ["Large operational step", "Doesn't cut latency", "Makes no use of skew"],
          verdict: "Not yet: sharding is coming for storage reasons, but for reads alone a cache is cheaper and faster.",
        },
      ],
      decision:
        "Cache-aside: on GET, try Redis, and on a miss read the DB and populate with a TTL (~24h, refreshed by access). On create, also write the new mapping into the cache (write-through on create) so the creator's immediate click is a hit. Negative results (code doesn't exist) are cached for 60 s.",
      newRisks: [
        {
          risk: "Cache stampede: a viral link that isn't cached produces thousands of simultaneous misses, all hitting the DB.",
          mitigation: "Request coalescing (single-flight) per key on each API server, so only one in-flight DB read per key per server.",
        },
        {
          risk: "Losing a cache node sends its share of keys straight to the DB.",
          mitigation:
            "Redis Cluster with a replica per shard (automatic failover in seconds). Key distribution via hash slots means one node's loss affects only 1/N of keys.",
        },
        {
          risk: "Scanners hitting random non-existent codes always miss the cache.",
          mitigation: "Cache negative lookups briefly, and rate-limit per IP on 404 bursts.",
        },
        {
          risk: "A link taken down for abuse can stay cached.",
          mitigation: "Takedown explicitly deletes the key. It's the one case of invalidation, and it's rare and explicit.",
        },
      ],
      sayIt:
        "Short-code-to-URL mappings never change, so caching them is unusually safe: no invalidation except takedowns. With 100:1 reads and a skewed distribution I expect a 90%+ hit rate, which brings DB load from 350K/s down to about 35K/s.",
      delta: {
        addNodes: [{ id: "cache", label: "Cache", sub: "Redis Cluster ~100 GB", kind: "cache", x: 960, y: 80 }],
        addEdges: [{ id: "api-cache", from: "api", to: "cache", label: "GET / SET" }],
      },
    },
    {
      version: "v4",
      title: "Partition the data: distributed key-value store",
      problem: "91 TB over 5 years won't fit on one machine, and even after the cache, 35K reads/s at peak is a lot for one primary.",
      evidence: "Storage: 182B rows × ~500 B. The cache leaves ~10% of 350K = 35K reads/s, plus 3.5K writes/s.",
      options: [
        {
          name: "Sharded PostgreSQL (app-level sharding or Citus/Vitess-style)",
          pros: ["Familiar SQL, transactions, constraints", "Strong consistency per shard"],
          cons: [
            "Resharding at 91 TB is a serious operational project",
            "We'd use none of the relational features: no joins, no multi-row transactions",
          ],
          verdict: "Lost: we'd pay the operational cost of relational sharding without using what relational gives us.",
        },
        {
          name: "Distributed KV / wide-column store (DynamoDB or Cassandra), partitioned by code",
          pros: [
            "Horizontal scaling and rebalancing are built in",
            "Single-key get/put is exactly our access pattern",
            "Multi-region replication available out of the box",
            "Native TTL for expiry",
          ],
          cons: [
            "Global uniqueness checks are expensive (Cassandra LWT runs Paxos; DynamoDB conditional writes are fine but cost a write)",
            "Eventual consistency by default, so we need to be deliberate about read consistency",
          ],
          verdict: "Chosen: the workload is a key-value workload, so we use a key-value store.",
          chosen: true,
        },
        {
          name: "Keep one DB and archive old links to object storage",
          pros: ["Simple"],
          cons: ["Old links still get clicked (long tail)", "Doesn't solve 5-year total size"],
          verdict: "Lost: it only postpones the problem.",
        },
      ],
      decision:
        "Move url_mapping to a distributed KV store (DynamoDB, or Cassandra if self-hosted) with partition key = code. Because codes look random, load spreads evenly across partitions with no hot ranges.",
      newRisks: [
        {
          risk: "'Generate random, check if it exists' now needs a conditional write on every create (expensive LWT in Cassandra), with retries as the table fills.",
          mitigation: "Change the ID strategy so collisions are impossible by construction. This is the next step.",
        },
        {
          risk: "A single viral key is still a single partition.",
          mitigation: "The cache absorbs it. DynamoDB adaptive capacity helps, and a CDN comes later.",
        },
      ],
      sayIt:
        "Our access pattern is one key-value lookup and nothing else, so I'd rather use a store built for that than shard Postgres by hand. If we later need relational queries, like a per-user link dashboard, I'd add a secondary store for that view rather than compromise the hot path.",
      delta: {
        removeNodes: ["db"],
        removeEdges: ["api-db"],
        addNodes: [{ id: "kv", label: "KV store", sub: "DynamoDB / Cassandra, by code", kind: "db", x: 960, y: 320 }],
        addEdges: [{ id: "api-kv", from: "api", to: "kv", label: "get / put" }],
      },
    },
    {
      version: "v5",
      title: "Collision-free ID generation with range allocation",
      problem:
        "Random code + uniqueness check is now a conditional write against a distributed store on every create. Codes must also be unique, 7 characters, and not enumerable.",
      evidence:
        "By year 5 the keyspace is ~5% full (182B / 3.5T), so ~1 in 20 random codes collides and costs a retry. With Cassandra LWT, every attempt is a 4-round-trip Paxos.",
      options: [
        {
          name: "Hash the long URL (MD5/SHA) and take the first 7 base62 chars",
          pros: ["Stateless", "Same URL gives the same code (if wanted)"],
          cons: ["Truncation means collisions, so we still need check-and-retry", "We said no dedupe, so its one benefit is irrelevant"],
          verdict: "Lost: it has the same collision problem as random codes plus extra work.",
        },
        {
          name: "Random code + put-if-absent",
          pros: ["Simple", "Not enumerable"],
          cons: ["A conditional write every time", "Retry rate grows with fill", "Expensive LWT on Cassandra"],
          verdict: "Viable on DynamoDB and fine as an answer, but it scales worse than coordination-free generation.",
        },
        {
          name: "Single global counter (DB sequence / Redis INCR)",
          pros: ["Unique by construction", "Dense IDs"],
          cons: ["Single point of failure and a hot spot on every write", "Sequential, so enumerable", "Cross-region latency for every create"],
          verdict: "Lost: it puts one centralised component on the critical path of every write.",
        },
        {
          name: "Snowflake-style 64-bit IDs",
          pros: ["No coordination per ID", "Time-ordered"],
          cons: ["64 bits is about 11 base62 characters, not 7", "Time-ordered, so partially predictable"],
          verdict: "Lost: it breaks the 7-character requirement.",
        },
        {
          name: "Range allocation + bijective scramble",
          pros: [
            "An allocator hands each API server a block (e.g. 100K counters) once, so the hot path does no network call",
            "Unique by construction, with no collision checks",
            "Scrambling the counter with a reversible permutation makes codes look random",
          ],
          cons: ["The allocator is a new, strongly consistent dependency", "Ranges held by crashed servers are wasted"],
          verdict:
            "Chosen: coordination happens once per 100K IDs instead of once per ID, and the 19× keyspace headroom makes wasted ranges irrelevant.",
          chosen: true,
        },
      ],
      decision:
        "An ID Range Allocator (one row in a strongly consistent store such as etcd, ZooKeeper, or a Postgres row updated with UPDATE … RETURNING) hands out counter ranges. Each API server takes the next counter from memory, applies a bijective scramble (e.g. a keyed Feistel permutation over [0, 62^7)), and base62-encodes the result into exactly 7 chars. Servers prefetch their next range at 80% use.",
      newRisks: [
        {
          risk: "The allocator must never hand out the same range twice. A split brain there means duplicate codes, which overwrite each other's links.",
          mitigation: "Back it with a consensus system (etcd/ZooKeeper) or one transactional row. It handles about one request per second fleet-wide, so it can afford to be slow and safe.",
        },
        {
          risk: "If the allocator is down, no new ranges are issued.",
          mitigation: "Prefetching gives every server a full spare range, which buys hours of writes. Reads never touch the allocator.",
        },
        {
          risk: "If the scramble key leaks, codes become enumerable again.",
          mitigation: "Treat it like any secret (KMS) and rotate it only for new ranges. Decoding old codes is never needed.",
        },
      ],
      sayIt:
        "I'd move coordination off the hot path: lease ranges of 100K IDs per server, then scramble the counter with a reversible permutation so codes are unique by construction and still look random. The allocator is a CP component, but at one call per 100K creates its availability barely matters.",
      delta: {
        addNodes: [
          { id: "idalloc", label: "ID range allocator", sub: "etcd / txn row, CP", kind: "infra", x: 680, y: 400 },
        ],
        addEdges: [{ id: "api-idalloc", from: "api", to: "idalloc", label: "lease range (rare)", async: true }],
      },
    },
    {
      version: "v6",
      title: "Go global: CDN edge + multi-region",
      problem:
        "Users are global: a redirect from Sydney to us-east costs ~200 ms before we do any work, and one region is a single point of failure against a 99.99% target.",
      evidence: "RTT us-east↔Sydney ≈ 200 ms, against a target of < 100 ms end-to-end. 99.99% leaves 52 min/year, and a single regional incident uses that up.",
      options: [
        {
          name: "CDN caching of redirect responses",
          pros: ["Served from 100+ PoPs within ~20 ms of most users", "Absorbs viral spikes at the edge", "Cheap"],
          cons: ["Cached redirects can't be revoked instantly (we need a purge API)", "Only hot links benefit"],
          verdict: "Chosen: 302 + s-maxage=300 lets our own CDN cache while browsers don't.",
          chosen: true,
        },
        {
          name: "Multi-region active-active with async-replicated KV",
          pros: ["Survives region loss", "Local reads and writes everywhere"],
          cons: ["Replication lag of seconds", "Must avoid ID collisions across regions"],
          verdict:
            "Chosen: each region leases ranges from its own slice of the counter space, so cross-region ID conflicts are impossible.",
          chosen: true,
        },
        {
          name: "Globally strongly consistent DB (Spanner-style)",
          pros: ["No lag anomalies"],
          cons: ["Cross-region consensus latency on writes", "Cost", "Overkill for immutable data"],
          verdict: "Lost: immutable, append-only data doesn't need global consensus.",
        },
      ],
      decision:
        "Put a CDN in front, with origin shield and request collapsing. Run 2+ active regions behind latency-based Geo-DNS, with KV replicated asynchronously across regions. Each region allocates IDs from a disjoint counter slice. On a local not-found, fall back to a cross-region read before returning 404 (this covers 'created in EU, clicked in US 200 ms later').",
      newRisks: [
        {
          risk: "Replication lag: a link created in Region A is briefly missing in Region B.",
          mitigation: "On a local miss, do a cross-region fallback read. It's rare (only real 404s and very fresh links), and the result is negative-cached.",
        },
        {
          risk: "Region failover loses the last few seconds of un-replicated creates (RPO of seconds).",
          mitigation: "Accept it and document it. Those users get an error or retry. The alternative (synchronous replication) costs latency on every write.",
        },
        {
          risk: "Takedowns now have to reach CDN edges too.",
          mitigation: "The takedown workflow calls the CDN purge API (seconds) in addition to deleting from the cache.",
        },
      ],
      sayIt:
        "302 doesn't mean uncacheable for us. With s-maxage our own CDN caches hot redirects at the edge while browsers still come back, so we keep control. Because data is immutable and IDs are partitioned per region, active-active is low-risk; the only anomaly is replication lag, and a fallback read on miss covers it.",
      delta: {
        addNodes: [
          { id: "cdn", label: "CDN / Edge", sub: "Geo-DNS + 100s of PoPs", kind: "edge", x: 220, y: 200 },
          { id: "regionB", label: "Region B", sub: "full stack + KV replica", kind: "region", x: 1240, y: 320 },
        ],
        removeEdges: ["client-lb"],
        addEdges: [
          { id: "client-cdn", from: "client", to: "cdn", label: "HTTPS" },
          { id: "cdn-lb", from: "cdn", to: "lb", label: "origin (miss)" },
          { id: "kv-regionB", from: "kv", to: "regionB", label: "async replication", async: true },
          { id: "cdn-regionB", from: "cdn", to: "regionB", label: "failover origin", async: true },
        ],
      },
    },
    {
      version: "v7",
      title: "Protect the write path: rate limiting + async safety scanning",
      problem:
        "Public URL shorteners get abused: bots mass-create links, and phishing/malware links use our trusted domain to evade filters.",
      evidence:
        "One abusive client at 10K creates/s is 3× our entire peak write budget. Getting our domain blocklisted by browsers or email providers would break every legitimate link.",
      options: [
        {
          name: "Synchronous deep URL scan on create",
          pros: ["Bad links never go live"],
          cons: ["Calls third-party reputation APIs (100s of ms to seconds)", "Their outage becomes our outage"],
          verdict: "Lost: it couples our write availability to someone else's API.",
        },
        {
          name: "Fast sync blocklist + async deep scan via queue",
          pros: ["Write latency stays low", "A scanner outage only delays scanning", "Easy to add more consumers later (analytics!)"],
          cons: ["A short window where a bad link is live", "At-least-once delivery means duplicate processing"],
          verdict: "Chosen: it's the standard availability-vs-safety trade, and the queue doubles as the event backbone for analytics.",
          chosen: true,
        },
        {
          name: "Token-bucket rate limiting per API key / IP at the edge of our origin",
          pros: ["Caps abuse cheaply", "Protects the allocator and KV write capacity"],
          cons: ["Needs a shared counter store", "Limits for shared NAT IPs need care"],
          verdict: "Chosen. See the Rate Limiter problem for the full design.",
          chosen: true,
        },
      ],
      decision:
        "The load balancer/gateway consults a rate limiter (token bucket in Redis) on create requests. API servers check an in-memory Bloom filter of known-bad domains synchronously, then publish LinkCreated to a queue. Safety scanners consume it and, if a link is malicious, set status=BLOCKED in KV, delete the cache key and purge the CDN.",
      newRisks: [
        {
          risk: "The API commits to KV and then crashes before publishing, leaving a link that is never scanned.",
          mitigation:
            "Use the transactional outbox pattern (or KV change streams such as DynamoDB Streams / Cassandra CDC) so publishing is driven by the committed write itself.",
        },
        {
          risk: "At-least-once delivery means the scanner may process the same link twice.",
          mitigation: "Make the consumer idempotent: the scan result is a conditional overwrite (same input, same final state).",
        },
      ],
      sayIt:
        "I'd never put a third-party reputation API in the synchronous create path. A cheap local blocklist check stays inline, and the deep scan goes onto a queue. That queue is also the natural tap for analytics later, so it pays for itself twice.",
      delta: {
        addNodes: [
          { id: "ratelimiter", label: "Rate limiter", sub: "token bucket in Redis", kind: "infra", x: 440, y: 20 },
          { id: "queue", label: "Event queue", sub: "Kafka / SQS: LinkCreated", kind: "queue", x: 960, y: -130 },
          { id: "scanner", label: "Safety scanner", sub: "consumer group", kind: "worker", x: 1240, y: -130 },
        ],
        addEdges: [
          { id: "lb-ratelimiter", from: "lb", to: "ratelimiter", label: "allow?" },
          { id: "api-queue", from: "api", to: "queue", label: "publish", async: true },
          { id: "queue-scanner", from: "queue", to: "scanner", label: "consume", async: true },
          { id: "scanner-kv", from: "scanner", to: "kv", label: "status=BLOCKED" },
          { id: "scanner-cache", from: "scanner", to: "cache", label: "evict" },
        ],
      },
    },
  ],

  // ───────────────────────────── Stage 5 — Flows ─────────────────────────────
  flows: [
    {
      id: "create",
      name: "Write path: create a short URL",
      kind: "write",
      summary: "POST /api/v1/urls: from the client to a durable, scanned, globally replicated link.",
      hops: [
        { from: "client", to: "cdn", label: "POST /api/v1/urls", narration: "The client sends the long URL with an Idempotency-Key header.", why: "The idempotency key means a retry after a network timeout returns the same link instead of creating a second one." },
        { from: "cdn", to: "lb", label: "forward (no cache)", narration: "The CDN never caches POSTs. It terminates TLS close to the user and forwards to the nearest healthy region.", why: "TLS handshakes at the edge save one or two round trips on long-distance connections." },
        { from: "lb", to: "ratelimiter", label: "allow(apiKey)?", narration: "The gateway checks the token bucket for this API key/IP. If it's over the limit, the request gets 429 and never reaches the app.", why: "Abuse is rejected before it costs us an ID or a KV write." },
        { from: "ratelimiter", to: "lb", label: "allowed", narration: "Tokens are available, so the request proceeds." },
        { from: "lb", to: "api", label: "route", narration: "The LB routes to any healthy API server. Any one can serve it because none hold state." },
        { from: "api", label: "validate + blocklist", narration: "The server validates the scheme and length (≤ 2 KB) and checks the domain against an in-memory Bloom filter of known-bad domains.", why: "This check takes microseconds and catches the obvious cases inline, without a network call." },
        { from: "api", label: "next ID from local range", narration: "It takes the next counter from the server's leased range in memory (e.g. 4,200,117 in range [4.2M, 4.3M)), then scrambles it with a Feistel permutation and base62-encodes it to 'aZ3k9Qx'.", why: "There's no network call and no collision check: the code is unique by construction and still looks random." },
        { from: "api", to: "idalloc", label: "lease next range (rare)", narration: "Only when the current range is 80% used, a background call leases the next 100K block.", why: "Coordination happens once per 100K creates, so the allocator can be slow and strongly consistent without affecting latency.", async: true },
        { from: "api", to: "kv", label: "put(code, longUrl)", narration: "The server writes the mapping to the local region's KV with a quorum/durable write. attribute_not_exists(code) acts as a cheap safety check.", why: "The condition should never fail. If it does, that's an alarm-worthy bug in the allocator, not a retry case." },
        { from: "kv", to: "api", label: "ack", narration: "The write is durable in the local region." },
        { from: "api", to: "cache", label: "SET code → url", narration: "Write-through on create: the new mapping goes into Redis now.", why: "The creator usually clicks within seconds. Without this, their first click would be a cache miss." },
        { from: "api", to: "queue", label: "LinkCreated", narration: "The server publishes a LinkCreated event (via outbox/CDC) for the async safety scan.", why: "Deep scanning is slow and depends on third parties, so it stays off the synchronous path.", async: true },
        { from: "api", to: "lb", label: "201 Created", narration: "The server returns the short URL to the client." },
        { from: "lb", to: "cdn", label: "201", narration: "The response travels back through the LB." },
        { from: "cdn", to: "client", label: "201 { shortUrl }", narration: "The client gets https://tny.io/aZ3k9Qx. End-to-end this is typically 30–60 ms." },
        { from: "kv", to: "regionB", label: "replicate", narration: "The KV store replicates the new row to other regions asynchronously, usually in under a second.", why: "Synchronous replication would add a cross-region round trip to every create. A fallback read on miss handles the lag.", async: true },
      ],
      takeaway:
        "The only synchronous dependencies on the write path are the rate limiter and the KV store. ID generation is local and scanning is asynchronous, so writes stay fast and keep working when the allocator or scanner are down.",
    },
    {
      id: "redirect-hit",
      name: "Read path: redirect served at the edge",
      kind: "read",
      summary: "GET /aZ3k9Qx for a hot link. This is most of our traffic.",
      hops: [
        { from: "client", to: "cdn", label: "GET /aZ3k9Qx", narration: "Geo-DNS sends the user to the nearest CDN PoP (~10–20 ms away)." },
        { from: "cdn", label: "edge cache HIT", narration: "This PoP served the same code within the last 5 minutes (s-maxage=300), so it has the 302 cached.", why: "Hot links are exactly the ones most likely to be at the edge, which is where skew works in our favour." },
        { from: "cdn", to: "client", label: "302 Location: …", narration: "The redirect comes back in ~20 ms without touching our origin.", why: "max-age=0 stops the browser caching it, so the next click comes back to us (for analytics, expiry and takedown)." },
      ],
      takeaway:
        "For viral links the origin never sees most requests. The CDN plus a 302 with s-maxage gets most of the load reduction of a 301 while keeping control.",
    },
    {
      id: "redirect-miss",
      name: "Read path: full miss (CDN and cache)",
      kind: "read",
      summary: "A long-tail link nobody has clicked recently.",
      hops: [
        { from: "client", to: "cdn", label: "GET /q8Lm2Zt", narration: "The request reaches the nearest PoP." },
        { from: "cdn", to: "lb", label: "MISS → origin", narration: "The PoP and the origin shield both miss, so the request is forwarded to the nearest healthy region.", why: "The origin shield means that even if 50 PoPs miss at once, only one request reaches us per key." },
        { from: "lb", to: "api", label: "route", narration: "Reads skip the creation rate limiter (a separate, looser per-IP limit catches scanners)." },
        { from: "api", to: "cache", label: "GET q8Lm2Zt", narration: "Redis lookup: the key hashes to one slot on one shard." },
        { from: "cache", to: "api", label: "nil (miss)", narration: "It isn't cached." },
        { from: "api", label: "single-flight", narration: "Concurrent requests for this key on this server wait on the same in-flight future instead of each querying the DB.", why: "This prevents a stampede when a cold link suddenly gets popular." },
        { from: "api", to: "kv", label: "get(q8Lm2Zt)", narration: "Point lookup by partition key in the local region (~2–5 ms)." },
        { from: "kv", to: "api", label: "longUrl, ACTIVE", narration: "The row is found. The server checks status=ACTIVE and expires_at > now (TTL deletion is lazy, so we check explicitly)." },
        { from: "api", to: "cache", label: "SET (TTL 24h)", narration: "It populates the cache for the next reader." },
        { from: "api", to: "lb", label: "302", narration: "It responds with 302 and Cache-Control: public, s-maxage=300, max-age=0." },
        { from: "lb", to: "cdn", label: "302 (store)", narration: "The CDN stores it for 5 minutes." },
        { from: "cdn", to: "client", label: "302 Location: …", narration: "The redirect is delivered. A full miss is still ~30–60 ms when served in-region." },
      ],
      takeaway:
        "Each layer (edge, shield, Redis, single-flight) collapses duplicate work for the layer below, so the KV store sees roughly one read per key per cache TTL.",
    },
    {
      id: "fail-cache-node",
      name: "Failure: a cache node dies",
      kind: "failure",
      summary: "One Redis primary crashes during peak traffic.",
      hops: [
        { from: "client", to: "cdn", label: "GET /aZ3k9Qx", narration: "Normal traffic continues. The CDN still serves hot links, so most users notice nothing." },
        { from: "cdn", to: "lb", label: "MISS → origin", narration: "Long-tail requests reach the origin as usual." },
        { from: "lb", to: "api", label: "route", narration: "The request lands on an API server." },
        { from: "api", to: "cache", label: "GET → timeout", narration: "Keys in the dead shard's hash slots time out (we set an aggressive 20 ms client timeout).", failure: true, why: "A slow cache is worse than no cache. A tight timeout plus a circuit breaker per shard means we fail fast." },
        { from: "api", label: "circuit OPEN for shard 3", narration: "After N failures the breaker for that shard opens, and requests for its keys go straight to KV without waiting on timeouts.", failure: true },
        { from: "api", to: "kv", label: "get (fallback)", narration: "About 1/N of the keyspace now reads from KV. With 10 shards that's ~10% of cache traffic, or ~30K extra reads/s, which is why KV capacity has to be provisioned with this headroom.", why: "Capacity planning question: can the DB survive losing one cache shard? If not, cache loss becomes a full outage." },
        { from: "kv", to: "api", label: "longUrl", narration: "Responses are slower (~5 ms vs ~0.5 ms) but correct." },
        { from: "cache", label: "replica promoted", narration: "Within ~5–15 s Redis Cluster promotes the shard's replica. The breaker half-opens, probes, and closes." },
        { from: "api", to: "cache", label: "GET → hit", narration: "Traffic returns to the cache. The promoted replica is warm, so there's no cold-cache storm." },
      ],
      takeaway:
        "Losing one cache node degrades latency for 1/N of keys for a few seconds and doesn't take down availability. That only holds because of replicas, tight timeouts, circuit breakers and DB headroom.",
    },
    {
      id: "fail-stampede",
      name: "Failure: viral link stampede",
      kind: "failure",
      summary: "A celebrity tweets a freshly created link and 80K clicks arrive in 2 seconds.",
      hops: [
        { from: "client", to: "cdn", label: "80K × GET /vR4l", narration: "Clicks arrive from every continent at once." },
        { from: "cdn", label: "request collapsing", narration: "Each PoP misses once and collapses its concurrent requests. The origin shield collapses the PoPs' requests again, so origin sees roughly one request per region.", why: "Without collapsing, every PoP × every concurrent request goes to origin." },
        { from: "cdn", to: "lb", label: "~1 request", narration: "A handful of requests reach the LB." },
        { from: "lb", to: "api", label: "route", narration: "They spread across API servers." },
        { from: "api", to: "cache", label: "GET → HIT", narration: "Write-through on create already put this fresh link in Redis, so even the origin requests are cache hits.", why: "This is the second payoff of write-through on create: fresh links are exactly the ones that go viral." },
        { from: "api", to: "lb", label: "302 (s-maxage=300)", narration: "The API responds with a CDN-cacheable redirect." },
        { from: "lb", to: "cdn", label: "302 (store)", narration: "The response is cached at all edges. The remaining ~79,99x requests are served from edges." },
        { from: "cdn", to: "client", label: "302", narration: "Users are redirected in ~20 ms." },
      ],
      takeaway:
        "Hot keys are handled in layers: CDN collapsing, then write-through cache, then single-flight. A single Redis shard capped at ~100K ops/s never sees the spike.",
    },
    {
      id: "fail-region",
      name: "Failure: Region A goes down",
      kind: "failure",
      summary: "An entire region becomes unavailable.",
      hops: [
        { from: "client", to: "cdn", label: "GET /aZ3k9Qx", narration: "Edges keep serving cached redirects throughout the incident." },
        { from: "cdn", to: "lb", label: "origin → 5xx / timeout", narration: "Region A's origin fails its health checks.", failure: true },
        { from: "cdn", to: "regionB", label: "failover origin", narration: "The CDN (and Geo-DNS) shift traffic to Region B within ~30–60 s of failed health checks.", why: "Failover at the CDN origin-group level is faster than waiting for DNS TTLs to expire on clients." },
        { from: "regionB", label: "serve from replica", narration: "Region B has a full replica of the KV store, so redirects for all links replicated before the failure work normally." },
        { from: "regionB", label: "writes continue", narration: "Creates continue in Region B using Region B's own ID slice. There's no conflict with A's ranges, even after A recovers.", why: "This is why IDs are partitioned per region: failover never needs a coordination step." },
        { from: "regionB", label: "RPO: last ~1 s", narration: "Links created in A in the last second before the crash, and not yet replicated, return 404 in B until A recovers and replication catches up.", failure: true, why: "This is the accepted cost of async replication, and we state it explicitly. Synchronous replication would add ~70–200 ms to every create." },
      ],
      takeaway:
        "Reads survive a region loss completely. Writes survive with a few seconds of RPO. The design makes that choice deliberately and states it.",
    },
    {
      id: "fail-duplicate",
      name: "Failure: event processed twice",
      kind: "failure",
      summary: "The scanner's ack is lost, so the queue redelivers LinkCreated.",
      hops: [
        { from: "api", to: "queue", label: "LinkCreated(aZ3k9Qx)", narration: "The event is published once, from the outbox/CDC.", async: true },
        { from: "queue", to: "scanner", label: "deliver #1", narration: "Scanner instance 1 receives it and calls the reputation APIs: malicious.", async: true },
        { from: "scanner", to: "kv", label: "status=BLOCKED if version=1", narration: "It does a conditional update: set BLOCKED only if the row is still at the version we read." },
        { from: "scanner", to: "cache", label: "DEL aZ3k9Qx", narration: "It evicts the cache entry (and calls the CDN purge)." },
        { from: "scanner", label: "crash before ack", narration: "The instance dies before acking. The visibility timeout expires.", failure: true },
        { from: "queue", to: "scanner", label: "deliver #2", narration: "Instance 2 receives the same event.", async: true, failure: true },
        { from: "scanner", to: "kv", label: "conditional → no-op", narration: "The status is already BLOCKED, so the update leaves the same final state. Evicting the cache again is also harmless.", why: "Design consumers to be idempotent instead of chasing exactly-once delivery. Same input gives the same end state." },
      ],
      takeaway:
        "At-least-once delivery plus idempotent consumers gives effectively-once outcomes. A Java/banking analogy is a payment consumer keyed by transaction ID.",
    },
  ],

  // ───────────────────────────── Stage 6 — Deep dives ─────────────────────────────
  deepDives: [
    {
      id: "id-generation",
      title: "Short code generation",
      question: "How do you generate 182B unique, 7-character, non-enumerable codes at 3.5K/s across regions?",
      context: [
        "Constraints: unique (correctness), ≤ 7 chars (product), not guessable (privacy), no per-write coordination (latency and availability).",
        "Keyspace 62^7 ≈ 3.52 × 10^12. At end of life we use ~5% of it.",
        "Random codes: the chance a new code collides is roughly n / 62^7, about 5% at end of life. Each collision is a retry plus a conditional write.",
        "Bijective scramble: a 4-round Feistel network over a ~42-bit domain with cycle-walking to stay below 62^7. Unique in, unique out, so there are no collisions.",
      ],
      options: [
        { name: "MD5(longUrl) → first 7 base62", pros: ["Stateless"], cons: ["Collisions need check-and-retry", "Dedupe benefit unused"], verdict: "Lost" },
        { name: "Random + put-if-absent", pros: ["Simple", "Not enumerable"], cons: ["Conditional write per create", "Retries grow with fill"], verdict: "Acceptable fallback answer on DynamoDB" },
        { name: "Central counter (Redis INCR)", pros: ["Simple, dense"], cons: ["SPOF on every write", "Enumerable", "Cross-region latency"], verdict: "Lost" },
        { name: "Snowflake", pros: ["Coordination-free"], cons: ["~11 chars"], verdict: "Lost on length" },
        { name: "Range lease + Feistel scramble", pros: ["Unique by construction", "Local, no network", "Looks random"], cons: ["Allocator is a CP dependency", "Wasted ranges"], verdict: "Recommended", chosen: true },
      ],
      recommendation:
        "Range leasing + keyed bijective scramble. Allocator ranges are carved per region (e.g. the top bits of the counter = region id). Keep 'random + conditional put' as the fallback if the interviewer pushes on simplicity. It's a legitimate answer, and saying when you'd pick it shows judgement.",
      sayIt:
        "The trick is to take coordination off the per-request path: unique comes from the counter, unguessable from a reversible permutation. Collisions become impossible rather than unlikely.",
    },
    {
      id: "hot-keys",
      title: "Hot keys, caching layers, and 301 vs 302",
      question: "How do you keep the redirect fast and the origin safe when traffic is extremely skewed?",
      context: [
        "Zipf-like traffic: a few links get millions of clicks while the long tail gets almost none.",
        "A single Redis shard tops out around 100K ops/s, and one viral key lives on exactly one shard.",
        "301 is cached by browsers indefinitely, so it gives the lowest load but you lose expiry, takedown and analytics for that browser forever.",
      ],
      options: [
        { name: "301 Moved Permanently", pros: ["Browser caches, so repeat clicks cost us nothing"], cons: ["Irrevocable per browser", "No analytics", "Expiry doesn't work"], verdict: "Lost: it gives up control we can't win back" },
        { name: "302 + CDN s-maxage", pros: ["Edge absorbs hot keys", "Revocable via purge", "Keeps analytics possible"], cons: ["More origin traffic than 301"], verdict: "Chosen", chosen: true },
        { name: "In-process L1 cache (Caffeine, top ~10K keys, 30–60s TTL)", pros: ["Zero network hop for the hottest keys", "Shields Redis hot shard"], cons: ["Per-server memory", "Takedown delay up to TTL"], verdict: "Add when Redis hot-shard CPU becomes an issue", chosen: true },
        { name: "Key replication (aZ3k9Qx#1..#k across shards)", pros: ["Spreads one hot key"], cons: ["Complexity", "Rarely needed after CDN + L1"], verdict: "Know it exists; usually unnecessary here" },
      ],
      recommendation:
        "Layered: CDN edge (s-maxage) → in-process L1 for the top-N → Redis → KV, with single-flight at each origin server. Use 302 so control stays with us.",
      sayIt:
        "I'd choose 302 deliberately and win back most of 301's efficiency with our own CDN, because 301 hands caching control to millions of browsers we can never reach again.",
    },
    {
      id: "storage",
      title: "Storage engine and partitioning",
      question: "Where do 91 TB of mappings live, and how is the data partitioned and replicated?",
      context: [
        "Access pattern: get-by-key and put-if-absent, with no scans or joins.",
        "Writes are append-only, records are immutable (except status), and there's a natural TTL.",
        "Partition key = code. Because codes are scrambled, hashing is uniform with no hot ranges and no time-correlated hot spots.",
      ],
      options: [
        { name: "DynamoDB (on-demand, global tables)", pros: ["Zero ops", "Native TTL", "Global tables", "Conditional writes"], cons: ["Cost at 350K reads/s without cache", "Vendor lock-in"], verdict: "Recommended for managed cloud", chosen: true },
        { name: "Cassandra (RF=3, LOCAL_QUORUM)", pros: ["Self-hosted, multi-DC native", "Great write throughput"], cons: ["Ops expertise needed", "LWT is expensive"], verdict: "Recommended if self-hosting; pairs well with range IDs (no LWT needed)" },
        { name: "Sharded MySQL/Postgres", pros: ["Team familiarity", "Strong per-shard consistency"], cons: ["Resharding at scale is painful", "No relational features used"], verdict: "Choose if the org already runs Vitess well" },
      ],
      recommendation:
        "A distributed KV store partitioned by code, RF=3, quorum reads and writes in-region, async cross-region. Range-based IDs remove the need for LWT/conditional writes, which keeps Cassandra on its fast path.",
      sayIt:
        "The data model is a hash map, so I want a store that's a distributed hash map. Partitioning on the scrambled code gives uniform distribution for free.",
    },
  ],

  // ───────────────────────────── Stage 7 — Defend ─────────────────────────────
  tradeOffs: [
    { decision: "302 + CDN s-maxage", alternative: "301", why: "Keeps expiry, takedown, and analytics possible; CDN recovers most of the efficiency.", whenToSwitch: "If links are guaranteed permanent and there are no analytics, ever (rare)." },
    { decision: "Range lease + bijective scramble", alternative: "Random + conditional put", why: "No collision checks, no per-write coordination, no LWT.", whenToSwitch: "Small scale or a DynamoDB-only shop where conditional puts are cheap and simplicity wins." },
    { decision: "Distributed KV store", alternative: "Sharded Postgres", why: "Pure key-value access; built-in partitioning, TTL, multi-region.", whenToSwitch: "If we add rich relational features (user dashboards, editing, teams) on the hot data." },
    { decision: "Cache-aside + write-through on create", alternative: "Read-through only", why: "Creators and viral links click fresh links immediately, so they should be warm from the start.", whenToSwitch: "If most created links are never clicked (cache pollution), switch to lazy fill only." },
    { decision: "Async cross-region replication", alternative: "Synchronous / Spanner-style", why: "Immutable data with per-region ID slices doesn't need global consensus; saves 70–200 ms per write.", whenToSwitch: "If losing even ~1 s of creates in a regional disaster is unacceptable (e.g. paid links with SLAs)." },
    { decision: "Async safety scan via queue", alternative: "Synchronous scan", why: "Write availability doesn't depend on third-party APIs; the queue is reusable for analytics.", whenToSwitch: "Regulated/enterprise tier where no unscanned link may ever go live." },
    { decision: "New code per request", alternative: "Dedupe on long URL", why: "Avoids a huge secondary index and read-before-write.", whenToSwitch: "If storage cost dominates and many users shorten identical URLs." },
  ],

  bottlenecks: [
    { item: "ID range allocator (CP component)", mitigation: "One call per 100K creates per server; prefetch at 80% gives hours of buffer; back with etcd/ZooKeeper quorum." },
    { item: "Hot Redis shard for a viral key", mitigation: "CDN collapsing + in-process L1 cache; key replication as last resort." },
    { item: "KV capacity when a cache shard is lost", mitigation: "Provision ≥ 1/N headroom; circuit breakers; replicas per shard." },
    { item: "Cross-region replication lag", mitigation: "Fallback read on local miss; negative caching; explicit RPO." },
    { item: "CDN purge latency for takedowns", mitigation: "Short s-maxage (5 min) bounds worst case; purge API for urgent cases." },
    { item: "Outbox / CDC lag delaying scans", mitigation: "Alert on consumer lag; scanner autoscaling; sync Bloom-filter blocklist covers known bad domains." },
  ],

  followUps: [
    {
      question: "How would you support custom aliases?",
      answer: [
        "They share the namespace with generated codes, so a collision check is unavoidable: put-if-absent on alias.",
        "Keep aliases out of the generated keyspace: either a different length or prefix, or check generated codes don't collide with existing aliases (they can't if aliases are ≥ 8 chars or contain '-').",
        "Rate-limit and validate (reserved words, profanity, brand squatting).",
      ],
    },
    {
      question: "We now need click analytics. What changes?",
      answer: [
        "Never write analytics synchronously on the redirect path, since that would add latency and a dependency to every click.",
        "CDN logs plus origin access logs go into a stream (Kafka/Kinesis), then stream aggregation (Flink) into an OLAP store (ClickHouse/Druid).",
        "Edge-served hits appear only in CDN logs, so ingest those too. This is exactly why we chose 302.",
        "Counts are approximate (seconds to minutes delayed), which is fine for analytics.",
      ],
    },
    {
      question: "How do you handle 10× growth?",
      answer: [
        "Reads: CDN and cache scale horizontally and KV adds partitions, so it's mostly capacity work.",
        "Keyspace: 1B/day × 5 y = 1.8T, now ~50% of 62^7. Plan to move to 8 chars (62^8 ≈ 218T) for new links. Old links are unaffected.",
        "The allocator still gets only ~10 calls/s fleet-wide, which is fine.",
      ],
    },
    {
      question: "How do you prevent enumeration if someone reverse-engineers the scramble?",
      answer: [
        "The Feistel round keys are secret (in KMS), so without the key the output is computationally indistinguishable from random.",
        "Add a per-IP rate limit and anomaly detection on 404 bursts, since enumeration attempts mostly hit codes that don't exist.",
        "For truly sensitive links, offer longer codes or authenticated links.",
      ],
    },
    {
      question: "What if the KV store in a region becomes unavailable but the region is otherwise up?",
      answer: [
        "Hot reads keep working from CDN, L1 and Redis, which together cover ~90–99% of traffic.",
        "Cold misses can fall back to a cross-region read (higher latency, still correct).",
        "Writes fail over to another region via the LB/CDN origin group, or return 503 with Retry-After.",
      ],
    },
    {
      question: "How do you delete expired links at scale?",
      answer: [
        "Use native TTL (DynamoDB TTL / Cassandra TTL). It's lazy, possibly up to ~48 h, so the read path also checks expires_at.",
        "Cache TTL is min(24h, time until expiry), so expired links never stay cached past expiry.",
      ],
    },
  ],

  mistakes: [
    "Jumping straight to 'Cassandra + Kafka + Redis' before doing any numbers. Every component must answer a stated problem.",
    "Hashing the long URL and truncating without a collision strategy.",
    "Using a single global auto-increment counter: a SPOF, a hot spot, and enumerable.",
    "Choosing 301 without realising it gives up analytics, expiry and takedown.",
    "Using base64 with '+' and '/' (URL-unsafe), or picking 6 chars without checking that 62^6 < 182B.",
    "Missing that mappings are immutable, then over-engineering cache invalidation.",
    "Forgetting read-after-create: the creator's first click misses in another region or before the cache is filled.",
    "Writing analytics synchronously in the redirect path.",
    "Spending time on bandwidth, which is trivial here, instead of QPS skew and tail latency.",
  ],

  redFlags: [
    "No clarifying questions: the candidate assumes scale and requirements.",
    "Estimates that don't lead to decisions (numbers for their own sake).",
    "No alternatives discussed: 'we'll use Redis' with no why.",
    "Ignoring failure modes: what happens when the cache, a DB node, or a region dies.",
    "Claiming 'exactly-once' delivery from a queue without idempotency.",
  ],
};
