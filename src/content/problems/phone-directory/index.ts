import type { Problem } from "../../types";

/**
 * Phone Directory (caller-ID / reverse lookup, Truecaller-style)
 *
 * Narrative spine: a READ-dominated, KEY-VALUE lookup where the key is a phone number.
 *  - the number is a perfect partition key, once it is normalised (E.164)
 *  - a lot of lookups are for numbers we have never seen    -> a Bloom filter is worth more than a bigger cache
 *  - the phone is ringing                                     -> answer in <200 ms, or from the device itself
 *  - the data is crowdsourced and about real people           -> merging conflicting names and honouring deletion are the hard parts
 * Lookups are synchronous API calls. Contributions, index updates and opt-outs flow through a queue,
 * because nobody is waiting for them to finish.
 */
export const phoneDirectory: Problem = {
  slug: "phone-directory",
  title: "Phone Directory",
  tagline: "Who is calling? A phone-number lookup that must answer while the phone is still ringing",
  difficulty: "Medium",

  overview: {
    whatItIs:
      "A phone directory answers one question: given a phone number, who does it belong to? When an unknown number calls you, the app looks it up and shows a name (\"Dr. Rao, Apollo Clinic\") or a warning (\"Likely spam: reported 4,200 times\"). It can also work the other way, searching by name.",
    whatItDoes: [
      "Caller ID: names the person or business behind an incoming call or SMS.",
      "Spam and scam warnings: aggregates reports from millions of users into a score.",
      "Search: finds a number by name (and city) when you only know who you're looking for.",
      "Learns from its users: contacts, spam reports and business listings keep the data fresh.",
    ],
    whereUsed: [
      "Truecaller, Hiya and carrier spam-protection features",
      "Banking and fintech: caller verification (\"is this really my bank calling?\")",
      "Contact-centre software that pops up customer history when a call arrives",
      "Messaging apps and fraud systems that score unknown numbers",
    ],
    coreIdea:
      "It is a giant, read-heavy key-value store keyed by a normalised phone number. The design is about three things: answering in a few milliseconds (cache, Bloom filter, even on-device), keeping crowdsourced data trustworthy, and honouring a person's right to be removed.",
    notToBeConfusedWith: [
      { term: "Contacts app", difference: "Your own address book: private, small, and local. The directory is global and built from everyone's data." },
      { term: "Autocomplete / search engine", difference: "Search is a secondary feature here. 90% of traffic is exact lookup by number, which is a key-value read, not text search." },
      { term: "Telecom HLR / number registry", difference: "Carriers know which SIM owns a number but not who the person is. This system infers identity from crowdsourcing, so it's probabilistic and can be wrong." },
    ],
  },

  // ───────────────────────────── Stage 1 — Understand ─────────────────────────────
  interviewQuestion:
    "Design a phone directory service. Given a phone number, return who it belongs to and whether it's likely spam. Users can also search by name, and can contribute or correct information. It has to work at the scale of hundreds of millions of users.",

  clarifyingQuestions: [
    {
      question: "Is the main use reverse lookup (number → name), forward search (name → number), or both?",
      whyItMatters:
        "They are different data structures. Reverse lookup is an exact-match key-value read. Forward search is text search with ranking. Treating them as one problem leads to the wrong database.",
      answer: "Mostly reverse lookup, around 90% of traffic. Name search exists but is a secondary feature.",
      designImpact:
        "The core is a key-value store partitioned by number. Name search becomes a separate index, kept off the critical path and fed asynchronously.",
    },
    {
      question: "How fast does a lookup need to be, and where is it shown?",
      whyItMatters:
        "Caller ID is displayed while the phone rings. There's a window of maybe 1–2 seconds, and an answer after the user picks up is worthless. The latency target decides whether a network call is even allowed.",
      answer: "Under 200 ms end to end at p99. If we can't answer in time, show nothing rather than something late.",
      designImpact:
        "Edge-friendly APIs, aggressive caching, and an on-device cache for the hottest numbers, so some lookups never leave the phone.",
    },
    {
      question: "Where does the data come from, and how much do we trust it?",
      whyItMatters:
        "Crowdsourced data is noisy, and different users label the same number differently (\"Mom\", \"Sunita\", \"Sunita Sharma\"). Trust and conflict resolution become a core part of the design.",
      answer: "Uploaded contacts, spam reports and verified business listings. Names are inferred from many sources, never taken from one.",
      designImpact:
        "We store aggregated evidence (name variants with counts, spam votes), not a single string. A merge step with reputation weighting decides what is shown.",
    },
    {
      question: "What's the scale: users, numbers, lookups per day?",
      whyItMatters:
        "It sets the shape of the store, whether the working set fits in RAM, and how many shards we need.",
      answer: "500M daily active users, about 3 billion distinct numbers, roughly 10 lookups per user per day.",
      designImpact:
        "About 175K lookups/s at peak and ~1.5 TB of data. That is too much for one machine, and too much to hold fully in RAM at a sane price, so a cache plus a sharded store.",
    },
    {
      question: "Are there privacy or legal constraints? Can someone ask to be removed?",
      whyItMatters:
        "This system stores personal data about people who never signed up. Deletion rights (GDPR, DPDP) apply, and a deletion that doesn't reach the cache, the index and the on-device snapshots isn't a deletion.",
      answer: "Yes. Opt-out must be honoured within 30 days. We never reveal raw uploaded contacts, only an aggregated name with enough supporting reports.",
      designImpact:
        "Deletion is a first-class write path that must fan out to every copy of the data. Display requires a minimum number of independent sources (k-anonymity).",
    },
    {
      question: "How should numbers be matched across formats and countries?",
      whyItMatters:
        "'+1 415 555 0100', '(415) 555-0100' and '4155550100' are the same number. If two spellings produce two keys, a lookup finds nothing and half the reports are lost.",
      answer: "Any input format, any country. Assume the app knows the user's country.",
      designImpact:
        "Normalise everything to E.164 (+14155550100) at the edge, at both read and write time, with the user's country as the default region. This is a correctness requirement, not a detail.",
    },
    {
      question: "How quickly must a newly reported spam number be flagged?",
      whyItMatters:
        "'Immediately' needs a synchronous write path. 'Within minutes' allows a queue and batching, which is far cheaper.",
      answer: "A few minutes is fine.",
      designImpact:
        "Reports go through an asynchronous pipeline, so lookups never wait on writes. Eventual consistency is acceptable and keeps the read path fast.",
    },
  ],

  requirements: {
    functional: [
      "Lookup: given any phone number, return the best-known name, spam score and category, or 'unknown'.",
      "Search: find numbers by name (with optional city / country filter).",
      "Contribute: users can upload contacts, report spam, and suggest corrections.",
      "Opt-out: a verified owner can have their number removed from the directory.",
    ],
    nonFunctional: [
      { name: "Lookup latency", target: "p99 < 200 ms end to end; < 20 ms server-side", why: "The phone is ringing. Late data is useless." },
      { name: "Availability (lookup)", target: "99.99%, and graceful degradation to on-device data", why: "A broken lookup just means 'unknown caller', but it's a visible loss of the product's main value." },
      { name: "Throughput", target: "175K lookups/s peak, ~10K writes/s peak", why: "From 500M DAU × 10 lookups a day, with a 3× peak factor." },
      { name: "Freshness", target: "New reports reflected within ~5 minutes", why: "Spam campaigns run for hours; minutes of lag is acceptable." },
      { name: "Privacy / compliance", target: "Opt-out honoured everywhere within 30 days; deletion is auditable", why: "Legal requirement, and the product's trust depends on it." },
      { name: "Accuracy", target: "Spam false-positive rate < 0.1% of legitimate numbers", why: "Marking a hospital or a bank as spam does real harm." },
    ],
    outOfScope: [
      "Blocking or screening calls (needs OS-level integration)",
      "Real-time call-quality or SIM verification from the carrier",
      "Social features, messaging, payments",
      "Voice and ML-based scam detection (a follow-up)",
    ],
  },

  // ───────────────────────────── Stage 2 — Size ─────────────────────────────
  estimates: [
    {
      title: "Lookup throughput",
      reasoning: [
        "500M DAU × 10 lookups/day = 5B lookups/day",
        "5B ÷ 86,400 s ≈ 58K/s average",
        "Peak (evenings, 3× average) ≈ 175K/s",
      ],
      result: "≈ 175K lookups/s at peak",
      soWhat:
        "This is a read-dominated key-value workload. One database can't take 175K/s with a 20 ms budget, so the design needs a cache in front and a sharded store behind it.",
    },
    {
      title: "Storage",
      reasoning: [
        "3B distinct numbers",
        "Per number: normalised key (8 B) + up to 5 name variants with counts (~250 B) + spam votes, category, country, timestamps (~150 B) ≈ 500 B",
        "3B × 500 B = 1.5 TB; × 3 replicas = 4.5 TB",
      ],
      result: "≈ 1.5 TB of data, ≈ 4.5 TB with replication",
      soWhat:
        "Too big for one comfortable node and too expensive to keep fully in RAM. A SSD-backed key-value store partitioned by number, with a RAM cache for the hot set.",
    },
    {
      title: "Hot set and cache sizing",
      reasoning: [
        "Traffic is highly skewed: spam numbers, banks, delivery services and big businesses get called by millions",
        "Assume the top 1% of numbers (30M) draw ~60% of lookups",
        "30M × 500 B = 15 GB. It fits in one small Redis cluster.",
        "60% hit rate leaves 175K × 0.4 = 70K/s going to the store",
      ],
      result: "15 GB cache absorbs ~60% of reads",
      soWhat:
        "A cache is cheap and effective, but 70K/s still reaches the database, and the long tail (random personal numbers) will never cache well. We need something that helps the tail.",
    },
    {
      title: "Unknown-number lookups",
      reasoning: [
        "About 30% of lookups are for numbers we've never seen (a new SIM, a private individual)",
        "A cache can't help: there's nothing to cache. These miss, then hit the database, then find nothing.",
        "Bloom filter for 3B numbers at 1% false positives needs ≈ 9.6 bits each = 3.6 GB",
      ],
      result: "30% of lookups are definitely-absent; a 3.6 GB Bloom filter answers them in memory",
      soWhat:
        "A Bloom filter turns the most wasteful database reads (guaranteed misses) into a memory lookup with no network hop. It removes another ~30% of the load that survives the cache.",
    },
    {
      title: "Write volume",
      reasoning: [
        "Contributions: spam reports, contact uploads, corrections ≈ 200M events/day",
        "200M ÷ 86,400 ≈ 2.3K/s average, ~10K/s peak",
        "That's ~5% of the lookup rate, and the freshness target is minutes",
      ],
      result: "≈ 10K writes/s at peak",
      soWhat:
        "Writes are tiny next to reads, and nobody waits for them. We can buffer, batch and merge them through a queue instead of writing to the store on the request path.",
    },
    {
      title: "On-device snapshot",
      reasoning: [
        "The top 5M spam/business numbers cover ~50% of lookups",
        "Per entry: number hash (8 B) + score and category (4 B) + label ref (8 B) ≈ 20 B",
        "5M × 20 B = 100 MB. A daily delta is ~2% ≈ 2 MB.",
      ],
      result: "100 MB initial snapshot, ~2 MB daily updates",
      soWhat:
        "Half of all lookups can be answered on the phone with zero network latency and zero server cost, and they keep working offline. This is the cheapest lookup there is: the one we never serve.",
    },
  ],

  // ───────────────────────────── Stage 3 — Start simple ─────────────────────────────
  api: [
    {
      method: "GET",
      path: "/v1/lookup?number=+14155550100",
      response: '{ "number": "+14155550100", "name": "Apollo Clinic", "category": "healthcare", "spamScore": 0.02, "confidence": 0.93 }',
      notes: "The hot path. A number that isn't found returns 200 with name=null (not 404), so callers don't treat 'unknown' as an error. Confidence lets the UI decide how strongly to display it.",
    },
    {
      method: "GET",
      path: "/v1/search?q=sunita+sharma&city=pune",
      response: '{ "results": [ { "number": "+9198…", "name": "Sunita Sharma", "city": "Pune" } ], "next": "…" }',
      notes: "Secondary feature. Paginated and country-scoped. Never exposes numbers that haven't met the minimum-source threshold.",
    },
    {
      method: "POST",
      path: "/v1/reports",
      request: '{ "number": "+14155550100", "type": "SPAM", "category": "telemarketing" }',
      response: "202 Accepted { reportId }",
      notes: "Returns 202 immediately. The report is queued and merged later, so the user's app is never blocked by directory processing.",
    },
    {
      method: "DELETE",
      path: "/v1/numbers/{number}  (OTP-verified)",
      response: "202 Accepted { requestId, deadline }",
      notes: "Opt-out. The owner proves control of the number with an OTP. The response is a receipt: the actual deletion fans out asynchronously and is audited.",
    },
  ],

  communication: {
    rule:
      "A person waiting on a screen (or a ringing phone) needs a synchronous API. Anything that can finish a few minutes later and needs to reach several stores goes on a queue. Lookups are the first kind. Contributions, index updates and deletions are the second.",
    choices: [
      {
        interaction: "App → directory: 'who is this number?'",
        style: "sync-api",
        why: "The user is looking at a ringing phone. The answer has to come back in the same request, in under 200 ms.",
        ifWrong: "Publishing a lookup request to a queue and waiting for a reply adds broker latency and a reply-queue per client, and still blocks. It is a slower RPC with extra failure modes.",
      },
      {
        interaction: "App → directory: name search",
        style: "sync-api",
        why: "An interactive query with a visible result list. The user is waiting, though a slightly looser latency budget (~500 ms) is fine.",
        ifWrong: "There is nothing to put on a queue. A search needs an answer, and polling for results would only add latency.",
      },
      {
        interaction: "App → directory: submit spam report / contacts",
        style: "async-queue",
        why: "The app only needs to know 'received'. Merging, reputation weighting and updating three stores happen later. A queue absorbs spam-campaign spikes and lets us batch.",
        ifWrong: "Writing to the store, the cache and the search index synchronously makes the user's request as slow as the slowest of the three, and a search-cluster hiccup fails the report.",
      },
      {
        interaction: "Merge worker → cache / search index / store",
        style: "async-queue",
        why: "Several independent consumers each apply the same change. Eventual consistency (minutes) is within the requirement, and a slow index must not hold up the store.",
        ifWrong: "Dual or triple writes from the API create partial updates: the store says 'spam', the index still says 'Dr Rao'. A single ordered stream keeps every copy converging.",
      },
      {
        interaction: "Server → device: snapshot of top spam numbers",
        style: "hybrid",
        why: "The device pulls a delta over plain HTTP from a CDN on a schedule (a sync call from the device's view). The server prepares it asynchronously in batches. Nobody waits for it at call time.",
        ifWrong: "Pushing every change to 500M devices is a fan-out nightmare. Pull-from-CDN scales for free.",
      },
      {
        interaction: "Owner → opt-out request",
        style: "hybrid",
        why: "The request itself (verify by OTP, record a receipt) is a synchronous API call that gives the user a confirmation. The removal from cache, index and snapshots is asynchronous with a deadline and an audit trail.",
        ifWrong: "Fully synchronous deletion couples the user's request to every copy of the data. Fully async without a receipt leaves no proof for a regulator.",
      },
    ],
  },

  dataModel: [
    {
      entity: "number_profile",
      fields: [
        { name: "number", type: "STRING (E.164)", note: "partition key, e.g. +14155550100" },
        { name: "names", type: "MAP<name, {count, weightedScore}>", note: "up to ~5 variants, kept as evidence" },
        { name: "display_name", type: "STRING NULL", note: "chosen by the merge step; null until k independent sources agree" },
        { name: "spam_votes / ham_votes", type: "INT", note: "reputation-weighted tallies" },
        { name: "category", type: "ENUM", note: "business, spam, scam, personal…" },
        { name: "country", type: "CHAR(2)" },
        { name: "last_seen_at", type: "TIMESTAMP", note: "drives decay: numbers get recycled by carriers" },
        { name: "tombstone", type: "BOOL", note: "opted-out; block all writes and reads" },
      ],
      accessPatterns: [
        "Get by number (≈ 90% of traffic): single-partition point read",
        "Upsert aggregated profile from the merge worker",
        "No scans on the hot path; name search uses a separate index",
      ],
      insight:
        "We store evidence (names with counts, votes), not a single string. This lets the merge step re-derive a display name when new reports arrive without re-reading raw reports, and it makes 'why does it say that?' answerable.",
    },
    {
      entity: "report (append-only)",
      fields: [
        { name: "reportId", type: "UUID" },
        { name: "number", type: "STRING (E.164)" },
        { name: "reporter", type: "HASHED user id", note: "for dedupe and reputation, never exposed" },
        { name: "type / category / suggestedName", type: "…" },
        { name: "createdAt", type: "TIMESTAMP" },
      ],
      accessPatterns: [
        "Append only, consumed from the queue by the merge worker",
        "Dedupe check: has this reporter already voted on this number?",
      ],
      insight:
        "Raw reports are an input stream, not a serving table. Keeping them append-only gives us an audit trail and lets us recompute profiles if we change the merge rules.",
    },
  ],

  v1: {
    title: "v1: one server, one Postgres table",
    description: [
      "A single app server in front of PostgreSQL with a table phone(number PRIMARY KEY, name, spam_votes).",
      "Lookup: SELECT by number. Report: UPDATE spam_votes = spam_votes + 1.",
      "Perfectly fine for 100K users and a few hundred lookups a second. Every component added after this has to fix a specific failure of this version.",
    ],
    diagram: {
      nodes: [
        { id: "client", label: "Client app", sub: "caller-ID screen", kind: "client", x: 0, y: 200 },
        { id: "api", label: "App server", sub: "single instance", kind: "service", x: 660, y: 200 },
        { id: "db", label: "PostgreSQL", sub: "single primary", kind: "db", x: 990, y: 300 },
      ],
      edges: [
        { id: "client-api", from: "client", to: "api", label: "HTTPS" },
        { id: "api-db", from: "api", to: "db", label: "SQL" },
      ],
    },
    whatBreaksFirst: [
      "The single app server: one process can't do 175K lookups/s, and it's a single point of failure.",
      "Numbers aren't normalised, so '+1 415…' and '415…' are different rows and half the reports are lost.",
      "Then the database: 1.5 TB and 175K point reads/s don't fit on one primary, and 30% of those reads find nothing at all.",
      "Then writes: UPDATE spam_votes = spam_votes + 1 on a viral spam number is a hot row that every writer queues behind.",
    ],
  },

  // ───────────────────────────── Stage 4 — Evolve ─────────────────────────────
  evolution: [
    {
      version: "v2",
      title: "Stateless API tier behind a load balancer, with normalisation at the edge",
      problem: "One server can't serve 175K lookups/s, and the same number arrives in many formats, so lookups miss and reports scatter.",
      evidence: "175K/s ÷ ~8K/s per instance ≈ 22 servers before headroom. In a sample of 1M reports, the same number appeared in 6 distinct spellings, so counts were split across rows.",
      options: [
        {
          name: "Vertical scaling plus normalise on write only",
          pros: ["No architectural change"],
          cons: ["Hard ceiling and a single point of failure", "A lookup in a different format than the stored one still misses"],
          verdict: "Lost: capacity and correctness are both broken.",
        },
        {
          name: "Normalise in the client app only",
          pros: ["Zero server cost"],
          cons: ["Old app versions and third-party clients send raw strings", "Can't trust client input"],
          verdict: "Lost as the only line of defence. Fine as an optimisation.",
        },
        {
          name: "Stateless servers behind an L7 LB, normalising every number to E.164 on read and write",
          pros: ["Horizontal scale and zero-downtime deploys", "One canonical key everywhere", "libphonenumber handles country rules"],
          cons: ["Needs a default region to interpret local-format numbers", "Ambiguous inputs must be rejected, not guessed"],
          verdict: "Chosen: every other decision (sharding, caching, Bloom filters) assumes there is exactly one key per number.",
          chosen: true,
        },
      ],
      decision:
        "Run N stateless API servers across 3 AZs behind a managed L7 load balancer. The first step of every request is normalisation to E.164 using the user's country as the default region. Invalid numbers are rejected with 400.",
      newRisks: [
        { risk: "Normalisation bugs silently split or merge numbers.", mitigation: "Use a maintained library (libphonenumber), pin its version, and run the same code on read and write paths. Keep a corpus of tricky numbers in tests." },
        { risk: "The load balancer sits on every request.", mitigation: "Managed multi-AZ LB, health-checked." },
      ],
      sayIt:
        "Two things first. The API is stateless, so I scale it behind a load balancer. And everything is normalised to E.164 at the edge, because the number is our partition key, and if one number has six spellings, every later optimisation silently breaks.",
      delta: {
        addNodes: [{ id: "lb", label: "Load balancer", sub: "L7, multi-AZ", kind: "lb", x: 330, y: 200 }],
        updateNodes: [{ id: "api", label: "API servers", sub: "stateless × N · normalise to E.164" }],
        removeEdges: ["client-api"],
        addEdges: [
          { id: "client-lb", from: "client", to: "lb", label: "HTTPS" },
          { id: "lb-api", from: "lb", to: "api" },
        ],
      },
    },
    {
      version: "v3",
      title: "Replace Postgres with a sharded key-value store",
      problem: "1.5 TB of data and tens of thousands of point reads per second don't fit one primary, and hot rows contend on writes.",
      evidence: "3B rows × 500 B = 1.5 TB (4.5 TB with replicas). A Postgres primary tops out at ~20K simple reads/s and gets painful beyond ~1 TB per node. Hot numbers take thousands of UPDATEs/s on a single row.",
      options: [
        {
          name: "Postgres with read replicas",
          pros: ["Familiar", "SQL for ad-hoc analysis"],
          cons: ["Replicas each hold all 1.5 TB", "Doesn't solve write contention on hot rows", "Replica lag breaks read-after-report"],
          verdict: "Lost: it scales reads with cost proportional to data size, and does nothing for the data size itself.",
        },
        {
          name: "Postgres sharded by number in the application",
          pros: ["Keeps SQL"],
          cons: ["Resharding is manual and risky", "Cross-shard operations are painful", "We'd be building a worse Cassandra"],
          verdict: "Lost: we have a pure key-value workload and no joins, so we'd pay for relational features we don't use.",
        },
        {
          name: "Distributed KV / wide-column store (Cassandra, DynamoDB), partitioned by number",
          pros: ["Linear scale-out by adding nodes", "Point reads in a few ms", "Replication and multi-AZ built in", "No cross-shard queries needed"],
          cons: ["No ad-hoc queries or joins", "Eventual consistency by default", "Hot partitions need care"],
          verdict: "Chosen: the only access pattern is 'get/put by number', which this model does best.",
          chosen: true,
        },
      ],
      decision:
        "Move number_profile to a partitioned KV store, with the E.164 number as the partition key, replicated 3× across AZs. Counters (spam_votes) become aggregated values written by one merge worker, not incremented by every request.",
      newRisks: [
        { risk: "Eventual consistency: a report may not be visible for a moment.", mitigation: "Acceptable by requirement (minutes). Use quorum reads only where it matters." },
        { risk: "Hot partitions for viral spam numbers.", mitigation: "Reads are absorbed by the cache (next step), writes are batched by the merge worker (v5)." },
        { risk: "Lost SQL for analytics.", mitigation: "Export to a warehouse via the event stream; don't query the serving store for analytics." },
      ],
      sayIt:
        "The workload is get-and-put by one key with no joins, which is what a partitioned KV store is for. I'd shard by the normalised number, replicate across AZs, and push analytics to a separate pipeline so I never need SQL on the serving path.",
      delta: {
        updateNodes: [{ id: "db", label: "KV store", sub: "Cassandra / Dynamo · by number · RF=3" }],
      },
    },
    {
      version: "v4",
      title: "Cache the hot numbers and add a Bloom filter for the unknown ones",
      problem: "Even with a KV store, 70K reads/s hit it. Many are for the same spam numbers, and 30% are for numbers that don't exist at all.",
      evidence: "Top 1% of numbers = ~60% of lookups. ~30% of lookups find nothing. Both are wasted database work: one repeats, the other can never succeed.",
      options: [
        {
          name: "Scale the KV store further",
          pros: ["No new components"],
          cons: ["Pays storage-grade prices for a skewed, repeating workload", "Still does disk work for guaranteed misses"],
          verdict: "Lost: the cheapest read is the one the store never sees.",
        },
        {
          name: "Cache only (Redis, cache-aside)",
          pros: ["15 GB serves ~60% of reads", "Millisecond latency"],
          cons: ["Doesn't help unknown numbers (nothing to cache)", "Caching 'not found' for random numbers wastes memory on a huge tail"],
          verdict: "Necessary but not enough.",
        },
        {
          name: "Cache for hits + Bloom filter for 'definitely not present'",
          pros: ["The filter answers 30% of lookups in-process with no network", "It's tiny (3.6 GB vs 1.5 TB)", "Zero false negatives, so we never miss a real number"],
          cons: ["~1% false positives (they just fall through to the store)", "Filters can't delete, so rebuild periodically", "Must be updated when new numbers arrive"],
          verdict: "Chosen: the two attack different parts of the load. The cache handles repeats and the filter handles absences.",
          chosen: true,
        },
      ],
      decision:
        "Put a Redis cache (cache-aside, ~15 GB, TTL of an hour) in front of the KV store. Each API server also loads a Bloom filter of all known numbers, rebuilt nightly and extended with newly added numbers. The lookup order is filter → cache → store.",
      newRisks: [
        { risk: "A popular key expires and thousands of requests hit the store at once.", mitigation: "Per-key request coalescing (single-flight) and jittered TTLs. See the stampede flow." },
        { risk: "A stale cache serves an old name or spam score.", mitigation: "The merge worker refreshes or evicts the key on change. A short TTL bounds the damage." },
        { risk: "A 3.6 GB Bloom filter on every API server is a lot of memory.", mitigation: "Partition filters by country and load only the countries each region serves." },
      ],
      sayIt:
        "Traffic is heavily skewed and a third of lookups are for numbers we've never seen. So: a cache for the repeats and a Bloom filter for the absences. A filter answers 'definitely not here' from memory for 30% of traffic, which a cache can't do, and it has no false negatives.",
      delta: {
        addNodes: [{ id: "cache", label: "Cache", sub: "Redis Cluster ~15 GB", kind: "cache", x: 990, y: 40 }],
        updateNodes: [{ id: "api", sub: "stateless × N · E.164 · Bloom filter" }],
        addEdges: [{ id: "api-cache", from: "api", to: "cache", label: "GET number" }],
      },
    },
    {
      version: "v5",
      title: "Contributions through a queue and a merge worker",
      problem: "Reports are written straight to the store. A spam campaign hammers a hot partition, there's no dedupe, and one user can vote a hundred times.",
      evidence: "10K writes/s at peak with heavy skew: one viral spam number can get thousands of reports a minute. Without dedupe, a single bot can push any number's spam score to 100%.",
      options: [
        {
          name: "API writes directly to the store",
          pros: ["Simplest", "Immediately visible"],
          cons: ["Hot-partition write contention", "Nowhere to put dedupe or reputation logic", "The user's request is as slow as the store"],
          verdict: "Lost: writes need processing (dedupe, weighting, merge), not just storage.",
        },
        {
          name: "API writes synchronously to store, cache and index",
          pros: ["Everything updates at once"],
          cons: ["Partial failures leave copies inconsistent", "Latency is the sum of three systems"],
          verdict: "Lost: this is a distributed transaction you didn't mean to build.",
        },
        {
          name: "API appends to a queue (202 Accepted); a merge worker consumes, dedupes, merges and writes",
          pros: ["Absorbs spikes", "Batching: one write per number per interval", "A single place for dedupe and reputation rules", "Replayable if merge rules change"],
          cons: ["Eventual consistency (seconds to minutes)", "At-least-once delivery means duplicates", "One more system to operate"],
          verdict: "Chosen: nobody is waiting for the merge, so async is a strict win.",
          chosen: true,
        },
      ],
      decision:
        "POST /reports validates input and publishes ReportSubmitted to a partitioned queue (keyed by number), returning 202. A consumer group merges reports per number: dedupe by (reporter, number, type), apply reporter reputation weights, recompute the profile, write the KV store once, and refresh the cache entry.",
      newRisks: [
        { risk: "Duplicate deliveries double-count votes.", mitigation: "Idempotent processing: a dedupe key of (reporter, number, type) with a TTL, and aggregates rebuilt from distinct reporters, not incremented." },
        { risk: "Coordinated brigading marks a legitimate number as spam.", mitigation: "Reputation weighting, per-reporter rate limits and a high threshold. See the merge deep dive." },
        { risk: "Queue lag delays spam flagging.", mitigation: "Alert on consumer lag. Within-minutes freshness is the SLO, so a few minutes of lag is tolerable." },
      ],
      sayIt:
        "A report isn't a write to a table, it's evidence that has to be deduped and weighted. So the API acknowledges with 202 and drops it on a queue keyed by number, and a merge worker turns many reports into one profile update. That also protects us from hot-partition writes during a spam campaign.",
      delta: {
        addNodes: [
          { id: "queue", label: "Report queue", sub: "Kafka, keyed by number", kind: "queue", x: 1320, y: 200 },
          { id: "ingest", label: "Merge worker", sub: "dedupe · weight · merge", kind: "worker", x: 1650, y: 200 },
        ],
        addEdges: [
          { id: "api-queue", from: "api", to: "queue", label: "report (202)", async: true },
          { id: "queue-ingest", from: "queue", to: "ingest", label: "consume", async: true },
          { id: "ingest-db", from: "ingest", to: "db", label: "upsert profile" },
          { id: "ingest-cache", from: "ingest", to: "cache", label: "refresh key", async: true },
        ],
      },
    },
    {
      version: "v6",
      title: "Name search: a separate index fed by the same stream",
      problem: "Search by name needs prefix and fuzzy matching, which a key-value store keyed by number cannot do.",
      evidence: "A KV store answers 'get by number' only. 'sunita sharma pune' would be a full scan of 3B rows. Running LIKE queries on the serving store would crush the lookups that pay the bills.",
      options: [
        {
          name: "Secondary index inside the KV store",
          pros: ["No new system"],
          cons: ["Wide-column stores are poor at text matching", "Index writes inflate every profile update", "Search load competes with lookups"],
          verdict: "Lost: it mixes a text workload into the system that must stay fast.",
        },
        {
          name: "Query the database with LIKE / full scan",
          pros: ["Zero extra components"],
          cons: ["Unusable at 3B rows"],
          verdict: "Lost.",
        },
        {
          name: "Dedicated search cluster (Elasticsearch/OpenSearch), updated asynchronously from the merge worker",
          pros: ["Tokenisation, prefix and fuzzy matching, ranking", "Sharded by country", "Isolates search load from lookups"],
          cons: ["Eventually consistent with the store", "Another cluster to run", "Must also honour deletions"],
          verdict: "Chosen: it's the right tool for text, and the lookups never depend on it.",
          chosen: true,
        },
      ],
      decision:
        "Add a search cluster, sharded by country. The merge worker writes to the KV store first, then indexes the number (only if display_name has met the k-source threshold). Search is a separate API path that never touches the lookup cache.",
      newRisks: [
        { risk: "Index and store drift apart.", mitigation: "The store is the source of truth. The index is rebuildable from it, and a periodic reconciliation job repairs gaps." },
        { risk: "Deleted (opted-out) numbers stay searchable.", mitigation: "The opt-out flow must delete the index document too, and is verified by audit (see the opt-out flow)." },
        { risk: "Search enables enumeration, harvesting names and numbers in bulk.", mitigation: "Rate-limit per user, cap results, require a verified account, and only index entries above the confidence threshold." },
      ],
      sayIt:
        "Search by name is a different workload, so it gets a different system. The merge worker feeds an Elasticsearch cluster sharded by country, asynchronously. The key-value store stays the source of truth, and lookups never depend on search being up.",
      delta: {
        addNodes: [{ id: "search", label: "Search index", sub: "Elasticsearch · by country", kind: "db", x: 990, y: 500 }],
        addEdges: [
          { id: "api-search", from: "api", to: "search", label: "name query" },
          { id: "ingest-search", from: "ingest", to: "search", label: "index doc", async: true },
        ],
      },
    },
    {
      version: "v7",
      title: "On-device snapshot: answer half the lookups without the network",
      problem: "A network round trip, however well optimised, can miss the 200 ms window on a poor connection. Roaming and offline users get nothing.",
      evidence: "Mobile p99 round trip is 300–800 ms on weak networks. The top 5M numbers cover ~50% of lookups but weigh only 100 MB.",
      options: [
        {
          name: "Optimise the server path further",
          pros: ["No client changes"],
          cons: ["The network is the unfixable part", "Doesn't help offline users"],
          verdict: "Lost: we're already at ~15 ms server-side. The remaining latency is the radio.",
        },
        {
          name: "Push updates to every device",
          pros: ["Freshest data"],
          cons: ["500M-device fan-out", "Needs a persistent connection per device"],
          verdict: "Lost: the cost and complexity don't match a 'minutes' freshness target.",
        },
        {
          name: "Daily-built snapshot on a CDN; devices pull deltas on Wi-Fi",
          pros: ["Costs almost nothing per user", "Works offline", "The CDN absorbs the 500M-device fan-out", "Deltas are ~2 MB"],
          cons: ["Data on the phone is up to a day stale", "Deletions must reach the next snapshot", "Phone storage and privacy concerns"],
          verdict: "Chosen: it takes the highest-value lookups completely off our servers.",
          chosen: true,
        },
      ],
      decision:
        "A snapshot builder job reads the highest-ranked numbers from the KV store each night, produces a compact (hashed) snapshot plus daily deltas, and publishes them to object storage behind a CDN. Devices download deltas and answer from the local snapshot first, going to the API only on a miss.",
      newRisks: [
        { risk: "Opted-out or corrected numbers linger on devices for up to a day.", mitigation: "Deltas carry tombstones. Short snapshot validity (e.g. 7 days) forces periodic refresh." },
        { risk: "A 100 MB local database is a privacy and extraction target.", mitigation: "Store hashed numbers and category/score only, with names fetched on demand for confirmed matches." },
      ],
      sayIt:
        "The last 100 ms is the mobile network, which I can't fix on the server. So the hottest 5 million numbers, about 100 MB, ship to the device as a nightly snapshot with daily deltas through a CDN. Half of lookups never leave the phone and keep working offline.",
      delta: {
        addNodes: [
          { id: "snap", label: "Snapshot builder", sub: "nightly batch + deltas", kind: "worker", x: 1320, y: 400 },
          { id: "cdn", label: "CDN / object store", sub: "snapshot + deltas", kind: "edge", x: 330, y: 420 },
        ],
        updateNodes: [{ id: "client", sub: "on-device snapshot (top 5M)" }],
        addEdges: [
          { id: "snap-db", from: "snap", to: "db", label: "scan top numbers" },
          { id: "snap-cdn", from: "snap", to: "cdn", label: "publish", async: true },
          { id: "client-cdn", from: "client", to: "cdn", label: "pull delta" },
        ],
      },
    },
  ],

  // ───────────────────────────── Stage 5 — Flows ─────────────────────────────
  flows: [
    {
      id: "lookup-hit",
      name: "Lookup: cache hit",
      kind: "read",
      summary: "The common case: a known number answered from memory in a few milliseconds.",
      hops: [
        { from: "client", to: "lb", label: "GET /lookup?number=0415…", narration: "The phone is ringing and the app asks who it is. The number is in whatever local format the carrier supplied.", why: "The request fires the moment the call arrives, so every millisecond counts." },
        { from: "lb", to: "api", label: "route to a healthy server", narration: "The load balancer picks any API server.", why: "The servers are stateless, so any of them can answer." },
        { from: "api", label: "normalise → +14155550100; Bloom: maybe present", narration: "The server converts to E.164 using the user's country, then asks its Bloom filter.", why: "One canonical key everywhere. The filter says 'maybe present', so we continue." },
        { from: "api", to: "cache", label: "GET +14155550100", narration: "The cache has the profile.", why: "Skewed traffic means the numbers people look up most are the ones in the cache." },
        { from: "cache", to: "api", label: "hit: Apollo Clinic, spam 0.02", narration: "The profile comes back.", why: "A hit costs under a millisecond. The store is never touched." },
        { from: "api", to: "lb", label: "200 {name, score}", narration: "The server builds a small JSON response.", why: "A tiny payload because it's displayed on a ringing screen." },
        { from: "lb", to: "client", label: "200 OK", narration: "The app shows the name.", why: "End to end, well under 200 ms." },
      ],
      takeaway: "The hot path is: normalise, Bloom check, cache read. The store is only involved when the cache misses.",
    },
    {
      id: "lookup-miss",
      name: "Lookup: cache miss, falls to the store",
      kind: "read",
      summary: "A long-tail number not in the cache. One store read, then the result is cached for next time.",
      hops: [
        { from: "client", to: "lb", label: "GET /lookup?number=…", narration: "A less-common number is looked up.", why: "Most numbers are in the long tail and won't be cached yet." },
        { from: "lb", to: "api", label: "route", narration: "The load balancer forwards the request.", why: "Stateless, so any server works." },
        { from: "api", label: "normalise; Bloom: maybe present", narration: "Normalised, and the filter says the number might exist.", why: "A 'maybe' is the only case where the store is worth asking." },
        { from: "api", to: "cache", label: "GET → miss", narration: "The cache has no entry.", why: "Cache-aside: we check the cache first and fill it on a miss." },
        { from: "api", to: "db", label: "GET profile by number", narration: "A single-partition read in the KV store.", why: "Partition key = number, so it's one node and a few milliseconds." },
        { from: "db", to: "api", label: "profile", narration: "The store returns the aggregated profile.", why: "It has the evidence: name variants, votes, category." },
        { from: "api", to: "cache", label: "SET (TTL 1h ± jitter)", narration: "The result is cached for later lookups.", why: "Jittered TTL stops many entries from expiring in the same instant." },
        { from: "api", to: "lb", label: "200 OK", narration: "The server returns the profile.", why: "Even a miss completes in ~20 ms server-side." },
        { from: "lb", to: "client", label: "200 OK", narration: "The load balancer relays it to the app.", why: "The app shows the name before the user picks up." },
      ],
      takeaway: "A miss costs one extra store read and warms the cache. The cost is paid once per number per hour, not once per lookup.",
    },
    {
      id: "unknown",
      name: "Lookup: a number we've never seen",
      kind: "read",
      summary: "The Bloom filter answers 'definitely not here' from memory, with no network call.",
      hops: [
        { from: "client", to: "lb", label: "GET /lookup?number=+447…", narration: "A number that has never been reported.", why: "30% of lookups look like this." },
        { from: "lb", to: "api", label: "route", narration: "The load balancer forwards the request.", why: "Stateless, so any server works." },
        { from: "api", label: "normalise; Bloom: DEFINITELY ABSENT", narration: "The filter has no false negatives. If it says absent, the number isn't in the store.", why: "In-process, nanoseconds. The cache and store are never touched." },
        { from: "api", to: "lb", label: "200 {name: null}", narration: "An 'unknown' result is a normal response, not a 404.", why: "Clients treat 404 as an error and retry. Unknown is a legitimate answer." },
        { from: "lb", to: "client", label: "200 OK", narration: "The app shows 'unknown caller'.", why: "Answered without any network hop behind the API server." },
      ],
      takeaway: "The cheapest lookup is the one answered by a data structure in RAM. A Bloom filter turns our most wasteful database reads into free ones.",
    },
    {
      id: "device-sync",
      name: "On-device lookup and snapshot refresh",
      kind: "read",
      summary: "Half the lookups are answered on the phone; the snapshot refreshes in the background.",
      hops: [
        { from: "snap", to: "db", label: "scan top 5M by lookup volume", narration: "Nightly, the builder reads the highest-ranked numbers and anything changed since the last build.", why: "Only the hot head is shipped. The tail stays on the server." },
        { from: "snap", to: "cdn", label: "publish snapshot v412 + delta", narration: "Compact files are uploaded to object storage behind the CDN.", why: "The CDN absorbs a 500M-device fan-out at near-zero marginal cost.", async: true },
        { from: "client", to: "cdn", label: "pull delta (Wi-Fi, nightly)", narration: "The app downloads about 2 MB of changes, including tombstones for removed numbers.", why: "Pull instead of push: no persistent connections, no per-device state." },
        { from: "client", label: "incoming call → local hash lookup → hit", narration: "When a call arrives, the app checks its local snapshot first.", why: "Zero network and works offline. On a miss the app falls back to the API." },
      ],
      takeaway: "The best optimisation for a latency-bound lookup is moving the data to where the question is asked.",
    },
    {
      id: "search",
      name: "Search by name",
      kind: "read",
      summary: "A separate path to a separate system, so text queries never compete with lookups.",
      hops: [
        { from: "client", to: "lb", label: "GET /search?q=sunita sharma&city=pune", narration: "The user types a name.", why: "An interactive query with a looser latency budget (~500 ms)." },
        { from: "lb", to: "api", label: "route", narration: "Any API server handles it.", why: "Stateless." },
        { from: "api", to: "search", label: "match name, filter country=IN, city=Pune", narration: "The query goes to the country's shard of the search index.", why: "Sharding by country keeps each query on a small index." },
        { from: "search", to: "api", label: "top 10 hits (above confidence threshold)", narration: "Ranked results come back. Only entries that met the k-source rule are indexed.", why: "Prevents search from exposing unverified, single-source data." },
        { from: "api", to: "lb", label: "results page + cursor", narration: "The server returns a page of results and a cursor.", why: "Bulk enumeration is capped by pagination and a per-user rate limit." },
        { from: "lb", to: "client", label: "200 OK", narration: "The app renders the result list.", why: "Anything unverified was never indexed, so there is nothing extra to filter here." },
      ],
      takeaway: "Search is eventually consistent with the store and fully isolated from lookups, so a slow or failing index costs us search quality, not caller ID.",
    },
    {
      id: "report",
      name: "Spam report → merged profile",
      kind: "write",
      summary: "The write path: accept fast, process asynchronously, converge every copy of the data.",
      hops: [
        { from: "client", to: "lb", label: "POST /reports {number, SPAM}", narration: "The user taps 'report spam' after a call.", why: "A fire-and-forget action. The user doesn't wait for the merge." },
        { from: "lb", to: "api", label: "route", narration: "Any API server takes it.", why: "Stateless." },
        { from: "api", to: "queue", label: "ReportSubmitted(number, reporter)", narration: "The server validates, normalises, publishes (keyed by number) and returns 202.", why: "Keyed by number: all reports for one number are processed in order by one consumer, so merging needs no cross-worker locks.", async: true },
        { from: "api", to: "lb", label: "202 Accepted", narration: "The server acknowledges.", why: "Latency for the user is one publish, not three stores." },
        { from: "lb", to: "client", label: "202 Accepted", narration: "The app is told it's received.", why: "The user has moved on. Merge happens later." },
        { from: "queue", to: "ingest", label: "consume batch", narration: "The merge worker reads a batch of reports.", why: "Batching collapses 1,000 reports on one viral number into one store write.", async: true },
        { from: "ingest", label: "dedupe by (reporter, number); weight by reputation; recompute profile", narration: "Duplicates are dropped, votes weighted, the new spam score computed from distinct reporters.", why: "Aggregates are recomputed from distinct evidence, not incremented, so replays can't inflate them." },
        { from: "ingest", to: "db", label: "upsert profile", narration: "One write to the source-of-truth store.", why: "The store is written first. Cache and index are derived from it." },
        { from: "ingest", to: "cache", label: "refresh key", narration: "The cached entry is replaced with the new profile.", why: "Keeps the hot path fresh without waiting for TTL expiry.", async: true },
        { from: "ingest", to: "search", label: "update index doc (if above threshold)", narration: "The search document is updated.", why: "A single ordered stream feeding all three keeps them converging.", async: true },
      ],
      takeaway: "A report is evidence, not a row update. Accept it quickly, then deduplicate, weight and fan out through one ordered pipeline.",
    },
    {
      id: "cache-down",
      name: "Failure: cache node dies during a spam wave",
      kind: "failure",
      summary: "Node death plus stampede. The hot keys vanish and thousands of requests hit one store partition.",
      hops: [
        { from: "api", to: "cache", label: "GET +1800… (viral scam number)", narration: "A cache shard holding the hottest keys has crashed.", why: "The hottest keys are exactly the ones on the node that failed.", failure: true },
        { from: "api", label: "single-flight: 1 store read per key per server", narration: "Concurrent requests for the same key on one server share a single in-flight fetch.", why: "Without it, 50K req/s for one number becomes 50K req/s on one store partition." },
        { from: "api", to: "db", label: "GET profile (coalesced)", narration: "One read per key per server reaches the store.", why: "Load on the partition is bounded by the number of API servers (~40), not by the request rate." },
        { from: "db", to: "api", label: "profile", narration: "The store answers.", why: "The store survives because the stampede was collapsed first." },
        { from: "api", label: "serve; keep a short in-process cache (2 s) for this key", narration: "The server keeps a tiny local copy for a couple of seconds while the cache recovers.", why: "A bounded-staleness local cache protects the store, and two seconds of staleness is irrelevant for spam scores." },
      ],
      takeaway: "Cache failure must degrade throughput, not correctness. Request coalescing plus a tiny local cache stops a lost cache node from becoming a lost database.",
    },
    {
      id: "optout",
      name: "Opt-out: removing a number everywhere",
      kind: "write",
      summary: "A deletion has to reach every copy, or it hasn't happened.",
      hops: [
        { from: "client", to: "lb", label: "DELETE /numbers/+9198… (OTP verified)", narration: "The owner proves they control the number, then requests removal.", why: "Without OTP verification, anyone could erase anyone else's listing." },
        { from: "lb", to: "api", label: "route", narration: "The request reaches a server.", why: "Stateless." },
        { from: "api", to: "queue", label: "OptOut(number)", narration: "An OptOut event is published and a receipt (requestId, deadline) returned.", why: "Receipt = compliance proof. Everything downstream is asynchronous but tracked.", async: true },
        { from: "queue", to: "ingest", label: "consume OptOut", narration: "The merge worker handles it with priority.", why: "Same ordered stream as reports, so no later report can resurrect the number.", async: true },
        { from: "ingest", to: "db", label: "write tombstone (not hard delete)", narration: "The profile is replaced with a tombstone that blocks future writes.", why: "A hard delete would let the next spam report quietly recreate the entry. The tombstone remembers 'don't'." },
        { from: "ingest", to: "cache", label: "evict key", narration: "The cached copy is removed.", why: "Otherwise the name would stay visible for up to an hour.", async: true },
        { from: "ingest", to: "search", label: "delete index doc", narration: "The search document is deleted.", why: "The easiest copy to forget, and the one regulators find first.", async: true },
        { from: "snap", to: "cdn", label: "next delta carries the tombstone", narration: "The next snapshot delta tells devices to drop the number.", why: "Devices hold copies too. Up to a day of lag is documented and within the legal 30 days.", async: true },
      ],
      takeaway: "Treat deletion as a first-class write that fans out to every copy: store, cache, index and devices. Use a tombstone, not a delete, so the data can't grow back.",
    },
    {
      id: "duplicate-report",
      name: "Failure: duplicate and brigaded reports",
      kind: "failure",
      summary: "Duplicate processing. A redelivered batch, or one bot, must not move a number's spam score.",
      hops: [
        { from: "queue", to: "ingest", label: "batch #9031 (2,000 reports)", narration: "The worker processes a batch and writes the profile.", why: "At-least-once delivery is the default of every broker.", async: true },
        { from: "ingest", label: "crash before committing offset", narration: "The offset isn't committed, so the broker still holds the batch.", why: "Commit-after-process means we never lose data, at the cost of duplicates.", failure: true },
        { from: "queue", to: "ingest", label: "redeliver batch #9031", narration: "The restarted worker gets the same 2,000 reports again.", why: "The second pass must not change the result.", async: true, failure: true },
        { from: "ingest", label: "dedupe by (reporter, number, type); recompute from distinct reporters", narration: "Reports already counted are skipped. Counts are recomputed from distinct reporters, not incremented.", why: "An idempotent aggregate makes replays harmless. The same rule stops one bot voting 1,000 times." },
        { from: "ingest", to: "db", label: "upsert profile (same values)", narration: "The write is identical to the first pass.", why: "Idempotent upsert, so doing it twice is the same as once." },
      ],
      takeaway: "Design for duplicates instead of preventing them: aggregates derived from distinct reporters are idempotent against both retries and ballot-stuffing.",
    },
  ],

  // ───────────────────────────── Stage 6 — Deep dives ─────────────────────────────
  deepDives: [
    {
      id: "normalisation",
      title: "The key: what is 'the same number'?",
      question: "How do we make '+1 415 555 0100', '(415) 555-0100' and '04155550100' one row?",
      context: [
        "Every optimisation in this design (sharding, cache, Bloom filter) assumes one canonical key per number.",
        "Numbers arrive in local formats, with trunk prefixes (0), spaces, extensions and even letters. The same digits can be different numbers in different countries.",
        "Getting this wrong fails silently: lookups just miss and reports scatter.",
      ],
      options: [
        {
          name: "Store the raw string as received",
          pros: ["Zero processing"],
          cons: ["Every format variant is a separate row", "Lookups only match when the format happens to be identical"],
          verdict: "Lost: this guarantees duplicate rows and missed lookups.",
        },
        {
          name: "Strip non-digits and match on the last 10 digits",
          pros: ["Easy and surprisingly common"],
          cons: ["Collides across countries (same 10 digits, different country codes)", "Breaks in countries where numbers aren't 10 digits"],
          verdict: "Lost: it's wrong for an international product.",
        },
        {
          name: "Parse to E.164 with libphonenumber at the edge, using the user's country as the default region",
          pros: ["Globally unique, unambiguous", "Handles trunk prefixes and formatting rules per country", "One function used on both read and write paths"],
          cons: ["Needs the user's region", "Invalid/ambiguous inputs need handling", "Library data must be kept up to date as numbering plans change"],
          verdict: "Chosen: the only approach that's both correct and international.",
          chosen: true,
        },
      ],
      recommendation:
        "Normalise to E.164 at the API edge, on both reads and writes, with a single shared library and version. Reject unparseable input with 400. Keep a regression corpus of tricky numbers (short codes, extensions, toll-free, +0 prefixes).",
      sayIt:
        "The number is my partition key, so the first thing I do is canonicalise it: E.164 via libphonenumber, using the user's country for local formats, and the same code on read and write. If two spellings can produce two keys, every layer above it silently breaks.",
    },
    {
      id: "merge",
      title: "Who is this number? Merging conflicting, untrustworthy names",
      question: "Five users call it 'Mom', 'Sunita', 'Sunita Sharma', 'Dr. Sharma' and 'Spam'. What do we show?",
      context: [
        "Contacts are personal labels, not facts. 'Mom' is correct for one person and meaningless to everyone else.",
        "Bad actors can submit labels deliberately, to impersonate a bank or smear a competitor.",
        "A wrong 'spam' label on a hospital line is harmful; a missing name is merely unhelpful.",
      ],
      options: [
        {
          name: "Last write wins",
          pros: ["Trivial"],
          cons: ["Trivially gamed", "Flips back and forth"],
          verdict: "Lost: one malicious write rewrites a business's identity.",
        },
        {
          name: "Majority vote of all labels",
          pros: ["Resistant to a single bad actor"],
          cons: ["Vulnerable to bot swarms", "Personal labels ('Mom', 'Boss') dominate and mislead"],
          verdict: "Better, but still not enough.",
        },
        {
          name: "Reputation-weighted votes, minimum k independent sources, personal-label filtering",
          pros: ["Bots and brand-new accounts carry little weight", "Show nothing until k ≥ 5 independent reporters agree", "Filters 'Mom/Dad/Boss'-type labels and prefers normalised, longer names"],
          cons: ["Needs a reputation system (account age, past accuracy)", "Slower to name a brand-new number"],
          verdict: "Chosen: it favours 'unknown' over a wrong guess, which is the right bias for personal data.",
          chosen: true,
        },
      ],
      recommendation:
        "Store all name variants as evidence. Derive display_name only when at least k independent, reputable sources agree after normalisation. Use a higher bar for 'spam' than for naming. Verified-business listings override crowd data.",
      sayIt:
        "Contacts are opinions, not facts, so I store evidence and derive a display name only when several independent, reputable sources agree. Bias toward showing 'unknown' over being wrong, and set a higher threshold for a spam label than for a name.",
    },
    {
      id: "privacy",
      title: "Privacy by design: what we may show, and how deletion works",
      question: "How do we build a directory out of other people's contacts without exposing or retaining what we shouldn't?",
      context: [
        "The people in this directory never signed up. That's a legal and ethical constraint, not just a feature.",
        "Deletion has to reach the store, cache, search index, backups and devices.",
        "Raw uploaded address books are far more sensitive than the aggregated result.",
      ],
      options: [
        {
          name: "Keep everything and honour deletions on request",
          pros: ["Simplest to build"],
          cons: ["Large liability surface", "Deletion has to chase raw data everywhere"],
          verdict: "Lost: the less raw data we keep, the less there is to leak or delete.",
        },
        {
          name: "Aggregate on ingestion: keep only counts and normalised names, drop raw uploads",
          pros: ["Raw contact lists are never stored", "k-anonymity: nothing is shown unless k sources agree", "Smaller data, easier compliance"],
          cons: ["Can't re-derive from raw data if the merge rules change", "Re-processing needs a new upload"],
          verdict: "Chosen as the default: data minimisation is the strongest privacy control.",
          chosen: true,
        },
        {
          name: "Tombstones plus fan-out deletion with an audit receipt",
          pros: ["Deletion can't be undone by a later report", "A provable trail for regulators"],
          cons: ["Tombstones are themselves data (a hashed number)", "Must reach every copy, including devices (via deltas)"],
          verdict: "Chosen alongside aggregation: it's the mechanism that makes deletion stick.",
          chosen: true,
        },
      ],
      recommendation:
        "Minimise on ingest (aggregate, discard raw), require k independent sources before display, store hashed tombstones for opted-out numbers, and propagate deletions through the same ordered stream with a tracked deadline.",
      sayIt:
        "I'd aggregate on ingestion and never keep raw address books, so there's less to leak and less to delete. Display needs k independent sources. Deletion is a first-class event through the same ordered pipeline, leaving a tombstone so a later report can't resurrect the number.",
    },
  ],

  // ───────────────────────────── Stage 7 — Defend ─────────────────────────────
  tradeOffs: [
    {
      decision: "KV store partitioned by number",
      alternative: "Sharded relational database",
      why: "The only access is get/put by one key, and linear scale-out is built in.",
      whenToSwitch: "If we need rich queries on the serving path (analytics, joins). Even then, export to a warehouse instead.",
    },
    {
      decision: "Bloom filter + cache",
      alternative: "Bigger cache, or cache negative results",
      why: "The filter answers 'definitely absent' in-process with tiny memory, and the cache can't cache what doesn't exist.",
      whenToSwitch: "If false positives or memory per server hurt, move the filter to a shared service, or partition by country.",
    },
    {
      decision: "Queue for contributions",
      alternative: "Direct synchronous writes",
      why: "Dedupe, weighting, batching and fan-out all live in one place, and spikes are absorbed.",
      whenToSwitch: "Never for lookups, which stay synchronous. For writes, only if instant visibility becomes a hard requirement.",
    },
    {
      decision: "Evidence-based profiles with k-source threshold",
      alternative: "Store one name per number",
      why: "Resists vandalism and bots, and lets us re-derive the display name.",
      whenToSwitch: "For verified business numbers, where a single authoritative source is better than crowd votes.",
    },
    {
      decision: "On-device snapshot of the top 5M",
      alternative: "Server-only lookups",
      why: "Takes ~50% of lookups off the network entirely, and works offline.",
      whenToSwitch: "If privacy rules forbid shipping this data to devices, or the target market has very cheap, reliable connectivity.",
    },
    {
      decision: "Tombstone on opt-out",
      alternative: "Hard delete",
      why: "Stops a later report from silently re-creating a removed entry.",
      whenToSwitch: "If the law requires erasing even the hashed identifier, expire tombstones after a defined period and re-check consent on any new submission.",
    },
    {
      decision: "Eventual consistency for reports",
      alternative: "Strong consistency across store, cache and index",
      why: "A few minutes of staleness is within the requirement and keeps lookups fast.",
      whenToSwitch: "If a regulator requires immediate effect for specific actions such as opt-outs, add a synchronous cache eviction there.",
    },
  ],

  bottlenecks: [
    { item: "Hot partition for a viral number", mitigation: "Cache plus single-flight absorbs reads, and the merge worker batches writes per number." },
    { item: "Bloom filter memory on every API server", mitigation: "Partition by country, load only what each region serves, and rebuild nightly." },
    { item: "Cache cluster as a shared dependency", mitigation: "Replicated shards, request coalescing, and a short in-process fallback cache." },
    { item: "Search index drifting from the store", mitigation: "The store is the source of truth. A reconciliation job re-indexes from it, and the index is rebuildable." },
    { item: "Queue consumer lag during a spam campaign", mitigation: "Partition by number, scale consumers, alert on lag. Freshness degrades gracefully to minutes." },
    { item: "Region outage", mitigation: "Multi-region KV with local reads, regional caches and API tiers, and snapshots on the device as the last line of defence." },
    { item: "Scraping / enumeration of the directory", mitigation: "Per-user and per-IP rate limits (see the Rate Limiter problem), capped search results, and verified accounts for search." },
  ],

  followUps: [
    {
      question: "Carriers recycle phone numbers. How do you avoid showing a stale name?",
      answer: [
        "Treat identity as decaying evidence: record last_seen_at for each name variant and down-weight old reports over time.",
        "A sudden change in the dominant reporters' labels signals reassignment, and the number is demoted to 'unknown' until new evidence accumulates.",
        "Verified-business entries need periodic re-verification.",
      ],
    },
    {
      question: "How do you scale this across regions?",
      answer: [
        "Serve lookups from the region nearest to the user: regional API tier, cache and a KV replica.",
        "Number profiles are keyed by number and merge-friendly, so the KV store replicates asynchronously across regions. A few seconds of replication lag is invisible to caller ID.",
        "Reports are processed in one home region per number (by hash of the number) so the merge stays single-writer, with the result replicated outward.",
        "Opt-outs replicate with priority, since they carry a legal deadline.",
      ],
    },
    {
      question: "What if the Bloom filter returns a false positive?",
      answer: [
        "The lookup just falls through to the cache and the store, finds nothing, and returns 'unknown'. A false positive costs one wasted read.",
        "False negatives are what matter, and a Bloom filter has none. We never turn away a real number.",
        "At 1%, the filter saves ~99% of reads for absent numbers. Tune bits-per-key against server memory.",
      ],
    },
    {
      question: "How do you detect spam numbers before anyone reports them?",
      answer: [
        "Add behavioural signals (calls per minute, short-duration ratio, many unique recipients) from consenting users' call logs, aggregated server-side.",
        "Score numbers with a model offline, and treat the score as one more weighted source, never a definitive label.",
        "Keep a human-review path for high-impact false positives like hospitals and banks.",
      ],
    },
    {
      question: "Why not do everything on the device and skip the server?",
      answer: [
        "The long tail (random personal numbers) is 3B numbers, 1.5 TB. It can't ship to every phone.",
        "Freshness: a viral scam number must be flagged in minutes, not at the next nightly snapshot.",
        "The device is a cache of the head of the distribution. The server stays the source of truth.",
      ],
    },
  ],

  mistakes: [
    "Skipping number normalisation, or using 'last 10 digits' for a global product.",
    "Treating this as a search problem rather than a key-value one.",
    "Putting the lookup on a message queue or making it asynchronous.",
    "Ignoring negative lookups: 30% of reads for numbers that don't exist.",
    "Incrementing spam counters on every report instead of aggregating distinct reporters.",
    "Forgetting deletion has to reach the cache, index and devices.",
    "One name per number, with no concept of confidence.",
  ],

  redFlags: [
    "No answer for 'what about GDPR / opt-out?'",
    "Promising exactly-once processing for reports instead of designing for idempotency.",
    "Last-write-wins on names, which lets one bad actor vandalise a business.",
    "A relational database with LIKE queries for name search at billions of rows.",
    "No plan for a hot key, such as a viral spam number.",
  ],
};
