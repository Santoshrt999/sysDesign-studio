import type { Problem } from "../../types";

/**
 * Web Crawler
 *
 * Narrative spine: a crawler is a pipeline whose real constraint is not OUR hardware but OTHER PEOPLE'S SERVERS.
 *  - politeness (≈1 req/s per host) caps throughput per site, whatever machines we own -> the frontier is the heart
 *  - the web is full of duplicates and traps       -> dedupe by URL and by content, plus budgets per host
 *  - fetching is I/O-bound, parsing is CPU-bound   -> split them with a queue so each scales alone
 *  - every stage can crash                         -> at-least-once everywhere, idempotent effects
 * Between stages we use queues (nobody waits for the answer). Calls to the outside world (DNS, robots.txt, the origin
 * server) are synchronous with hard timeouts. And the frontier is NOT a plain message queue, because a FIFO cannot
 * express "not this host again for one second".
 */
export const webCrawler: Problem = {
  slug: "web-crawler",
  title: "Web Crawler",
  tagline: "Politeness, dedupe and a frontier that can feed thousands of fetchers without hammering anyone",
  difficulty: "Hard",

  overview: {
    whatItIs:
      "A web crawler is a program that discovers and downloads web pages automatically. It starts from a list of known URLs, fetches each page, pulls out the links it finds, and adds them to the to-do list. Repeat billions of times and you have a copy of (part of) the web.",
    whatItDoes: [
      "Discovers pages by following links, starting from seed URLs.",
      "Downloads and stores page content for other systems to use.",
      "Revisits pages on a schedule so the copy stays fresh.",
      "Plays by the rules: reads robots.txt and never overloads a site.",
      "Avoids waste: doesn't fetch the same URL, or the same content, twice.",
    ],
    whereUsed: [
      "Search engines (Googlebot, Bingbot): the crawl feeds the index",
      "LLM and ML training: collecting text corpora (Common Crawl)",
      "Price and competitor monitoring, news aggregation, SEO audits",
      "Web archives (Internet Archive) and security scanners",
    ],
    coreIdea:
      "Crawling is a graph traversal where the graph is the internet, so it is never finished and every node belongs to someone else. The design is the URL frontier: a scheduler that decides what to fetch next so we stay fast overall, polite to each host, and focused on pages that matter.",
    notToBeConfusedWith: [
      { term: "Scraper", difference: "A scraper extracts specific data from known pages. A crawler discovers pages. They are often combined, but the design problems differ." },
      { term: "Search engine", difference: "The crawler only collects content. Indexing, ranking and serving queries are downstream systems that consume its output." },
      { term: "Message queue / job scheduler", difference: "The frontier looks like a queue but has to enforce 'not this host again for a second', which a plain FIFO queue can't do." },
    ],
  },

  // ───────────────────────────── Stage 1 — Understand ─────────────────────────────
  interviewQuestion:
    "Design a web crawler that collects pages from the internet to feed a search index. It should scale to billions of pages, be polite to the sites it visits, avoid duplicate work, and keep its copy reasonably fresh.",

  clarifyingQuestions: [
    {
      question: "What is the crawl for: a search index, ML training data, or monitoring a handful of sites?",
      whyItMatters:
        "A general crawl needs breadth, dedupe and prioritisation across the whole web. A targeted crawl of 50 sites needs depth, freshness and maybe login handling. The purpose changes nearly every trade-off.",
      answer: "A general-purpose crawl to feed a search index.",
      designImpact:
        "Breadth-first with priorities, URL and content dedupe, and recrawl scheduling. Crawl budget per site matters, since we can't take everything from everywhere.",
    },
    {
      question: "How many pages per month, and what is the average page size?",
      whyItMatters:
        "It sets fetch throughput, bandwidth, storage and the size of the 'already seen' set, which decides whether it fits in memory.",
      answer: "About 5 billion pages a month, around 100 KB of HTML each.",
      designImpact:
        "≈ 2K fetches/s, about 500 TB of raw HTML a month (before compression), and tens of billions of known URLs. None of that fits on one machine, so everything is partitioned.",
    },
    {
      question: "What content types do we handle? Is JavaScript-rendered content in scope?",
      whyItMatters:
        "Rendering JS needs a headless browser, which is 10–100× more expensive per page than fetching HTML.",
      answer: "HTML only for now. Rendering is a follow-up.",
      designImpact:
        "Plain HTTP fetchers. We keep the pipeline extensible so a renderer could be added as another stage later.",
    },
    {
      question: "How fresh must the data be?",
      whyItMatters:
        "'Everything daily' means refetching 5B pages a day, which we can't do. Freshness has to be prioritised under a fixed fetch budget.",
      answer: "News and high-value pages within hours, most pages within a few weeks.",
      designImpact:
        "A recrawl scheduler that learns how often each page changes, plus conditional GETs (ETag / If-Modified-Since) so unchanged pages cost almost nothing.",
    },
    {
      question: "How polite do we have to be? What about robots.txt?",
      whyItMatters:
        "Ignoring robots.txt or hammering a small site gets us blocked, sued, or blamed for an outage. This also caps our per-site throughput.",
      answer: "Obey robots.txt, including Crawl-delay. Default to at most one request per second per host.",
      designImpact:
        "Politeness is enforced centrally in the frontier. Throughput comes from crawling many hosts in parallel, never from hitting one host harder.",
    },
    {
      question: "How should we handle duplicate and near-duplicate content?",
      whyItMatters:
        "A large fraction of the web is the same content under different URLs (mirrors, tracking parameters, print views). Storing and indexing it all wastes storage and pollutes search results.",
      answer: "Skip exact duplicates and detect near-duplicates. Roughly 30% of pages are duplicates.",
      designImpact:
        "Two layers of dedupe: URL-level (canonicalise and keep a seen set) and content-level (hash and SimHash).",
    },
    {
      question: "What happens if a worker crashes mid-crawl?",
      whyItMatters:
        "At thousands of workers, something is always failing. The question is whether we lose URLs, or fetch twice.",
      answer: "Don't lose URLs. Fetching a page twice occasionally is acceptable.",
      designImpact:
        "At-least-once processing with leases and idempotent effects. Exactly-once isn't required and isn't worth the cost.",
    },
  ],

  requirements: {
    functional: [
      "Crawl: starting from seed URLs, fetch pages, extract links, and keep going.",
      "Store: save the raw page and extracted content for downstream consumers (indexer).",
      "Respect robots.txt and rate-limit requests per host.",
      "Deduplicate: never queue the same canonical URL twice, and detect duplicate content.",
      "Recrawl: revisit pages based on how often they change and how important they are.",
    ],
    nonFunctional: [
      { name: "Throughput", target: "≈ 2K pages/s average, 4K/s peak (5B pages/month)", why: "This is the volume needed to cover the target part of the web." },
      { name: "Politeness", target: "≤ 1 request/s per host unless robots.txt or a trusted-host rule says otherwise", why: "We're guests on other people's servers, and getting blocked ends the crawl." },
      { name: "Robustness", target: "Survive bad HTML, slow servers, huge files, redirect loops and crawler traps", why: "The open web is hostile and malformed by default." },
      { name: "Fault tolerance", target: "No URL lost on worker failure; at-least-once fetch", why: "Losing URLs silently creates holes in the crawl that nobody notices." },
      { name: "Scalability", target: "Add machines to add throughput, linearly", why: "The target will grow, and so will the web." },
      { name: "Freshness", target: "High-priority pages recrawled within hours, others within weeks", why: "A stale index returns dead links and old prices." },
    ],
    outOfScope: [
      "JavaScript rendering with headless browsers (follow-up)",
      "Indexing, ranking and serving search queries",
      "Images, video and other non-HTML content",
      "Authenticated or 'deep web' content behind logins and forms",
    ],
  },

  // ───────────────────────────── Stage 2 — Size ─────────────────────────────
  estimates: [
    {
      title: "Fetch throughput",
      reasoning: [
        "5,000,000,000 pages / month ÷ (30 × 86,400 s) ≈ 1,930 pages/s",
        "Peak (priority bursts and recovery after outages) ≈ 2× → ~4,000 pages/s",
        "One fetcher box with async I/O sustains ~100–200 fetches/s (TLS, parsing, bandwidth)",
        "4,000 ÷ 150 ≈ 27 boxes",
      ],
      result: "≈ 2K pages/s average, ~4K/s peak, roughly 30 fetcher machines",
      soWhat:
        "Nothing here needs exotic hardware, but it does need a distributed fetch tier, and a frontier that can hand out 4K URLs/s without two fetchers colliding on one host.",
    },
    {
      title: "Bandwidth and storage",
      reasoning: [
        "Average page: 100 KB HTML, about 30 KB on the wire with gzip",
        "Inbound: 2,000/s × 30 KB = 60 MB/s ≈ 480 Mbps (peak ~1 Gbps)",
        "Raw storage: 5B × 100 KB = 500 TB/month; with 4:1 compression ≈ 125 TB/month",
      ],
      result: "≈ 0.5–1 Gbps inbound, ≈ 125 TB/month compressed",
      soWhat:
        "Bandwidth is modest, but storage is huge and write-once. It belongs in object storage (S3/HDFS) in large batched files, not a database, and parsers read from it by reference.",
    },
    {
      title: "Politeness is the real limit",
      reasoning: [
        "Default: 1 request/s per host",
        "To reach 2,000 pages/s we must be fetching from at least 2,000 different hosts at every moment",
        "A site with 500M URLs at 1 req/s would take ~16 years to crawl",
      ],
      result: "Need ≥ 2K active hosts at once; big sites are budget-limited, not machine-limited",
      soWhat:
        "Throughput comes from interleaving thousands of hosts, so the frontier must be organised per host (not one global FIFO). Large sites get a crawl budget and priority, not a faster crawl.",
    },
    {
      title: "URL-seen set",
      reasoning: [
        "5B pages × ~40 links = ~200B link extractions per month, most of them repeats (menus, footers)",
        "Distinct known URLs: ~50B",
        "Exact set of 64-bit hashes: 50B × 8 B = 400 GB",
        "Bloom filter at 1% false positives: 50B × 9.6 bits ≈ 60 GB",
      ],
      result: "≈ 400 GB exact, ≈ 60 GB as a Bloom filter",
      soWhat:
        "It won't fit on one machine, so the set is sharded by host hash (the same partitioning as the frontier). A Bloom filter in RAM screens 'definitely new' without a disk read, with an SSD-backed store as the exact source of truth.",
    },
    {
      title: "DNS load",
      reasoning: [
        "Every fetch needs the host's IP. 2,000 fetches/s means 2,000 lookups/s if uncached.",
        "Uncached lookup: 20–100 ms, and public resolvers rate-limit heavy clients",
        "URLs for the same host arrive close together once they're grouped in per-host queues",
      ],
      result: "Uncached: 2K lookups/s. Cached per host: ≈ 10× fewer.",
      soWhat:
        "DNS is a classic hidden bottleneck. Run our own caching resolvers and resolve once per host per TTL, which per-host queues make natural.",
    },
    {
      title: "Recrawl budget",
      reasoning: [
        "Known URLs: ~50B. Monthly fetch budget: 5B (10%).",
        "A uniform schedule means refreshing each URL every 10 months. News pages need hours.",
        "Conditional GET on an unchanged page: ~300 B 304 response instead of 100 KB",
      ],
      result: "Budget covers 10% of known URLs per month, so recrawl must be prioritised",
      soWhat:
        "Freshness is a scheduling problem under a fixed budget. Track each URL's change history, recrawl fast-changing pages often, and use ETag/If-Modified-Since so unchanged pages are nearly free.",
    },
  ],

  // ───────────────────────────── Stage 3 — Start simple ─────────────────────────────
  api: [
    {
      method: "POST",
      path: "/v1/seeds",
      request: '{ "urls": ["https://example.com/"], "priority": "HIGH" }',
      response: "202 Accepted { accepted: 1, rejected: [] }",
      notes: "The only synchronous API most operators touch. URLs are canonicalised and checked before they enter the frontier. Returns 202 because crawling is asynchronous.",
    },
    {
      method: "GET",
      path: "/v1/crawl/status?host=example.com",
      response: '{ "queued": 12044, "fetched": 88213, "errors": 311, "nextAllowedAt": "…" }',
      notes: "Operations view, also used to debug 'why isn't my site being crawled?'",
    },
    {
      method: "internal",
      path: "frontier.lease(n) → [url…]  /  frontier.ack(url, result)",
      response: "{ url, host, lastEtag, attempt }",
      notes: "Pull-based work distribution. A fetcher leases URLs (with a visibility timeout), then acks or fails them. Never push: fetchers set their own pace.",
    },
    {
      method: "internal",
      path: "PageFetched { url, blobRef, status, etag, fetchedAt }",
      response: "(message, no reply)",
      notes: "Published to the parse queue. It carries a reference to the stored page, not the body, which keeps messages tiny.",
    },
  ],

  communication: {
    rule:
      "Between stages of the pipeline, use queues: they decouple fast from slow, absorb bursts, and survive crashes. When talking to the outside world (DNS, robots.txt, the origin server) a request must wait for its reply, so use a synchronous call with a hard timeout. The frontier looks like a queue, but needs per-host timing, so it is a purpose-built scheduler, not a plain broker.",
    choices: [
      {
        interaction: "Frontier → fetchers: 'what should I crawl next?'",
        style: "async-queue",
        why: "A pull-based work queue: fetchers lease a batch at their own pace, so a slow fetcher never blocks a fast one, and a crash returns its leased URLs automatically. It must be a purpose-built frontier (per-host queues, next-allowed-time), not a plain broker.",
        ifWrong: "A direct synchronous call to a central scheduler for every URL makes the scheduler a bottleneck at 4K/s. A plain FIFO topic can't express 'wait one second before the next request to this host' and hammers sites.",
      },
      {
        interaction: "Fetcher → origin website (HTTP GET)",
        style: "sync-api",
        why: "We have to wait for the page. This is a call to a server we don't control, so it needs strict timeouts, a size cap, redirect limits and a per-host circuit breaker.",
        ifWrong: "There's no async alternative: the site only speaks HTTP. What we can control is not blocking a thread, so use non-blocking I/O with thousands of concurrent connections per box.",
      },
      {
        interaction: "Fetcher → DNS / robots.txt",
        style: "sync-api",
        why: "The fetch can't proceed without the IP and the permission decision. Both are cacheable lookups, so the call is local and fast most of the time.",
        ifWrong: "Making these asynchronous just means the URL waits in another queue for a decision it could have had in microseconds from a cache.",
      },
      {
        interaction: "Fetcher → parse workers",
        style: "async-queue",
        why: "Fetching is I/O-bound and parsing is CPU-bound, so they scale separately. The queue buffers bursts, retries parse failures without re-fetching, and lets us redeploy the parser with no effect on fetching. The message carries a reference to the stored page.",
        ifWrong: "Parsing inline in the fetcher ties the two scaling profiles together, and a parser crash loses a fetch we already paid for (and bothered the site for).",
      },
      {
        interaction: "Parser → URL-seen check → frontier (newly discovered links)",
        style: "hybrid",
        why: "The dedupe lookup is a fast batched call (sync), and only genuinely new URLs are enqueued (async) into the frontier. If the dedupe service lags, the discovered links can be buffered on a queue so the parser isn't stalled.",
        ifWrong: "Pushing every extracted link (200B/month, mostly repeats) straight into the frontier would flood it. Doing the check per link, rather than per page batch, would multiply round trips.",
      },
      {
        interaction: "Recrawl scheduler → frontier",
        style: "async-queue",
        why: "Nobody waits. It periodically selects due URLs and bulk-enqueues them with their last ETag. Backlog and priority are handled by the frontier.",
        ifWrong: "Synchronous 'recrawl now' calls couple the scheduler to frontier availability, and bursts at the top of the hour overwhelm it.",
      },
    ],
  },

  dataModel: [
    {
      entity: "url_record (URL metadata store)",
      fields: [
        { name: "url_hash", type: "BIGINT", note: "64-bit hash of the canonical URL; key within a host partition" },
        { name: "host", type: "STRING", note: "partition key, so a host's URLs live together" },
        { name: "url", type: "STRING", note: "canonical form" },
        { name: "status", type: "ENUM(NEW, QUEUED, FETCHED, FAILED, BLOCKED)" },
        { name: "content_hash / simhash", type: "BINARY", note: "for exact and near-duplicate detection" },
        { name: "etag / last_modified", type: "STRING", note: "enable conditional GET" },
        { name: "last_crawled / next_due", type: "TIMESTAMP", note: "drives the recrawl scheduler" },
        { name: "change_rate / priority", type: "FLOAT / INT", note: "learned from history, and from link-based importance" },
      ],
      accessPatterns: [
        "Seen-check by url_hash (batched, ~200B/month): Bloom filter first, then KV",
        "Scan by (host, next_due) for the recrawl scheduler",
        "Update after each fetch: status, hashes, etag, next_due",
      ],
      insight:
        "One record per URL does three jobs: dedupe (does it exist?), conditional fetch (what's its ETag?) and scheduling (when is it due?). Partitioning by host keeps a host's URLs together, which is also how the frontier is partitioned.",
    },
    {
      entity: "frontier (conceptual)",
      fields: [
        { name: "front queues", type: "F priority levels", note: "importance of the URL / site" },
        { name: "back queues", type: "one per active host", note: "FIFO of that host's URLs" },
        { name: "host heap", type: "min-heap by next_allowed_time", note: "which host may be fetched next" },
        { name: "lease table", type: "url → (worker, expires_at)", note: "visibility timeout for crash recovery" },
      ],
      accessPatterns: [
        "lease(n): pop hosts whose next_allowed_time ≤ now, take one URL from each",
        "ack(url): set host.next_allowed_time = now + crawl_delay",
        "enqueue(url): route by priority to a front queue, then to the host's back queue",
      ],
      insight:
        "A frontier is a two-level structure. 'Priority' decides what is important, and 'per-host timing' decides what is allowed right now. A plain queue only has an order, not an earliest time.",
    },
  ],

  v1: {
    title: "v1: a single-process crawler",
    description: [
      "One process with an in-memory queue and a HashSet of visited URLs: pop a URL, fetch it, save the page to disk, extract links, push unseen ones.",
      "It's breadth-first search over the web graph, and it's the correct way to learn the problem. Every part of it, the queue, the visited set, the fetch loop, gets replaced by something distributed later.",
      "It works for crawling one site with a few thousand pages.",
    ],
    diagram: {
      nodes: [
        { id: "seeds", label: "Seed URLs", sub: "operator", kind: "client", x: 0, y: 200 },
        { id: "fetcher", label: "Crawler process", sub: "queue + visited set in RAM", kind: "worker", x: 700, y: 200 },
        { id: "web", label: "The Internet", sub: "billions of origin sites", kind: "region", x: 1050, y: 200 },
        { id: "blob", label: "Local disk", sub: "pages as files", kind: "db", x: 700, y: 420 },
      ],
      edges: [
        { id: "seeds-fetcher", from: "seeds", to: "fetcher", label: "seed" },
        { id: "fetcher-web", from: "fetcher", to: "web", label: "HTTP GET" },
        { id: "fetcher-blob", from: "fetcher", to: "blob", label: "write page" },
      ],
    },
    whatBreaksFirst: [
      "Speed: a synchronous loop spends 99% of its time waiting on the network, at maybe 5 pages/s. We need ~2,000.",
      "The in-memory queue and visited set are lost on a crash, and don't fit in memory past a few hundred million URLs.",
      "Politeness: a BFS naturally fetches 1,000 URLs from the same site in a row.",
      "The single process is both the single point of failure and the throughput ceiling.",
    ],
  },

  // ───────────────────────────── Stage 4 — Evolve ─────────────────────────────
  evolution: [
    {
      version: "v2",
      title: "Distributed fetchers pulling from a durable frontier, with cached DNS",
      problem: "One process can't fetch 2K pages/s, and its state vanishes when it crashes.",
      evidence: "A synchronous fetch takes ~200–1000 ms (DNS + TCP + TLS + download), so a thread does 1–5 pages/s. 2,000 pages/s needs ~30 boxes each holding thousands of concurrent connections. And every crash loses the queue.",
      options: [
        {
          name: "A bigger machine with more threads",
          pros: ["No distribution"],
          cons: ["Thread-per-fetch caps out in the low thousands of connections", "Still one failure domain", "NIC and TLS CPU become the limit"],
          verdict: "Lost: it doesn't remove the single point of failure, and 2 Gbps is beyond one box.",
        },
        {
          name: "Hash-partition the URL space statically across N crawler processes, each with its own in-memory queue",
          pros: ["No shared queue"],
          cons: ["A crash loses that partition's queue", "Resharding on scale-up is painful", "Skew: one partition may get all the big sites"],
          verdict: "Lost: state lives inside workers, so workers can't be killed, scaled or replaced freely.",
        },
        {
          name: "Stateless fetchers (async I/O) pulling leased batches from a durable shared frontier, with a caching DNS resolver",
          pros: ["Fetchers are disposable, so scaling and recovery are trivial", "Pull gives natural load balancing", "Durable frontier survives crashes"],
          cons: ["The frontier becomes a critical shared component", "At-least-once delivery means occasional duplicate fetches"],
          verdict: "Chosen: it moves state out of the workers, which is what lets us scale and survive failure.",
          chosen: true,
        },
      ],
      decision:
        "Move the to-do list into a durable frontier service (initially a simple replicated queue). Fetchers are stateless, use non-blocking I/O with ~1,000 concurrent connections each, and lease URLs with a visibility timeout. DNS lookups go to a local caching resolver. Raw pages go to object storage.",
      newRisks: [
        { risk: "A plain FIFO frontier gives no control over which host is hit next. It is about to hammer sites.", mitigation: "That is the very next problem (v3). Fix scale and durability first, then the ordering." },
        { risk: "Leases expire during a slow fetch, so two workers fetch the same URL.", mitigation: "Fetch timeout is shorter than the lease; the result is idempotent (same blob key)." },
        { risk: "DNS becomes a bottleneck at 2K lookups/s.", mitigation: "Local caching resolvers, honouring TTLs with a floor, and resolving once per host per batch." },
      ],
      sayIt:
        "Workers should be disposable, so I pull the state out of them. The to-do list becomes a durable frontier, fetchers are stateless async-I/O workers that lease URLs, and DNS gets its own cache. That fixes scale and crash recovery. Politeness is the next thing it breaks.",
      delta: {
        addNodes: [
          { id: "frontier", label: "URL frontier", sub: "durable, leased work queue", kind: "queue", x: 330, y: 200 },
          { id: "dns", label: "DNS cache", sub: "local resolvers", kind: "cache", x: 700, y: -40 },
        ],
        updateNodes: [
          { id: "fetcher", label: "Fetcher workers", sub: "stateless × ~30 · async I/O" },
          { id: "blob", label: "Raw page store", sub: "object storage (S3 / HDFS)" },
        ],
        removeEdges: ["seeds-fetcher"],
        addEdges: [
          { id: "seeds-frontier", from: "seeds", to: "frontier", label: "seed" },
          { id: "frontier-fetcher", from: "frontier", to: "fetcher", label: "lease URLs" },
          { id: "fetcher-dns", from: "fetcher", to: "dns", label: "resolve" },
        ],
      },
    },
    {
      version: "v3",
      title: "A polite, prioritised frontier plus a robots.txt cache",
      problem: "The shared FIFO hands out whatever is next. A site with 50M queued URLs gets hit by dozens of fetchers at once.",
      evidence: "In a test crawl, a news site with 30K URLs queued back to back received ~900 requests/s from 30 fetchers. That is indistinguishable from a DDoS, and we were blocked within minutes. Meanwhile unimportant pages sat ahead of important ones in the FIFO.",
      options: [
        {
          name: "Global FIFO; each fetcher sleeps between requests to the same host",
          pros: ["Simple"],
          cons: ["Fetchers don't know what other fetchers are doing", "Sleeping wastes capacity: a fetcher idles while thousands of other hosts are ready"],
          verdict: "Lost: it buys politeness by throwing away throughput.",
        },
        {
          name: "Assign each host to exactly one fetcher (consistent hashing), with a local rate limiter per host",
          pros: ["No shared coordination", "Local state, so fast"],
          cons: ["A fetcher failure or rebalance moves hosts and resets their timers", "Skew: a big host overloads its one fetcher", "Priority across hosts is hard"],
          verdict: "Strong, and close to what we want, but it ties scheduling to fetcher identity.",
        },
        {
          name: "Mercator-style frontier: front queues by priority, one back queue per host, and a heap ordered by next-allowed time",
          pros: ["Enforces 'one request per host per interval' in one place", "Never idles: serves any host that is ready", "Priority handled separately from politeness", "Honours robots.txt Crawl-delay per host"],
          cons: ["More complex than a queue", "Must be partitioned by host hash to scale", "Politeness state lives in memory and must be recoverable"],
          verdict: "Chosen: it separates 'what's important' from 'what's allowed right now', which is what the problem needs.",
          chosen: true,
        },
      ],
      decision:
        "Rebuild the frontier as a Mercator-style scheduler partitioned by hash(host). Front queues rank by priority; each host has a back queue; a min-heap by next_allowed_time decides which host can be served. Fetchers lease from it and ack with the result, which sets the host's next_allowed_time. A robots.txt cache (per host, ~24 h TTL) is consulted before each fetch.",
      newRisks: [
        { risk: "The frontier partition holds politeness state in memory, so losing it forgets every host's timer.", mitigation: "Persist next_allowed_time and replicate the partition. On failover, start every host with a randomised short delay (see the failure flow)." },
        { risk: "robots.txt fetch fails or is unreachable.", mitigation: "Cache failures briefly. 4xx means 'no restrictions', 5xx means 'assume disallowed and retry later'." },
        { risk: "A giant host monopolises priority.", mitigation: "Per-host crawl budgets per cycle, so it can't starve the others." },
      ],
      sayIt:
        "A FIFO has an order but no concept of 'not before'. So the frontier becomes two layers: front queues for importance, and one back queue per host with a heap keyed on next-allowed-time. That makes politeness a property of the scheduler, and throughput comes from interleaving thousands of hosts.",
      delta: {
        addNodes: [{ id: "robots", label: "robots.txt cache", sub: "per host, ~24 h TTL", kind: "cache", x: 1050, y: -40 }],
        updateNodes: [{ id: "frontier", label: "URL frontier", sub: "priority front queues · per-host back queues · by host hash" }],
        addEdges: [{ id: "fetcher-robots", from: "fetcher", to: "robots", label: "allowed?" }],
      },
    },
    {
      version: "v4",
      title: "Split fetch from parse with a queue",
      problem: "Fetchers do both network I/O and HTML parsing. A page that is expensive to parse starves the fetch loop, and a parser crash throws away a download.",
      evidence: "Fetching is I/O-bound: one box handles ~1,000 connections at ~10% CPU. Parsing is CPU-bound: ~5 ms per page, so ~200 pages/s per core. A combined worker is either CPU-starved or mostly idle. And a parse crash means re-fetching, which means bothering the site again.",
      options: [
        {
          name: "Parse inline in the fetcher",
          pros: ["Fewest moving parts", "No intermediate storage"],
          cons: ["Two scaling profiles in one process", "A parser bug or pathological page stalls fetching", "Retry on parse failure means re-fetching"],
          verdict: "Lost: it's what the first version did, and the reason it didn't scale.",
        },
        {
          name: "Fetcher calls a parser service synchronously",
          pros: ["Separate scaling"],
          cons: ["The fetcher blocks on a slow parser", "No buffering when the parser is down or slow"],
          verdict: "Lost: it adds a network dependency with none of a queue's buffering.",
        },
        {
          name: "Fetcher stores the raw page in object storage and publishes a reference to a queue; parsers consume",
          pros: ["Each tier scales on its own", "The queue buffers bursts and parser outages", "Retry parsing without re-fetching", "Messages stay tiny (claim-check pattern)"],
          cons: ["Another queue to operate", "At-least-once delivery means a page may be parsed twice", "A small delay between fetch and parse"],
          verdict: "Chosen: nobody waits on the parse result, so it's a textbook case for a queue.",
          chosen: true,
        },
      ],
      decision:
        "The fetcher writes the raw bytes to object storage, then publishes PageFetched{url, blobRef, etag, status} to a parse queue (Kafka). Parser workers consume, read the blob, parse, and emit results. The fetcher acks the URL to the frontier once the blob is durably written.",
      newRisks: [
        { risk: "A page is stored but the message is never published (crash between the two).", mitigation: "Ack the frontier lease only after both succeed. If the worker dies in between, the lease expires and the URL is re-fetched. The result is a duplicate blob, but never a hole." },
        { risk: "A poison page crashes the parser repeatedly.", mitigation: "Retry limit, then a dead-letter queue for inspection." },
        { risk: "Consumer lag silently grows.", mitigation: "Alert on lag. The raw blobs are safe, so catching up is a scaling problem, not a data-loss one." },
      ],
      sayIt:
        "Fetching is I/O-bound and parsing is CPU-bound, so they should scale independently. The fetcher stores the page and puts a reference on a queue. That way a parser crash or backlog never costs us a download, or another request to the site.",
      delta: {
        addNodes: [
          { id: "parseq", label: "Parse queue", sub: "Kafka · PageFetched refs", kind: "queue", x: 1050, y: 420 },
          { id: "parser", label: "Parser workers", sub: "CPU-bound · stateless", kind: "worker", x: 1050, y: 620 },
        ],
        addEdges: [
          { id: "fetcher-parseq", from: "fetcher", to: "parseq", label: "PageFetched", async: true },
          { id: "parseq-parser", from: "parseq", to: "parser", label: "consume", async: true },
          { id: "parser-blob", from: "parser", to: "blob", label: "read page" },
        ],
      },
    },
    {
      version: "v5",
      title: "URL dedupe: canonicalise and keep a sharded seen set",
      problem: "Every page contributes ~40 links, mostly repeats. Without dedupe the frontier fills with URLs we've already crawled or queued.",
      evidence: "5B pages × 40 links = ~200B extractions a month, against ~50B distinct URLs. Roughly 75% of links are duplicates, and many 'different' URLs are the same page (?utm_source=…, #fragment, /index.html).",
      options: [
        {
          name: "In-memory HashSet per process",
          pros: ["Fast"],
          cons: ["50B URLs × 8 B = 400 GB, and lost on crash", "Each worker only knows its own history"],
          verdict: "Lost: the set outgrows memory and has to be shared and durable.",
        },
        {
          name: "Relational table with a UNIQUE index on URL",
          pros: ["Exact", "Durable"],
          cons: ["200B inserts per month ≈ 77K/s", "B-tree writes on a 50B-row index"],
          verdict: "Lost: far too slow, and most of those checks are for repeats.",
        },
        {
          name: "Canonicalise, then Bloom filter (RAM) in front of a sharded KV store, partitioned by host hash",
          pros: ["Bloom answers 'definitely new' without a disk read", "Exact answers from the KV for 'maybe seen'", "Same partitioning as the frontier, so a host's URLs stay together", "Doubles as the URL metadata store"],
          cons: ["Canonicalisation rules are fiddly", "Bloom filters can't delete and need periodic rebuild", "More state to shard"],
          verdict: "Chosen: it handles the volume cheaply and stays exact where it matters.",
          chosen: true,
        },
      ],
      decision:
        "Parsers canonicalise each link (lowercase host, resolve relative paths, strip fragments and known tracking parameters, sort query params, normalise trailing slash), then send a batch per page to the URL metadata service. It checks a Bloom filter and, on 'maybe seen', the KV store. Only new URLs are inserted and forwarded to the frontier.",
      newRisks: [
        { risk: "Over-aggressive canonicalisation merges genuinely different pages (?id=1 vs ?id=2).", mitigation: "Only strip parameters from an allowlist of known tracking keys, and measure content-hash collisions to catch bad rules." },
        { risk: "Under-canonicalisation lets duplicates through, so the frontier bloats.", mitigation: "Content-hash dedupe at v6 is the second line of defence." },
        { risk: "The seen-store becomes a hot spot for large hosts.", mitigation: "Shard by host hash with a sub-shard on URL hash for very large hosts." },
      ],
      sayIt:
        "Most extracted links are repeats, and many different-looking URLs are the same page. So parsers canonicalise, and then check a sharded seen set: a Bloom filter in RAM for 'definitely new', backed by an exact KV store, partitioned by host like the frontier. Only new URLs reach the frontier.",
      delta: {
        addNodes: [{ id: "seen", label: "URL metadata", sub: "Bloom filter + KV · by host hash", kind: "db", x: 330, y: 620 }],
        addEdges: [
          { id: "parser-seen", from: "parser", to: "seen", label: "seen? (batch)" },
          { id: "seen-frontier", from: "seen", to: "frontier", label: "enqueue new URLs", async: true },
        ],
      },
    },
    {
      version: "v6",
      title: "Content dedupe, crawler-trap defences and the content store",
      problem: "Different URLs serve identical or near-identical content, and some sites generate infinite URL spaces. Both waste budget and pollute the index.",
      evidence: "About 30% of crawled pages are exact or near duplicates (mirrors, print views, session IDs). A single calendar widget (/events?date=…) can generate unbounded URLs and consume the crawl budget for a host forever.",
      options: [
        {
          name: "Store everything and dedupe later in a batch job",
          pros: ["Fetch path stays simple"],
          cons: ["Pays storage and processing for 30% junk", "Traps eat budget meanwhile"],
          verdict: "Lost: dedupe belongs where the cost is cheapest, before indexing.",
        },
        {
          name: "Exact content hash only (SHA-256 of the body)",
          pros: ["Trivial, exact"],
          cons: ["One changed ad or timestamp makes a near-duplicate look unique"],
          verdict: "Necessary but not enough: it only catches byte-identical copies.",
        },
        {
          name: "Exact hash plus SimHash for near-duplicates, and per-host budgets/depth limits for traps",
          pros: ["SimHash finds pages that are 95% the same", "Budget and depth limits cap damage from infinite URL spaces", "Hash lookups are cheap"],
          cons: ["SimHash threshold tuning (false merges vs. misses)", "Budgets can cut off legitimate deep sites"],
          verdict: "Chosen: the two techniques catch different kinds of waste.",
          chosen: true,
        },
      ],
      decision:
        "After parsing, the worker computes a content hash and a 64-bit SimHash over the main text. If the hash matches an existing record (Hamming distance ≤ 3), the page is marked duplicate and not indexed. Unique content goes to the content store for the indexer. Trap defences: a max URL depth, a per-host URL budget per cycle, and detection of repeating path patterns.",
      newRisks: [
        { risk: "A near-duplicate threshold that is too loose merges distinct pages.", mitigation: "Tune on labelled samples, and keep the original blob so decisions can be re-run." },
        { risk: "A legitimate huge site hits its budget and part of it is never crawled.", mitigation: "Budgets scale with measured site quality, and are visible and adjustable by operators." },
      ],
      sayIt:
        "URL dedupe isn't enough, because the same content hides behind different URLs. After parsing I compute an exact hash and a SimHash and skip the duplicates, and I put a depth limit and a per-host budget on every site so a calendar widget can't eat the crawl.",
      delta: {
        addNodes: [{ id: "store", label: "Content store", sub: "unique pages + SimHash index", kind: "db", x: 1400, y: 620 }],
        addEdges: [{ id: "parser-store", from: "parser", to: "store", label: "unique content" }],
      },
    },
    {
      version: "v7",
      title: "Adaptive recrawl scheduler with conditional GETs",
      problem: "A crawl is never done. Pages change at very different rates, and a uniform schedule wastes the fetch budget while missing the pages that matter.",
      evidence: "Budget: 5B fetches a month against 50B known URLs. News homepages change hourly; most blog posts never change. Refreshing everything uniformly means each URL every 10 months.",
      options: [
        {
          name: "Uniform periodic recrawl (everything every N days)",
          pros: ["Trivial"],
          cons: ["Wastes budget on static pages", "Too slow for news"],
          verdict: "Lost: it ignores the single most useful fact: how often a page changes.",
        },
        {
          name: "Recrawl only when the site tells us (sitemaps, RSS, pings)",
          pros: ["Efficient where available"],
          cons: ["Most of the web provides nothing", "Signals can be wrong or missing"],
          verdict: "Useful as one input, but not enough alone.",
        },
        {
          name: "Adaptive schedule from observed change history, weighted by importance, with ETag / If-Modified-Since",
          pros: ["Spends budget where it pays", "304 responses make unchanged pages almost free", "Sitemaps and RSS can be fed in as hints"],
          cons: ["Needs history per URL", "Estimating change rate is approximate", "More scheduler logic"],
          verdict: "Chosen: freshness is a budgeted-optimisation problem, and this is the standard answer.",
          chosen: true,
        },
      ],
      decision:
        "A scheduler periodically scans the URL metadata for URLs with next_due ≤ now and enqueues them (with last ETag) to the frontier at a priority based on importance × expected change. After each fetch, we compare the content hash: if unchanged, double the recrawl interval; if changed, halve it (within bounds).",
      newRisks: [
        { risk: "Recrawl bursts drown out discovery of new URLs.", mitigation: "Reserve a share of the frontier's capacity for new URLs vs. recrawls." },
        { risk: "Some servers ignore conditional headers, so every 'check' is a full download.", mitigation: "Fall back to content-hash comparison, and lengthen the interval for non-cooperative hosts." },
      ],
      sayIt:
        "Freshness is a budget problem. A scheduler uses each URL's change history and importance to set its next-due time, and sends If-None-Match so unchanged pages cost a 300-byte 304. That puts the fetch budget where pages actually change.",
      delta: {
        addNodes: [{ id: "scheduler", label: "Recrawl scheduler", sub: "next_due × importance", kind: "worker", x: 0, y: 420 }],
        addEdges: [
          { id: "scheduler-seen", from: "scheduler", to: "seen", label: "scan due URLs" },
          { id: "scheduler-frontier", from: "scheduler", to: "frontier", label: "enqueue recrawls", async: true },
        ],
      },
    },
  ],

  // ───────────────────────────── Stage 5 — Flows ─────────────────────────────
  flows: [
    {
      id: "crawl-one",
      name: "Fetching one page",
      kind: "write",
      summary: "From 'next URL' to raw page stored and handed to the parsers.",
      hops: [
        { from: "frontier", to: "fetcher", label: "lease URL (host H, ready now)", narration: "A fetcher asks for work and the frontier returns a URL from a host that is allowed right now.", why: "Pull-based: the fetcher takes work only when it has capacity.", },
        { from: "fetcher", to: "dns", label: "resolve H", narration: "The IP comes from the local DNS cache.", why: "Resolved once per host per TTL, not once per URL." },
        { from: "dns", to: "fetcher", label: "93.184.x.x", narration: "The cached answer returns in microseconds.", why: "Avoids 2K lookups/s hammering a resolver." },
        { from: "fetcher", to: "robots", label: "allowed to fetch /path?", narration: "The cached robots.txt rules for H are checked.", why: "Checked on every fetch, but nearly always a cache hit." },
        { from: "robots", to: "fetcher", label: "allowed, crawl-delay 1s", narration: "The path is permitted.", why: "Crawl-delay feeds the host's next_allowed_time." },
        { from: "fetcher", to: "web", label: "GET /path (If-None-Match: etag)", narration: "A non-blocking HTTP request with a 10 s timeout and a 10 MB body cap.", why: "We don't control the origin, so every limit is defensive." },
        { from: "web", to: "fetcher", label: "200 OK + HTML", narration: "The page arrives.", why: "Redirects are followed up to a small limit and re-checked against robots.txt." },
        { from: "fetcher", to: "blob", label: "store raw page", narration: "The body is compressed and written to object storage under a key from the URL and fetch time.", why: "Durable before anything else happens, so a later crash never costs a download." },
        { from: "fetcher", to: "parseq", label: "PageFetched{url, blobRef}", narration: "A small reference message is published.", why: "The claim-check pattern: the queue carries pointers, not 100 KB bodies.", async: true },
        { from: "fetcher", to: "frontier", label: "ack(url) → next_allowed = now + 1s", narration: "The fetcher confirms completion and the frontier starts the host's politeness timer.", why: "The lease is only released after the blob and the message both succeeded." },
      ],
      takeaway: "Order matters: store, publish, then ack. A crash at any point means a duplicate fetch, never a lost page.",
    },
    {
      id: "parse-discover",
      name: "Parsing and discovering new URLs",
      kind: "write",
      summary: "The loop that makes the crawl grow: extract links, dedupe, feed the frontier.",
      hops: [
        { from: "parseq", to: "parser", label: "PageFetched{blobRef}", narration: "A parser picks up a reference from the queue.", why: "Parsers scale independently of fetchers. Add CPU, not network.", async: true },
        { from: "parser", to: "blob", label: "read raw page", narration: "The raw HTML is read from object storage.", why: "Re-parsing later (with a better extractor) needs no re-fetch." },
        { from: "parser", label: "parse HTML → 41 links, main text", narration: "Links are extracted and canonicalised: lowercase host, strip fragments and tracking params, sort query.", why: "Canonical form is the dedupe key. Sloppy rules mean duplicate URLs." },
        { from: "parser", to: "seen", label: "seen?([41 urls])", narration: "One batched call checks all links.", why: "A batch per page is one round trip instead of 41." },
        { from: "seen", to: "frontier", label: "enqueue 6 new URLs", narration: "Only 6 of 41 were new. They go to the frontier with a priority derived from the source page.", why: "~75% of links are repeats. Filtering them here keeps the frontier from exploding.", async: true },
        { from: "parser", to: "store", label: "content hash + SimHash → unique → save", narration: "The page text is hashed and compared against known content.", why: "Duplicates are dropped before they cost index space." },
      ],
      takeaway: "Each page turns into a handful of genuinely new URLs. That ratio, 41 links in and 6 new out, is why dedupe sits in the middle of the loop.",
    },
    {
      id: "politeness",
      name: "How the frontier picks the next URL",
      kind: "read",
      summary: "Priority picks what's important; the heap picks what's allowed. Together they keep every host happy.",
      hops: [
        { from: "frontier", label: "front queue: pick by priority (weighted)", narration: "Higher-priority front queues are sampled more often, but low ones are never starved.", why: "Importance shouldn't turn into starvation of the long tail." },
        { from: "frontier", label: "back queue for host H; heap top: next_allowed ≤ now", narration: "The host heap yields a host whose timer has expired.", why: "Politeness: no host is served before its next_allowed_time." },
        { from: "frontier", to: "fetcher", label: "lease URL from H (visibility 60 s)", narration: "The URL is handed out under a lease.", why: "If the fetcher dies, the lease expires and the URL returns to the queue." },
        { from: "fetcher", to: "web", label: "GET (one request to H)", narration: "Exactly one request goes to H.", why: "Parallelism comes from other hosts, not from H." },
        { from: "fetcher", to: "frontier", label: "ack → next_allowed(H) = now + max(1s, crawl-delay)", narration: "The host is re-inserted into the heap with a future time.", why: "The timer is the whole mechanism. 2,000 hosts × 1 req/s = 2,000 pages/s." },
      ],
      takeaway: "Throughput = number of ready hosts × 1 request per second per host. Politeness and throughput stop competing once the frontier is organised by host.",
    },
    {
      id: "recrawl",
      name: "Recrawling a page that probably hasn't changed",
      kind: "read",
      summary: "Spend the fetch budget where change happens, and make the unchanged case almost free.",
      hops: [
        { from: "scheduler", to: "seen", label: "scan next_due ≤ now, top by importance × change", narration: "The scheduler pulls the URLs that are due.", why: "The metadata record holds change history and ETag." },
        { from: "scheduler", to: "frontier", label: "enqueue recrawl (priority, etag)", narration: "A bulk enqueue with a reserved share of capacity.", why: "Recrawls must not starve discovery of new URLs.", async: true },
        { from: "frontier", to: "fetcher", label: "lease URL + last ETag", narration: "Served like any other URL, subject to the host's politeness timer.", why: "One path for all fetches means one place enforces the rules." },
        { from: "fetcher", to: "web", label: "GET (If-None-Match: etag)", narration: "A conditional request.", why: "Servers that support it answer without sending the body." },
        { from: "web", to: "fetcher", label: "304 Not Modified (~300 B)", narration: "Nothing changed.", why: "300 B instead of 100 KB, about 0.3% of the bandwidth." },
        { from: "fetcher", to: "frontier", label: "ack; next_due = now + 2 × interval", narration: "The fetcher confirms, and the interval is doubled for a stable page.", why: "Stable pages drift toward rare checks, which frees budget for volatile ones." },
      ],
      takeaway: "Conditional GETs plus adaptive intervals mean most refreshes cost almost nothing, and the budget goes to pages that actually change.",
    },
    {
      id: "slow-site",
      name: "Failure: slow, dead or hostile site",
      kind: "failure",
      summary: "One bad host must never tie up fetcher capacity or block the rest of the crawl.",
      hops: [
        { from: "fetcher", to: "web", label: "GET /page (server accepts, then trickles bytes)", narration: "A tarpit: the connection is open but the data barely moves.", why: "Without limits, a handful of these tie up all our connections.", failure: true },
        { from: "fetcher", label: "hard timeouts: connect 3 s, total 10 s, body ≤ 10 MB", narration: "The request is aborted at the deadline.", why: "Every fetch has a total deadline, not just an idle timeout, because a trickle never goes idle.", failure: true },
        { from: "fetcher", label: "per-host breaker: 5 failures → open for 10 min", narration: "The host is marked unhealthy.", why: "Stops us from spending connections, and from hitting a struggling site harder." },
        { from: "fetcher", to: "frontier", label: "nack(url): retry at +1 h, attempt 2/5", narration: "The URL goes back with exponential backoff.", why: "Transient errors are common. After 5 attempts the URL moves to a dead-letter set." },
      ],
      takeaway: "Treat the internet as hostile and unreliable: every call has a deadline, every host has a breaker, and every failure is rescheduled with backoff, never retried in a tight loop.",
    },
    {
      id: "fetcher-dies",
      name: "Failure: a fetcher dies mid-fetch (duplicate processing)",
      kind: "failure",
      summary: "Node death. Leases make sure no URL is lost, and idempotency makes sure duplicates are harmless.",
      hops: [
        { from: "frontier", to: "fetcher", label: "lease 50 URLs (expires in 60 s)", narration: "A fetcher takes a batch and starts working.", why: "A lease is a promise with an expiry." },
        { from: "fetcher", label: "node crashes after storing 20 pages, before acking", narration: "The process dies. 30 URLs were never started, and 20 were stored but never acked.", why: "The worst case: some work is done but unacknowledged.", failure: true },
        { from: "frontier", label: "lease expires → 50 URLs return to their host queues", narration: "No fetcher acked, so after the visibility timeout the URLs become available again.", why: "No heartbeats or failure detector needed. Time is the detector." },
        { from: "frontier", to: "fetcher", label: "re-lease to another fetcher", narration: "A healthy fetcher re-fetches the 20 pages already stored.", why: "Some pages are fetched twice, so we accept at-least-once.", failure: true },
        { from: "fetcher", to: "blob", label: "write blob (same key: hash(url, fetchTime bucket))", narration: "The re-fetch overwrites or adds an equivalent blob.", why: "Idempotent writes make the duplicate harmless." },
        { from: "fetcher", to: "parseq", label: "PageFetched (duplicate message)", narration: "A second message for the same URL goes out.", why: "The parser will drop it because its content hash already exists in the store.", async: true },
      ],
      takeaway: "At-least-once plus idempotent effects is cheaper and more robust than exactly-once. A duplicate fetch costs a little bandwidth. A lost URL would cost correctness.",
    },
    {
      id: "trap",
      name: "Failure: crawler trap (infinite URL space)",
      kind: "failure",
      summary: "A calendar widget generates a new URL for every next-month link, forever.",
      hops: [
        { from: "parser", label: "page /events?date=2031-04 → link to ?date=2031-05 → …", narration: "Every page links to a 'next month' page, endlessly.", why: "Valid HTML, valid URLs, infinite graph. Nothing is technically wrong.", failure: true },
        { from: "parser", to: "seen", label: "seen?([events?date=2031-05]) host budget check", narration: "The URL is new, but the host's count for this cycle is far above budget.", why: "Per-host budgets are the generic defence, with no need to recognise each kind of trap.", failure: true },
        { from: "seen", label: "depth > 15 or budget (1M URLs) exceeded → drop; flag host", narration: "New URLs from the host are dropped, the pattern is logged, and the host is flagged for operator review.", why: "Detect by pattern (the repeating path shape) and by volume. Either is enough." },
        { from: "seen", to: "frontier", label: "enqueue only the allowed URLs", narration: "Remaining legitimate links still get through.", why: "A trap shouldn't make us lose the real parts of the site.", async: true },
      ],
      takeaway: "You can't enumerate every trap, so cap the damage: depth limits, per-host budgets and pattern detection turn an infinite space into a bounded cost.",
    },
    {
      id: "frontier-failover",
      name: "Failure: frontier partition fails over (politeness state lost)",
      kind: "failure",
      summary: "Stampede. A replacement partition has no memory of when each host was last fetched.",
      hops: [
        { from: "frontier", label: "partition 7 owner dies; replica promoted", narration: "The URLs are safe on the replica, but the in-memory timers (next_allowed per host) weren't replicated at full fidelity.", why: "Persisting a timer per host per second would cost more than it's worth.", failure: true },
        { from: "frontier", label: "naive: every host immediately eligible", narration: "If every host looks ready, all 2,000 hosts in the partition get a request at once, and many were fetched less than a second ago.", why: "A burst against thousands of sites at once, and the sites we hit twice in a row remember it.", failure: true },
        { from: "frontier", label: "recover: next_allowed = now + jitter(0–5 s) for every host", narration: "On promotion, every host starts with a randomised short delay.", why: "Randomised delays spread the restart out, and erring toward polite costs a few seconds of throughput." },
        { from: "frontier", to: "fetcher", label: "resume leasing gradually", narration: "Fetchers are served from the restored heap.", why: "A graceful ramp instead of a thundering herd." },
      ],
      takeaway: "When you lose timing state, recover on the polite side. A few seconds of lost throughput is cheap, and an angry webmaster is not.",
    },
  ],

  // ───────────────────────────── Stage 6 — Deep dives ─────────────────────────────
  deepDives: [
    {
      id: "frontier",
      title: "Why the frontier is not 'just a Kafka topic'",
      question: "We have a queue between pipeline stages everywhere else. Why not use one for the URL list?",
      context: [
        "Kafka, SQS and RabbitMQ are ordered (or roughly ordered) logs of messages. Consumers take the next one.",
        "The frontier needs to answer 'what's the next URL I may fetch NOW?', which depends on wall-clock time per host and on priority.",
        "Between fetch and parse, any queue works. Here, the semantics matter.",
      ],
      options: [
        {
          name: "One Kafka topic, many consumers",
          pros: ["Durable, scalable, familiar"],
          cons: ["No per-key delay: consumers get the next message regardless of host", "Head-of-line blocking: a slow host's messages hold up the partition", "No priority levels"],
          verdict: "Lost as the frontier. Right for the parse queue, where order and timing don't matter.",
        },
        {
          name: "Topic per host (or per priority)",
          pros: ["Per-host ordering"],
          cons: ["Millions of hosts means millions of topics", "Still no 'not before time' semantics"],
          verdict: "Lost: topic count explodes, and it still doesn't solve the timing problem.",
        },
        {
          name: "Purpose-built frontier: front queues (priority), back queues (per host), min-heap on next_allowed_time, partitioned by host hash, persisted and replicated",
          pros: ["Politeness and priority are native", "Serves any ready host, so no idle workers", "Leases give crash recovery", "Scales by partitioning hosts"],
          cons: ["Custom code to build and operate", "Timer state needs a recovery policy"],
          verdict: "Chosen: the constraints (time per host plus priority) aren't expressible in a generic broker.",
          chosen: true,
        },
      ],
      recommendation:
        "Build the frontier as its own service backed by durable storage (e.g. a log for URLs plus in-memory heaps rebuilt on recovery). Use plain brokers everywhere ordering and timing don't matter: parse queue, discovered-URL buffers, events.",
      sayIt:
        "A broker gives me an order, but the frontier needs 'not before time T' per host plus priorities. So the frontier is a purpose-built scheduler: priority front queues, a back queue per host, and a heap keyed on next-allowed-time. Everywhere else, like the parse queue, a plain Kafka topic is the right tool.",
    },
    {
      id: "dedupe",
      title: "Dedupe at two levels: the URL and the content",
      question: "How do we avoid fetching, storing and indexing the same thing twice?",
      context: [
        "URL-level dedupe saves fetches. Content-level dedupe saves storage and keeps the index clean.",
        "The seen set has ~50B entries. Exact membership at that size is a sharding problem.",
        "False positives and negatives have different costs in each layer.",
      ],
      options: [
        {
          name: "Exact set only (hash set / KV)",
          pros: ["No false positives"],
          cons: ["Every one of ~200B link checks per month goes to a 400 GB store", "Most checks are for URLs that are new (cheap to answer) or repeats (could be answered in RAM)"],
          verdict: "Correct but wasteful. Needs a screen in front.",
        },
        {
          name: "Bloom filter only",
          pros: ["Tiny and in-memory (~60 GB total)", "Super fast"],
          cons: ["~1% false positives: a genuinely new URL is wrongly skipped and never crawled", "Can't delete or enumerate, which hurts recrawl"],
          verdict: "Lost as the sole mechanism: silently never crawling 1% of new URLs is a correctness bug.",
        },
        {
          name: "Bloom filter in front of an exact sharded KV (Bloom says 'maybe' → check KV)",
          pros: ["'Definitely new' is answered in RAM without a disk read", "Exact when it matters, so no URL is wrongly dropped", "The KV also holds crawl metadata"],
          cons: ["Two structures", "Bloom rebuild on a schedule"],
          verdict: "Chosen for URLs: a false positive costs one KV read, not a lost URL.",
          chosen: true,
        },
        {
          name: "Content layer: SHA-256 for exact, SimHash for near-duplicates",
          pros: ["Catches mirrors and templated pages", "SimHash tolerates small differences (ads, timestamps)"],
          cons: ["Threshold tuning", "SimHash lookup needs a Hamming-distance index (bit-sampling or permuted tables)"],
          verdict: "Chosen for content: it catches what canonicalisation can't.",
          chosen: true,
        },
      ],
      recommendation:
        "Two layers with different failure modes. For URLs: Bloom screening an exact KV, so errors only cost a read. For content: exact hash plus SimHash with a conservative threshold, keeping the raw blob so decisions can be re-run.",
      sayIt:
        "URL dedupe uses a Bloom filter in front of an exact store, so a false positive just costs a read, never a missed page. Content dedupe is a separate layer with SHA-256 and SimHash, because the same article lives at many URLs.",
    },
    {
      id: "queue-vs-api",
      title: "Where queues belong in a crawler (and where they don't)",
      question: "Everything in a crawler is async in spirit. So is everything a queue?",
      context: [
        "A queue is right when the sender doesn't need an answer and the receiver is slower, bursty or can fail.",
        "A synchronous call is right when the next step can't proceed without the answer, or when the other side isn't ours.",
        "A crawler has both, and mixing them up causes most of its production incidents.",
      ],
      options: [
        {
          name: "Queue everything, including DNS and robots.txt lookups",
          pros: ["Uniform architecture"],
          cons: ["A cached DNS answer takes microseconds, but a queue round trip takes milliseconds", "A URL waits in a queue for a decision a local cache could answer immediately"],
          verdict: "Lost: it replaces a fast local read with a slow distributed one.",
        },
        {
          name: "Synchronous calls everywhere (fetcher → parser → dedupe → frontier)",
          pros: ["Easy to trace"],
          cons: ["Slowest stage sets the pace for all", "No buffering, so a parser outage stops the fetchers", "One crash loses all in-flight work"],
          verdict: "Lost: this is the v1 design with network calls added.",
        },
        {
          name: "Queues between internal stages; sync calls (with deadlines) to the outside world and to fast caches",
          pros: ["Each stage scales and fails independently", "Backpressure and retry come from the queues", "Outside calls get timeouts and breakers"],
          cons: ["More infrastructure to run", "At-least-once everywhere, so idempotency is mandatory"],
          verdict: "Chosen: it uses each mechanism where it fits.",
          chosen: true,
        },
      ],
      recommendation:
        "Rule: if the answer is needed to proceed, or the callee isn't ours, make a synchronous call with a deadline (DNS, robots.txt, origin fetch, seen-check). If it's handing work to a different-speed stage, use a queue (fetch → parse, scheduler → frontier). The frontier is the exception: a scheduler with timing semantics.",
      sayIt:
        "Queues connect stages that run at different speeds: fetch to parse, recrawl scheduler to frontier. Synchronous calls with hard deadlines face the outside world: DNS, robots.txt, the origin server. The frontier looks like a queue but needs per-host timing, so it's a purpose-built scheduler.",
    },
  ],

  // ───────────────────────────── Stage 7 — Defend ─────────────────────────────
  tradeOffs: [
    {
      decision: "Purpose-built frontier (priority + per-host queues)",
      alternative: "A plain Kafka topic or FIFO",
      why: "Politeness needs 'not before time T' per host, which a log can't express.",
      whenToSwitch: "Never for the frontier. For a small single-site crawl, a plain queue with a sleep is fine.",
    },
    {
      decision: "Queue between fetch and parse",
      alternative: "Parse inline in the fetcher",
      why: "I/O-bound and CPU-bound work scale separately, and a parse failure never costs a re-fetch.",
      whenToSwitch: "For a small crawl, where the extra moving part isn't worth it.",
    },
    {
      decision: "Store raw pages in object storage, pass references",
      alternative: "Put the page body on the queue",
      why: "100 KB messages bloat the broker, and we want the raw page durable anyway.",
      whenToSwitch: "For tiny pages (JSON APIs under ~10 KB), inline bodies are simpler.",
    },
    {
      decision: "At-least-once with idempotent effects",
      alternative: "Exactly-once processing",
      why: "A duplicate fetch costs a little bandwidth, while exactly-once costs coordination on every URL.",
      whenToSwitch: "If fetches were billed per call (a paid API), dedupe harder at the lease level.",
    },
    {
      decision: "Bloom filter + exact KV for URLs",
      alternative: "Bloom filter alone",
      why: "A Bloom false positive silently drops a real URL. Backing with an exact store turns it into a wasted read.",
      whenToSwitch: "For a throwaway crawl where missing ~1% is acceptable and memory is tight.",
    },
    {
      decision: "Adaptive recrawl with conditional GET",
      alternative: "Uniform recrawl interval",
      why: "Pages change at wildly different rates, and a fixed budget should chase change.",
      whenToSwitch: "When the site publishes reliable sitemaps or push signals. Use them as the primary trigger.",
    },
    {
      decision: "Pull-based leasing from the frontier",
      alternative: "Frontier pushes URLs to fetchers",
      why: "Fetchers control their own pace, and a crashed worker's leases expire on their own.",
      whenToSwitch: "Never at this scale. Push needs per-worker flow control and failure detection.",
    },
  ],

  bottlenecks: [
    { item: "The frontier partition (stateful, holds politeness timers)", mitigation: "Partition by host hash, replicate, persist next_allowed, recover with jittered delays." },
    { item: "DNS resolution", mitigation: "Own caching resolvers, resolve once per host per batch, honour TTLs with a minimum." },
    { item: "URL-seen store for very large hosts", mitigation: "Sub-shard by URL hash within a host; keep the Bloom filter in RAM." },
    { item: "Object storage write rate (small files)", mitigation: "Batch many pages into large compressed container files (WARC) instead of one object per page." },
    { item: "Parse queue backlog", mitigation: "Consumer lag alerts and autoscaling parsers. Raw pages are safe in storage, so lag costs delay, not data." },
    { item: "Skew: a handful of huge hosts", mitigation: "Per-host crawl budgets, and priority weighting so they can't monopolise fetchers." },
    { item: "Robots.txt / DNS poisoning or redirects to internal IPs (SSRF)", mitigation: "Block private/loopback ranges at the fetcher, re-validate after each redirect, and run fetchers in an isolated network." },
  ],

  followUps: [
    {
      question: "How would you crawl JavaScript-rendered pages?",
      answer: [
        "Add a render stage: a pool of headless-browser workers (Chromium) between the fetcher and the parser, fed by its own queue.",
        "Only send pages that need it, detected heuristically (almost no text in the raw HTML plus large JS bundles), because rendering is 10–100× more expensive.",
        "Rendering needs its own politeness: it fires many sub-requests (scripts, XHR) at the same host, so those count against the host's budget too.",
      ],
    },
    {
      question: "How do you decide which pages are most important to crawl first?",
      answer: [
        "Link-based signals (PageRank-style) from the graph we've already crawled, plus domain-level authority.",
        "Observed change frequency and past usefulness (how often results from this page are served).",
        "Feed it into the frontier's priority. Importance changes the order, while politeness still sets the pace per host.",
      ],
    },
    {
      question: "How do you scale this to multiple data centres?",
      answer: [
        "Partition hosts across regions by hash so exactly one region crawls a given host (one politeness timer owner), preferably near the host's geography to reduce latency.",
        "Each region has its own frontier partitions, fetchers and parsers. Only the URL metadata (seen set) and final content need global coordination.",
        "Cross-region discovered links are routed to the owning region's frontier via a queue.",
      ],
    },
    {
      question: "What if a site asks us to stop crawling?",
      answer: [
        "robots.txt Disallow and Crawl-delay are honoured at fetch time, and the robots cache TTL is short (~24 h) so changes take effect quickly.",
        "For takedown requests, add the host to a blocklist checked by the frontier at enqueue and lease time, and purge stored content through the same pipeline as other deletions.",
        "Identify ourselves with a clear User-Agent and a contact URL, so webmasters can reach us instead of blocking us.",
      ],
    },
    {
      question: "How would you detect that a page has actually changed, not just its ads?",
      answer: [
        "Hash only the main content (strip boilerplate, nav, ads, timestamps) before comparing, and use SimHash with a distance threshold instead of exact equality.",
        "Track the real change rate (meaningful changes per fetch), not raw byte differences, so the recrawl interval isn't driven by rotating ads.",
      ],
    },
  ],

  mistakes: [
    "Using a global FIFO queue for URLs and hammering a few big sites.",
    "Forgetting robots.txt, crawl-delay and a clear User-Agent.",
    "Dedupe by raw URL only: no canonicalisation and no content-level dedupe.",
    "Fetching and parsing in the same worker, so one scaling profile fits neither job.",
    "No deadlines on outbound fetches, so a few tarpit sites freeze the fleet.",
    "Ignoring crawler traps: no depth limit and no per-host budget.",
    "Promising exactly-once instead of designing for at-least-once and idempotency.",
  ],

  redFlags: [
    "'We'll just put the URLs in Kafka', with no answer for per-host politeness.",
    "A single in-memory visited set for billions of URLs.",
    "No mention of what happens when a worker dies holding URLs.",
    "Treating freshness as 'recrawl everything every day'.",
    "Ignoring SSRF: a crawler follows links to internal addresses.",
  ],
};
