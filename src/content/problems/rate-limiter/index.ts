import type { Problem } from "../../types";

/**
 * Rate Limiter
 *
 * Narrative spine: a rate limiter is a TINY decision (allow / deny) made on EVERY request.
 *  - it sits on the hot path     -> it must add ~1-2 ms, so one network hop, one atomic operation
 *  - the state is tiny but shared -> counters must be visible to every gateway, or limits multiply by N
 *  - its failure is a policy call -> fail open (protect users) or fail closed (protect the backend)?
 * The only parts that belong on a queue are the things that are NOT the decision: events, analytics,
 * abuse detection. Everything that must answer "yes or no, right now" is a synchronous call.
 */
export const rateLimiter: Problem = {
  slug: "rate-limiter",
  title: "Rate Limiter",
  tagline: "A one-millisecond allow/deny decision on every request, with counters shared across a fleet",
  difficulty: "Medium",

  overview: {
    whatItIs:
      "A rate limiter caps how many requests a caller (a user, an API key, an IP, a tenant) may make in a window of time. Request number 101 in a 100-per-minute limit is turned away with HTTP 429 instead of being served.",
    whatItDoes: [
      "Protects the backend: one buggy client in a retry loop can't take down everyone else.",
      "Enforces fairness: a single noisy tenant can't use up the capacity that 1,000 quiet tenants paid for.",
      "Enforces the business model: free tier gets 60 req/min, paid tier gets 6,000.",
      "Blunts abuse: credential stuffing, scraping and OTP brute-forcing all rely on volume.",
      "Controls cost: every request to a downstream paid API (or an LLM) costs money.",
    ],
    whereUsed: [
      "API gateways (Kong, Envoy, AWS API Gateway) in front of every public API",
      "Login and OTP endpoints: 5 attempts per account per 15 minutes",
      "Outbound calls to third-party APIs that cap you (the limiter protects them, and your bill)",
      "Payment and banking APIs: per-merchant TPS contracts",
    ],
    coreIdea:
      "Keep a tiny counter per caller, update it atomically on every request, and make sure every gateway sees the same counter. The hard part is not the algorithm. It is keeping the counter shared and fast while the fleet scales, and deciding what to do when the counter store is down.",
    notToBeConfusedWith: [
      { term: "Load shedding", difference: "Drops traffic because the SERVER is overloaded, whoever sent it. A rate limiter drops traffic because a CALLER exceeded their quota, even if the server is idle." },
      { term: "Circuit breaker", difference: "Protects the caller from a failing dependency. A rate limiter protects the dependency from the caller." },
      { term: "Backpressure / queueing", difference: "Delays excess work instead of rejecting it. Useful when the caller can wait (batch jobs), wrong when the caller is a user holding a spinner." },
    ],
  },

  // ───────────────────────────── Stage 1 — Understand ─────────────────────────────
  interviewQuestion:
    "Design a rate limiter for a public API platform. It should limit how many requests each client can make, work across a fleet of servers, and add as little latency as possible.",

  clarifyingQuestions: [
    {
      question: "Who are we limiting: user, API key, IP address, tenant? Or several at once?",
      whyItMatters:
        "The limiting key decides the cardinality of the state (how many counters exist) and how easy it is to evade. IP limits punish whole offices behind one NAT; user limits can be dodged by creating accounts.",
      answer: "Mainly per API key and per tenant, plus a per-IP limit on unauthenticated endpoints like login.",
      designImpact:
        "A request can match several rules, each with its own counter, so one request may need more than one check. Rules need a model of their own (key type + endpoint + limit), not a hard-coded constant.",
    },
    {
      question: "Hard limit or soft limit? Do small bursts above the average rate need to be allowed?",
      whyItMatters:
        "Real traffic is bursty. A strict '10 per second' that rejects 11 requests in a single millisecond annoys legitimate clients. Whether bursts are allowed picks the algorithm.",
      answer: "Allow short bursts, but enforce the long-run average. A client at 100 req/min may burst 20 at once.",
      designImpact:
        "Token bucket fits: bucket capacity is the burst, refill rate is the average. Fixed-window counters are out because they allow a 2× burst at window boundaries.",
    },
    {
      question: "How many requests per second do we see, and how many servers sit in front?",
      whyItMatters:
        "Per-request overhead multiplies by the QPS. At a few thousand QPS you can use any database. At a million, every extra millisecond and every extra network round trip is real money.",
      answer: "1M req/s at peak across the platform, served by about 20 gateway instances.",
      designImpact:
        "The counter store must handle 1M atomic ops/s, so it has to be sharded, and the check must be one round trip. The 20 gateways mean per-gateway counters would be wrong (see the next stage).",
    },
    {
      question: "What should happen if the rate limiter itself breaks?",
      whyItMatters:
        "This is the most important question and most candidates never ask it. The limiter is a new dependency on every request, so its failure mode becomes the platform's failure mode.",
      answer: "Never take the API down because the limiter is down. Prefer to let traffic through, but still protect against a runaway client.",
      designImpact:
        "Fail open, with a local approximate limiter as a safety net. Login and OTP endpoints are the exception: they fail closed, because letting brute force through is worse than an outage.",
    },
    {
      question: "Do limits change per customer, and how fast must a change take effect?",
      whyItMatters:
        "Limits that need a redeploy to change are a product problem. How fast changes must propagate decides between polling, push, and a shared config store.",
      answer: "Yes: tiers and per-customer overrides. A change should apply within about 10 seconds, with no deploy.",
      designImpact:
        "A rules service plus a local cache in each gateway. A 10-second staleness budget allows polling, so no distributed lock is needed.",
    },
    {
      question: "Should the client know why it was rejected and when to retry?",
      whyItMatters:
        "A bare 429 makes clients retry immediately, which makes the overload worse. Information in the response is part of the design, not decoration.",
      answer: "Yes. Return 429 with Retry-After, and X-RateLimit-Remaining on every response.",
      designImpact:
        "The check must return more than a boolean: remaining tokens and seconds until refill. This is also why 'deny' must be answered synchronously, in the same request.",
    },
  ],

  requirements: {
    functional: [
      "Check: for each request, decide allow or deny against every rule that matches (API key, tenant, IP, endpoint).",
      "Reject over-limit requests with HTTP 429, Retry-After, and rate-limit headers.",
      "Rules: configurable per tier, per customer and per endpoint, changeable at runtime.",
      "Visibility: emit an event whenever a request is rejected, so abuse can be detected and customers can be told.",
    ],
    nonFunctional: [
      { name: "Added latency", target: "p99 < 3 ms for the check", why: "It sits on every request. A 20 ms limiter on a 100 ms API is a 20% tax." },
      { name: "Throughput", target: "1M checks/s peak", why: "One check per API request, no sampling." },
      { name: "Accuracy", target: "Within ~5% of the configured limit under normal operation", why: "Exactness would need global locking. A few percent of drift is acceptable; double the limit is not." },
      { name: "Availability", target: "99.99%, and the API stays up if the limiter is down", why: "The limiter must never be the reason the platform is unavailable." },
      { name: "Rule freshness", target: "Changes visible within 10 s", why: "Operators raise a limit during an incident and need it to take effect." },
    ],
    outOfScope: [
      "Billing and quota accounting (monthly usage is a different, durable system)",
      "DDoS mitigation at L3/L4 (handled by the CDN / WAF before traffic reaches us)",
      "Adaptive limits driven by backend health (a follow-up)",
    ],
  },

  // ───────────────────────────── Stage 2 — Size ─────────────────────────────
  estimates: [
    {
      title: "Check throughput",
      reasoning: [
        "Peak API traffic: 1,000,000 req/s",
        "Every request needs a check → 1,000,000 checks/s",
        "One Redis node does ~100K atomic ops/s with headroom",
        "1M ÷ 100K = 10 shards, ~20 once we leave 2× headroom for skew and failover",
      ],
      result: "≈ 20 Redis shards, each handling ~50K ops/s",
      soWhat:
        "One counter store cannot do this, so counters must be sharded by limiting key. A check must be exactly one round trip to one shard, which rules out multi-step read-then-write patterns.",
    },
    {
      title: "Counter memory",
      reasoning: [
        "Active keys: 50M API keys/users × ~2 rules each = 100M buckets",
        "Per bucket: key (~40 B) + tokens (8 B) + last-refill timestamp (8 B) + Redis overhead (~50 B) ≈ 100 B",
        "100M × 100 B = 10 GB total, spread over 20 shards ≈ 500 MB per shard",
        "Idle buckets expire with a TTL (a bucket idle long enough to refill is the same as a fresh one)",
      ],
      result: "≈ 10 GB total, 500 MB per shard",
      soWhat:
        "Memory is not the constraint. Operations per second is. We shard for throughput, not capacity, and we can keep everything in RAM with no persistence requirement.",
    },
    {
      title: "Latency budget",
      reasoning: [
        "API p99 target: 100 ms; limiter budget: ≤ 3% of that = 3 ms",
        "Redis round trip inside one AZ: 0.3–0.5 ms",
        "Lua script execution: ~20 µs",
        "Serialisation, pooled connection, queueing: ~1 ms",
      ],
      result: "≈ 1.5–2 ms with one round trip; ~4 ms with two",
      soWhat:
        "Two round trips already blow the budget. This is why the check is a single atomic Lua script and why Redis must be in the same AZ as the gateways, not a remote region.",
    },
    {
      title: "What happens without shared counters",
      reasoning: [
        "20 gateways, limit = 100 req/min per key",
        "If each gateway counts on its own and the load balancer spreads evenly: each allows 100/min",
        "Effective limit = 20 × 100 = 2,000 req/min, a 20× overshoot",
      ],
      result: "Per-gateway counters allow N× the configured limit",
      soWhat:
        "Local counters are wrong, not just imprecise. Either all gateways share one counter, or the load balancer routes each key to the same gateway. We pick the shared counter (next stages explain why).",
    },
    {
      title: "Rejection event volume",
      reasoning: [
        "Assume 1% of requests are rejected at peak: 1M × 1% = 10,000 events/s",
        "Event size ~200 B → 2 MB/s",
        "One Kafka partition handles ~10 MB/s",
      ],
      result: "≈ 10K events/s, ~2 MB/s",
      soWhat:
        "Small enough for a handful of partitions, and nothing here has to be synchronous. This is the part of the system where a queue is the right tool, because nobody is waiting on the answer.",
    },
  ],

  // ───────────────────────────── Stage 3 — Start simple ─────────────────────────────
  api: [
    {
      method: "ANY",
      path: "/api/*  (every public request)",
      request: "Authorization: Bearer <api-key>",
      response: "200 OK\nX-RateLimit-Limit: 100\nX-RateLimit-Remaining: 37\nX-RateLimit-Reset: 12",
      notes: "The limiter is not an endpoint callers use. It's a filter in front of every endpoint. Allowed responses carry the headers so clients can pace themselves.",
    },
    {
      method: "ANY",
      path: "/api/*  (over the limit)",
      response: "429 Too Many Requests\nRetry-After: 12\nX-RateLimit-Remaining: 0",
      notes: "Rejection is synchronous and cheap. Retry-After is how we stop well-behaved clients from hammering us.",
    },
    {
      method: "PUT",
      path: "/admin/rules/{ruleId}",
      request: '{ "key": "tenant", "endpoint": "/search", "limit": 600, "windowSec": 60, "burst": 100 }',
      response: "200 { version: 43 }",
      notes: "The control plane. Rules are versioned so a gateway can tell whether it has the latest.",
    },
    {
      method: "internal",
      path: "check(key, ruleId, cost=1)",
      response: "{ allowed: true, remaining: 37, retryAfterMs: 0 }",
      notes: "The only hot-path call. One round trip, atomic, and it returns enough to build the headers. Not exposed to clients.",
    },
  ],

  communication: {
    rule:
      "If the caller is blocked waiting for the answer (allow or deny?), it is a synchronous call. If nobody is waiting (record, analyse, react), it goes through a queue. A rate limiter is mostly the first kind, with a small second kind hanging off it.",
    choices: [
      {
        interaction: "Gateway → counter store: 'may this request pass?'",
        style: "sync-api",
        why: "The request is held open until we know. The answer decides whether the backend is called at all. A queue would add milliseconds and cannot return a decision to a waiting HTTP request.",
        ifWrong: "Putting the check on a queue turns a 1.5 ms decision into a 10+ ms round trip through a broker, and the gateway still has to wait for the reply, so you've built a slow RPC.",
      },
      {
        interaction: "Gateway → client: the 429 response",
        style: "sync-api",
        why: "The client needs 429 and Retry-After on this very request. Rejecting later is not rejecting.",
        ifWrong: "Accepting the request into a queue and 'rejecting it later' means the backend still does the work, which defeats the purpose.",
      },
      {
        interaction: "Gateway → rule changes (pushing new limits)",
        style: "hybrid",
        why: "Admin writes are a normal API call to the rules service. Gateways pick changes up by polling or watching, off the request path. The request path only reads an in-memory table.",
        ifWrong: "If every check called the rules service, it would be on the hot path at 1M/s. If rules were pushed only through a queue, a missed message leaves a gateway stale forever, so we also keep a periodic poll.",
      },
      {
        interaction: "Gateway → 'LimitExceeded' events for analytics and abuse detection",
        style: "async-queue",
        why: "Nobody waits for this. It can lag by seconds, arrive twice, or be sampled under pressure. A queue absorbs spikes and decouples the gateway from slow consumers.",
        ifWrong: "A synchronous call to the abuse service on every rejection means a slow abuse service slows every 429, and during an attack (when rejections peak) it takes the gateway down with it.",
      },
      {
        interaction: "Abuse worker → block list (auto-ban a key)",
        style: "async-queue",
        why: "Detection runs on a stream of events, and its output lands in the same counter store the check already reads. The block takes effect within seconds, which is fine for abuse.",
        ifWrong: "If detection ran inline, every request would pay for analysis that only matters for a tiny fraction of callers.",
      },
      {
        interaction: "Your service → a third-party API that has its own limit",
        style: "async-queue",
        why: "Here YOU are the one being limited and you can afford to wait. Put calls on a queue and drain it at the allowed rate (leaky bucket). Excess work is delayed instead of failed.",
        ifWrong: "Calling the third-party directly and handling 429s with retries causes retry storms and wastes your own capacity on doomed calls.",
      },
    ],
  },

  dataModel: [
    {
      entity: "bucket (in Redis)",
      fields: [
        { name: "key", type: "string", note: "rl:{ruleId}:{apiKey}  (hash-tag on the key so one caller maps to one shard)" },
        { name: "tokens", type: "float", note: "current tokens, capped at burst" },
        { name: "ts", type: "int (ms)", note: "last refill time, from Redis TIME, not the gateway clock" },
        { name: "TTL", type: "seconds", note: "≈ time to refill from empty, so idle buckets vanish" },
      ],
      accessPatterns: [
        "One atomic read-refill-consume per request, on exactly one key",
        "No scans, no joins, no cross-key transactions",
      ],
      insight:
        "State is 16 bytes of numbers per caller. The whole problem is not storage: it is performing a read-modify-write on that state a million times a second without a race.",
    },
    {
      entity: "rule (in the rules store)",
      fields: [
        { name: "ruleId", type: "string" },
        { name: "keyType", type: "ENUM(api_key, tenant, ip)" },
        { name: "endpoint", type: "string pattern", note: "'/search', '/login', '*'" },
        { name: "limit / windowSec / burst", type: "ints", note: "refill rate = limit ÷ windowSec; capacity = burst" },
        { name: "failMode", type: "ENUM(open, closed)", note: "per rule, so login can fail closed" },
        { name: "version", type: "bigint", note: "monotonic, lets gateways detect stale rules" },
      ],
      accessPatterns: [
        "Gateways load ALL rules (thousands, not millions) and cache them in memory",
        "Admin writes are rare and need history for audit",
      ],
      insight:
        "Rules are tiny and change rarely, so they never touch the hot path as a query. They are copied into gateway memory. Per-customer overrides still fit: it's a few million rows at most.",
    },
  ],

  v1: {
    title: "v1: counter in the app's memory",
    description: [
      "One application server with a HashMap<apiKey, counter> inside the process, reset every minute.",
      "On each request: increment the counter for the caller's key. If it exceeds the limit, return 429.",
      "This is correct for one server and takes ten lines of code (Guava RateLimiter, Bucket4j in-memory). It's the right start: no network, no extra component, zero added latency.",
    ],
    diagram: {
      nodes: [
        { id: "client", label: "Client", sub: "API consumer", kind: "client", x: 0, y: 200 },
        { id: "api", label: "App server", sub: "in-memory counters", kind: "service", x: 700, y: 200 },
      ],
      edges: [{ id: "client-api", from: "client", to: "api", label: "HTTPS" }],
    },
    whatBreaksFirst: [
      "We need a second server for capacity, and now each has its own counters. The real limit becomes N × the configured one.",
      "Counters are lost on every restart or deploy, so a deploy hands every abuser a free reset.",
      "The limiter runs inside the service it protects. A flood still costs us TLS, parsing and thread time before we reject it.",
      "Limits are constants in code. Changing one is a release.",
    ],
  },

  // ───────────────────────────── Stage 4 — Evolve ─────────────────────────────
  evolution: [
    {
      version: "v2",
      title: "Move the limiter to the edge: a gateway in front of the backends",
      problem: "The limiter lives inside each service. We have dozens of services, each re-implementing it, and a flood still reaches business code before being rejected.",
      evidence: "Rejecting inside the app costs a full request parse + auth + thread. At 1M req/s of mostly-abusive traffic, the backend burns CPU saying 'no'. 40 services × their own limiter code = 40 versions of the same bug.",
      options: [
        {
          name: "Client-side limiting",
          pros: ["Zero server cost", "Good manners for cooperative clients"],
          cons: ["A malicious client simply ignores it", "Can't be trusted for protection or billing"],
          verdict: "Lost as a primary defence: we can't enforce anything on code we don't control. Keep it as a courtesy in our own SDKs.",
        },
        {
          name: "Library inside each service",
          pros: ["No extra hop", "Can use business context (e.g. the order's value)"],
          cons: ["Every team implements and upgrades it separately", "Rejection happens after expensive work", "Polyglot fleet needs a library per language"],
          verdict: "Lost as the default. Still right for rules that need business data, which a gateway can't see.",
        },
        {
          name: "Gateway / middleware in front of all services",
          pros: ["One implementation, one policy", "Rejects before any backend work", "Services stay unaware"],
          cons: ["Gateway becomes a critical shared component", "Can only use what is in the request (key, path, IP)"],
          verdict: "Chosen: the limiter is the very first thing that should happen to a request, and gateways already terminate TLS and authenticate.",
          chosen: true,
        },
      ],
      decision:
        "Introduce an API gateway tier that terminates TLS, authenticates, applies rate-limit rules and only then forwards to backends. Counters are still local to each gateway for now.",
      newRisks: [
        { risk: "The gateway is a shared dependency on every request.", mitigation: "Stateless, many instances across AZs, behind a managed LB." },
        { risk: "Each gateway still has its own counters: with N gateways the limit is still N× too high.", mitigation: "That's the next step. We fix placement first, then state." },
      ],
      sayIt:
        "I want to reject as early and cheaply as possible, so the limiter goes in a gateway in front of every service rather than inside them. One policy, one implementation, and abusive traffic never reaches business code.",
      delta: {
        addNodes: [{ id: "gw", label: "API gateway", sub: "rate-limit filter × N", kind: "lb", x: 330, y: 200 }],
        updateNodes: [{ id: "api", label: "Backend services", sub: "protected, limiter-unaware" }],
        removeEdges: ["client-api"],
        addEdges: [
          { id: "client-gw", from: "client", to: "gw", label: "HTTPS" },
          { id: "gw-api", from: "gw", to: "api", label: "forward if allowed" },
        ],
      },
    },
    {
      version: "v3",
      title: "Shared counters in Redis",
      problem: "Each gateway counts separately, so a caller's real limit is multiplied by the number of gateways.",
      evidence: "20 gateways × 100 req/min = up to 2,000 req/min allowed for a key limited to 100. Observed by sending 500 requests through the LB: all 500 pass.",
      options: [
        {
          name: "Sticky routing: hash the key to a gateway at the LB",
          pros: ["No shared store, counters stay local and fast"],
          cons: ["Gateway failure or scale-out reshuffles keys and resets counters", "Hot caller pins one gateway", "LB must understand API keys (L7 hashing on a header)"],
          verdict: "Lost: it couples load balancing to rate limiting, and every scale event gives abusers a reset.",
        },
        {
          name: "Divide the limit: each gateway allows limit ÷ N",
          pros: ["No shared state at all"],
          cons: ["Needs exact knowledge of N", "Uneven load means a caller is rejected by an idle-budget gateway while others sit unused", "Breaks on autoscaling"],
          verdict: "Lost as primary. It resurfaces later as the safety-net fallback.",
        },
        {
          name: "Central counter store (Redis)",
          pros: ["One source of truth", "In-memory, sub-millisecond", "Atomic scripts available", "Native key expiry"],
          cons: ["A network hop on every request", "A new dependency that must be sharded and made highly available"],
          verdict: "Chosen: the extra 1 ms hop is cheap compared with a 20× error, and Redis is purpose-built for tiny hot counters.",
          chosen: true,
        },
      ],
      decision:
        "All gateways read and update counters in a Redis cluster, keyed by rule + caller. Gateways remain stateless. Redis sits in the same AZ as the gateways to protect the latency budget.",
      newRisks: [
        { risk: "A Redis hop (~0.5 ms) is added to every request.", mitigation: "Pooled connections, same-AZ placement, and a single round trip per check (next step)." },
        { risk: "Redis is now a single point of failure for the platform.", mitigation: "Sharding plus replicas, and a defined failure mode (v6)." },
        { risk: "One celebrity key can overload one shard.", mitigation: "Limits are per caller and a single caller's rate is bounded by the limit itself, so heat is naturally capped. Revisit in the deep dives." },
      ],
      sayIt:
        "Counting per gateway multiplies the limit by the fleet size, 20× here. So the counters move into a shared Redis. It adds a sub-millisecond hop, but it gives us one source of truth, which is the whole point.",
      delta: {
        addNodes: [{ id: "redis", label: "Counter store", sub: "Redis, same AZ", kind: "cache", x: 330, y: -60 }],
        updateNodes: [{ id: "gw", sub: "stateless × N, shared counters" }],
        addEdges: [{ id: "gw-redis", from: "gw", to: "redis", label: "check(key)" }],
      },
    },
    {
      version: "v4",
      title: "Make the check atomic: token bucket in a Lua script",
      problem: "'GET the count, compare, then SET it back' lets two gateways both read 99 and both allow request #100.",
      evidence: "Under load test, two gateways issuing 1,000 concurrent checks for a 100-token bucket let ~140 through. The gap between read and write is a race window, and Redis serves other clients inside it.",
      options: [
        {
          name: "Read-modify-write from the gateway (GET then SET)",
          pros: ["Trivial to implement"],
          cons: ["Racy: over-admits under concurrency", "Two round trips, which breaks the latency budget"],
          verdict: "Lost: it's wrong and slow.",
        },
        {
          name: "Optimistic locking (WATCH / MULTI / EXEC) or distributed lock",
          pros: ["Correct"],
          cons: ["Retries under contention", "Locks add round trips and a failure mode of their own"],
          verdict: "Lost: contention on one hot key makes retries pile up, which is exactly when we need to be fastest.",
        },
        {
          name: "Single atomic Lua script (token bucket)",
          pros: ["Redis runs scripts atomically, no race", "One round trip", "Returns tokens + retry-after in one reply", "Uses Redis TIME, so gateway clock skew is irrelevant"],
          cons: ["Logic lives in Redis and is versioned separately", "A slow script blocks the shard (so keep it O(1))"],
          verdict: "Chosen: it turns the whole check into one atomic, constant-time operation.",
          chosen: true,
        },
      ],
      decision:
        "Token bucket stored as {tokens, ts}. One Lua script: read state, add elapsed × refillRate (capped at burst), subtract cost if enough tokens, write back with TTL, return {allowed, remaining, retryAfter}.",
      newRisks: [
        { risk: "Script bugs affect every request on that shard.", mitigation: "Load scripts by SHA, test them against a model implementation, roll out per shard." },
        { risk: "Using Redis TIME makes failover (a replica with a different clock) subtly shift refills.", mitigation: "Drift of milliseconds is far inside our 5% accuracy budget." },
      ],
      sayIt:
        "The check has to be atomic or two gateways will both admit the last token. I'd use a token bucket in a single Lua script, so refill, compare and consume happen as one operation in one round trip, using Redis's own clock.",
      delta: {
        updateNodes: [{ id: "redis", sub: "token bucket · atomic Lua · same AZ" }],
      },
    },
    {
      version: "v5",
      title: "Rules as data: a rules service + local cache",
      problem: "Limits are constants in gateway config. Support needs a higher limit for one customer right now, and it takes a deploy.",
      evidence: "Three tiers × 40 endpoints plus ~2,000 per-customer overrides = ~2,200 rules. A release cycle of a day is unacceptable when a customer is being throttled in the middle of an incident.",
      options: [
        {
          name: "Static config shipped with the gateway",
          pros: ["No runtime dependency"],
          cons: ["Every change is a deploy", "No audit trail, no per-customer overrides"],
          verdict: "Lost: operators need to change limits in seconds, not days.",
        },
        {
          name: "Gateway queries the rules service on every request",
          pros: ["Always fresh"],
          cons: ["A second network call on the hot path at 1M/s", "Rules service outage = platform outage"],
          verdict: "Lost: rules change a few times a day, but this reads them a million times a second.",
        },
        {
          name: "Rules service + in-memory copy in every gateway, refreshed by polling",
          pros: ["The hot path is a hash lookup, no network", "A rules-service outage leaves gateways running on the last known rules", "10 s staleness fits the requirement"],
          cons: ["Gateways can briefly disagree after a change", "A bad rule reaches all gateways quickly"],
          verdict: "Chosen: the data is small, changes rarely and is read constantly, which is a textbook case for a local cache.",
          chosen: true,
        },
      ],
      decision:
        "A small rules service backed by a durable database (versioned, audited). Each gateway polls for changes every few seconds and swaps in an immutable rule table atomically. Requests never call the rules service.",
      newRisks: [
        { risk: "A bad rule (limit = 0) is applied everywhere within seconds.", mitigation: "Validate on write, support staged rollout by percentage of gateways, and keep a one-click rollback to the previous version." },
        { risk: "Gateways run different rule versions for a few seconds.", mitigation: "Accepted. A 10 s window is inside our freshness target, and buckets are keyed by rule so there's no corruption." },
      ],
      sayIt:
        "Limits are data, not code. A rules service holds them durably and each gateway keeps an in-memory copy refreshed every few seconds. The hot path never calls the rules service, and if it goes down we keep enforcing the last known rules.",
      delta: {
        addNodes: [
          { id: "rules", label: "Rules service", sub: "admin API + versions", kind: "service", x: 330, y: 420 },
          { id: "ruledb", label: "Rules store", sub: "Postgres, audited", kind: "db", x: 700, y: 420 },
        ],
        addEdges: [
          { id: "gw-rules", from: "gw", to: "rules", label: "poll rules", async: true },
          { id: "rules-ruledb", from: "rules", to: "ruledb", label: "SQL" },
        ],
      },
    },
    {
      version: "v6",
      title: "Survive the counter store failing: shards, replicas, local fallback",
      problem: "Redis is on every request path. A shard failing, or a network blip, must not turn into a platform outage.",
      evidence: "At 99.99% target we can afford ~4 min of downtime a month. A single Redis failover takes 10–30 s, and with 20 shards, one is always in some kind of trouble. Without a policy, every gateway thread blocks on a dead socket.",
      options: [
        {
          name: "Fail closed: reject everything if the check fails",
          pros: ["Backend is never overloaded"],
          cons: ["A limiter outage becomes a total API outage"],
          verdict: "Lost as the default. Right only for sensitive endpoints (login, OTP) where letting traffic through is worse.",
        },
        {
          name: "Fail open: allow everything if the check fails",
          pros: ["API stays up"],
          cons: ["No protection during the outage, and outages often happen during traffic spikes"],
          verdict: "Lost on its own. A noisy client can take down the backend during the very 30 seconds the limiter is blind.",
        },
        {
          name: "Fail open with a local approximate limiter as fallback",
          pros: ["API stays up", "Each gateway still enforces roughly limit ÷ N, so a runaway client is still contained", "Per-rule failMode lets login still fail closed"],
          cons: ["Less accurate during the outage", "More code and a circuit breaker to maintain"],
          verdict: "Chosen: it uses the weak solution we rejected earlier (local counters) exactly where it is the right tool: degraded mode.",
          chosen: true,
        },
      ],
      decision:
        "Shard Redis by caller key (~20 shards, each with a replica). The gateway wraps the Redis call in a tight timeout (5 ms) and a circuit breaker. When it opens, the gateway uses an in-process token bucket at limit ÷ N and keeps going. Rules marked failMode=closed reject instead.",
      newRisks: [
        { risk: "When Redis comes back empty, every bucket resets to full and callers get a free burst (a thundering herd on the backend).", mitigation: "Ramp: after recovery, start buckets at a fraction of capacity, and rely on replicas so a failover keeps state. See the cold-start flow." },
        { risk: "The breaker flaps (open/close repeatedly).", mitigation: "Half-open probing with a minimum open time, and alert on breaker state." },
      ],
      sayIt:
        "The limiter must not become the outage. I put a 5 ms timeout and a circuit breaker around Redis, and on failure fall back to a local bucket at limit divided by gateways, so we fail open but still bounded. Login endpoints fail closed instead, because there the risk is reversed.",
      delta: {
        addNodes: [{ id: "local", label: "Local fallback", sub: "in-process bucket, limit ÷ N", kind: "infra", x: 60, y: -20 }],
        updateNodes: [{ id: "redis", label: "Counter store", sub: "Redis Cluster · 20 shards + replicas" }],
        addEdges: [{ id: "gw-local", from: "gw", to: "local", label: "if breaker open" }],
      },
    },
    {
      version: "v7",
      title: "Rejection events through a queue: analytics and auto-blocking",
      problem: "A client hits its limit 50,000 times in a minute, and nobody notices. We reject politely forever instead of recognising abuse.",
      evidence: "At 1% rejection we generate ~10K events/s. Repeat offenders account for most of it. A single abusive key costs us a Redis op and a 429 per request for hours.",
      options: [
        {
          name: "Log lines + offline analysis",
          pros: ["No new components"],
          cons: ["Hours of delay", "No automatic reaction"],
          verdict: "Lost: abuse is over (or a customer has churned) by the time the report runs.",
        },
        {
          name: "Gateway calls an abuse service synchronously on every rejection",
          pros: ["Simple to reason about"],
          cons: ["Ties 429 latency to the abuse service's health", "During an attack, rejections peak, so the load on this service peaks with them"],
          verdict: "Lost: it puts a slow, non-critical dependency in front of the cheapest operation we have.",
        },
        {
          name: "Publish events to a queue; a consumer detects abuse and writes a block entry",
          pros: ["Decouples the hot path from analysis", "The queue absorbs attack-time spikes", "Block entries live in Redis, so the gateway needs no new code path to read them"],
          cons: ["Detection lags by seconds", "At-least-once delivery means duplicates", "One more system to run"],
          verdict: "Chosen: nobody is waiting on this, so asynchronous is a feature. We trade seconds of delay for isolation.",
          chosen: true,
        },
      ],
      decision:
        "On each rejection the gateway fire-and-forgets a LimitExceeded event to Kafka (sampled and batched under pressure; dropping is acceptable). A consumer group aggregates per key, and when a key exceeds a threshold it writes a short-lived block entry into Redis. Checks consult it with the same script.",
      newRisks: [
        { risk: "Events are delivered at least once, so a replay could double-count and wrongly block a customer.", mitigation: "Idempotent consumer: dedupe by event id, and block entries are SET with TTL, so applying one twice is harmless." },
        { risk: "A bug in detection blocks legitimate big customers.", mitigation: "Allowlist for key accounts, TTL-limited blocks (never permanent), and an alert on every automatic block." },
        { risk: "The queue is down.", mitigation: "Gateway drops events (bounded in-memory buffer). Losing analytics is acceptable. Losing availability isn't." },
      ],
      sayIt:
        "Rejections feed abuse detection, but nobody is waiting for that, so it goes on a queue and never touches the request path. A consumer aggregates and writes a TTL'd block entry back into the counter store, so the hot path stays one Redis call.",
      delta: {
        addNodes: [
          { id: "queue", label: "Event stream", sub: "Kafka: LimitExceeded", kind: "queue", x: 700, y: -120 },
          { id: "worker", label: "Abuse detector", sub: "consumer group", kind: "worker", x: 1030, y: 60 },
        ],
        addEdges: [
          { id: "gw-queue", from: "gw", to: "queue", label: "publish", async: true },
          { id: "queue-worker", from: "queue", to: "worker", label: "consume", async: true },
          { id: "worker-redis", from: "worker", to: "redis", label: "block key", async: true },
        ],
      },
    },
  ],

  // ───────────────────────────── Stage 5 — Flows ─────────────────────────────
  flows: [
    {
      id: "allowed",
      name: "Request allowed",
      kind: "read",
      summary: "The hot path: one local rule lookup, one Redis round trip, then forward.",
      hops: [
        { from: "client", to: "gw", label: "GET /search (key=K)", narration: "The client calls the API with its key.", why: "The limiter works on identity, so authentication happens first." },
        { from: "gw", label: "match rule: tenant=pro, /search, 600/min", narration: "The gateway looks up the matching rules in its in-memory table.", why: "A hash lookup of ~100 ns instead of a network call. This is what the rules cache buys." },
        { from: "gw", to: "redis", label: "EVAL token_bucket(K)", narration: "One Lua call: refill by elapsed time, take 1 token, return the new state.", why: "A single atomic round trip, so there's no race and the latency budget holds." },
        { from: "redis", to: "gw", label: "allowed, remaining=412", narration: "Redis replies with the decision and what's left.", why: "Returning remaining and retry-after avoids a second call to build the headers." },
        { from: "gw", to: "api", label: "forward request", narration: "The request goes to the backend.", why: "The backend only ever sees traffic that is within quota." },
        { from: "api", to: "gw", label: "200 OK", narration: "The backend answers.", why: "Business logic is unchanged, so services stay unaware of rate limiting." },
        { from: "gw", to: "client", label: "200 + X-RateLimit-Remaining", narration: "The gateway adds rate-limit headers and returns the response.", why: "Clients that read these headers pace themselves and stop hitting the wall." },
      ],
      takeaway: "Net added cost: one in-memory lookup and one same-AZ Redis call, about 1.5 ms. Everything else is the request we'd have served anyway.",
    },
    {
      id: "rejected",
      name: "Request rejected (429)",
      kind: "read",
      summary: "Over the limit: reject before any backend work, tell the client when to come back, and record it.",
      hops: [
        { from: "client", to: "gw", label: "GET /search (key=K)", narration: "The 101st request of the minute arrives.", why: "Same entry point; the gateway can't know it's over quota without asking." },
        { from: "gw", to: "redis", label: "EVAL token_bucket(K)", narration: "The Lua script finds zero tokens.", why: "The check and the decision are the same atomic operation." },
        { from: "redis", to: "gw", label: "denied, retryAfter=12s", narration: "Redis returns 'no', plus the time until the next token.", why: "The retry hint is computed from the refill rate, so it's exact." },
        { from: "gw", to: "queue", label: "LimitExceeded(K, rule)", narration: "The gateway fires an event without waiting for an ack.", why: "Fire-and-forget keeps the 429 cheap. Nobody is waiting on analytics.", async: true },
        { from: "gw", to: "client", label: "429 + Retry-After: 12", narration: "The client is told to back off.", why: "A bare 429 would teach clients to retry instantly. Retry-After gives the polite ones something to wait for." },
      ],
      takeaway: "A rejection costs about the same as an allow, and the backend is never touched. That's the entire value of putting the limiter at the edge.",
    },
    {
      id: "rule-update",
      name: "Operator changes a limit",
      kind: "write",
      summary: "A control-plane write that reaches every gateway within ~10 s, without touching the request path.",
      hops: [
        { from: "rules", label: "PUT /admin/rules/r17 limit=2000", narration: "An operator raises a customer's limit. The rules service validates it (non-zero, burst ≤ limit).", why: "Validate on write: a bad rule is the most dangerous change in this system." },
        { from: "rules", to: "ruledb", label: "INSERT version=43", narration: "A new immutable version is written, with author and timestamp.", why: "Versioned rows give an audit trail and a one-step rollback." },
        { from: "gw", to: "rules", label: "poll: since version=42", narration: "Each gateway polls every few seconds with its current version.", why: "Polling is simple, tolerates missed notifications and keeps the rules service off the hot path.", async: true },
        { from: "rules", to: "gw", label: "ruleset v43 (delta)", narration: "The rules service returns only what changed.", why: "A tiny payload, so polling 20 gateways is trivial load." },
        { from: "gw", label: "swap rule table atomically", narration: "The gateway builds a new immutable table and swaps one pointer.", why: "In-flight requests finish on the old table. There are no locks and no half-updated state." },
      ],
      takeaway: "Rule changes ride a completely separate, slow path. The request path only ever reads memory, so the control plane can be slow or even down without hurting traffic.",
    },
    {
      id: "redis-down",
      name: "Failure: a Redis shard dies",
      kind: "failure",
      summary: "Node death. The breaker trips and the gateway degrades to a local bucket instead of failing every request.",
      hops: [
        { from: "gw", to: "redis", label: "EVAL token_bucket(K)", narration: "The shard that owns K has crashed. The call hangs.", why: "Without a short timeout, gateway threads pile up on the dead socket and the gateway itself goes down.", failure: true },
        { from: "gw", label: "timeout after 5 ms → breaker opens", narration: "After a few consecutive timeouts the circuit breaker opens for this shard.", why: "Stops paying 5 ms on every request, and stops hammering a shard that's trying to recover.", failure: true },
        { from: "gw", to: "local", label: "consult local bucket (limit ÷ 20)", narration: "The gateway checks its own in-process bucket, set to 1/20th of the limit.", why: "A bounded fallback. A runaway client is still contained, at roughly the right total across the fleet." },
        { from: "gw", to: "api", label: "forward if under local limit", narration: "Under-limit requests continue. Rules marked failMode=closed (login) are rejected instead.", why: "Fail open for availability, with a safety net. Fail closed where abuse is worse than downtime." },
      ],
      takeaway: "We lose accuracy, not availability. The limiter degrades from 'exact' to 'approximately right' for ~30 s while the replica is promoted.",
    },
    {
      id: "cold-start",
      name: "Failure: Redis returns empty (thundering herd)",
      kind: "failure",
      summary: "Stampede. A restart without persistence wipes the keyspace, and every bucket starts full.",
      hops: [
        { from: "gw", to: "redis", label: "EVAL token_bucket(K) on empty shard", narration: "A shard restarted with no data. K has no bucket.", why: "A missing key is indistinguishable from a brand-new caller." },
        { from: "redis", to: "gw", label: "allowed, tokens=burst (fresh bucket)", narration: "A fresh bucket starts full, so every caller on this shard gets a whole new burst at once.", why: "Thousands of callers each draw a full burst in the same second.", failure: true },
        { from: "gw", to: "api", label: "surge of forwarded requests", narration: "Backends see traffic well above the normal rate for a few seconds.", why: "This is the cost of resetting 'memory' of who's been spending their quota.", failure: true },
        { from: "gw", label: "mitigate: start new buckets at 20% of burst after recovery", narration: "For a short window after a shard returns, newly created buckets start partially filled.", why: "Trade a little unfairness for a flat backend load. A replica that keeps state avoids the problem in most failovers." },
      ],
      takeaway: "Losing counter state is a security event, not just a cache miss: it silently resets everyone's quota. Replicas for continuity, partial-fill starts for the cold case.",
    },
    {
      id: "abuse-loop",
      name: "Abuse detected and blocked",
      kind: "write",
      summary: "The asynchronous feedback loop: rejections become a block entry that the hot path reads for free.",
      hops: [
        { from: "gw", to: "queue", label: "LimitExceeded ×10K/s", narration: "Gateways publish rejections (batched, keyed by caller so one key lands on one partition).", why: "Keying by caller lets the consumer count per key without cross-partition coordination.", async: true },
        { from: "queue", to: "worker", label: "consume batch", narration: "The detector reads events in order, per partition.", why: "Decoupled: if the detector is slow the queue buffers, and the gateway never notices.", async: true },
        { from: "worker", label: "key K: 5,000 rejections in 60 s > threshold", narration: "A sliding count crosses a threshold.", why: "Thresholds are deliberately much higher than the limit, so legitimate bursts never trigger a ban." },
        { from: "worker", to: "redis", label: "SET block:K  TTL=1h", narration: "A block entry is written with a TTL.", why: "TTL means a false positive heals itself, and re-applying is harmless (idempotent).", async: true },
        { from: "gw", to: "redis", label: "EVAL token_bucket(K) → blocked", narration: "The next check hits the block entry in the same script.", why: "The hot path didn't change. It just reads one more key in the same round trip." },
      ],
      takeaway: "Detection is slow and smart; enforcement is fast and dumb. Splitting them lets each use the right communication style: a queue for the first, a direct call for the second.",
    },
    {
      id: "duplicate-event",
      name: "Failure: duplicate event delivery",
      kind: "failure",
      summary: "Duplicate processing. The consumer crashes mid-batch and the broker redelivers.",
      hops: [
        { from: "queue", to: "worker", label: "batch #812 (events 1–500)", narration: "The consumer processes the batch and updates its counts.", why: "At-least-once delivery is the default guarantee of every mainstream broker.", async: true },
        { from: "worker", label: "crash before committing offset", narration: "The offset isn't committed, so the broker still thinks batch #812 is pending.", why: "Committing after processing is what makes the system lose nothing, at the price of duplicates.", failure: true },
        { from: "queue", to: "worker", label: "redeliver batch #812", narration: "The restarted consumer receives the same events again.", why: "Same events, second time.", async: true, failure: true },
        { from: "worker", label: "dedupe by event id; counts are idempotent", narration: "Events carry a unique id. The consumer ignores ids it has already applied.", why: "Without it a replay could double a count and wrongly ban a legitimate customer." },
        { from: "worker", to: "redis", label: "SET block:K TTL=1h (idempotent)", narration: "Writing the same block entry twice has the same effect as once.", why: "Design the write so a duplicate is harmless, rather than trying to prevent duplicates.", async: true },
      ],
      takeaway: "Don't chase exactly-once delivery. Take at-least-once and make the effect idempotent: event ids for counting, SET-with-TTL for blocking.",
    },
  ],

  // ───────────────────────────── Stage 6 — Deep dives ─────────────────────────────
  deepDives: [
    {
      id: "algorithm",
      title: "Which algorithm?",
      question: "Fixed window, sliding window, token bucket or leaky bucket?",
      context: [
        "All five can be implemented in Redis. They differ in memory per caller, accuracy at window edges and burst behaviour.",
        "Our requirements: allow short bursts, enforce the average, constant memory per caller, one atomic operation.",
      ],
      options: [
        {
          name: "Fixed window counter (INCR + EXPIRE per minute)",
          pros: ["Simplest, 1 key, 1 INCR", "Very cheap"],
          cons: ["Boundary burst: 100 requests at 12:00:59 and 100 more at 12:01:00 means 200 in 2 seconds", "Needs care to set the EXPIRE atomically"],
          verdict: "Lost: the 2× boundary burst is exactly what a limiter is meant to prevent.",
        },
        {
          name: "Sliding window log (sorted set of timestamps)",
          pros: ["Exact"],
          cons: ["Memory is O(limit) per caller, so 10,000/min means 10,000 entries", "Each check trims and counts a sorted set"],
          verdict: "Lost: 100M callers × thousands of entries doesn't fit, and it's slow per check.",
        },
        {
          name: "Sliding window counter (weighted blend of 2 windows)",
          pros: ["2 numbers per caller", "Smooths the boundary problem", "Within a few % of exact"],
          cons: ["Approximate, assumes even traffic inside a window", "No explicit burst control"],
          verdict: "Strong runner-up: use it where bursts shouldn't be allowed and you want a clean 'requests per minute'.",
        },
        {
          name: "Token bucket",
          pros: ["2 numbers per caller (tokens, ts)", "Burst and average are separate knobs", "Natural Retry-After", "What Stripe, AWS and most gateways use"],
          cons: ["Two parameters to explain to customers", "Needs the atomic script to be safe"],
          verdict: "Chosen: matches the requirement 'burst of 20, average 100/min' exactly, in constant space.",
          chosen: true,
        },
        {
          name: "Leaky bucket (a queue drained at a fixed rate)",
          pros: ["Output is perfectly smooth, which protects a fragile downstream"],
          cons: ["Requests wait in the queue, adding latency", "Burst is delayed rather than allowed"],
          verdict: "Right for protecting a downstream you CALL (the queue lives on your side). Wrong for rejecting inbound API traffic.",
        },
      ],
      recommendation:
        "Token bucket for API limits. Sliding-window counter for strict per-minute quotas such as OTP attempts. Leaky bucket (as a queue) when we are the ones calling a limited third party.",
      sayIt:
        "Fixed windows allow a 2× burst at the boundary and sliding logs are too heavy, so I'd use a token bucket: two numbers per caller, burst and rate as independent knobs, and a natural retry-after. It needs an atomic script, which we have.",
    },
    {
      id: "accuracy-vs-latency",
      title: "How exact does the count need to be?",
      question: "Synchronous central counter on every request, or local counting with periodic sync?",
      context: [
        "The central synchronous approach is exact but adds a Redis hop and makes Redis a hard dependency.",
        "At a million checks per second, some teams ask whether every request really needs to pay for it.",
        "The answer depends on how bad overshoot is: for billing, very; for fairness, not much.",
      ],
      options: [
        {
          name: "Central synchronous check on every request",
          pros: ["Accurate to within the script's atomicity", "Simple mental model"],
          cons: ["+1–2 ms and a hard dependency on every request", "Redis needs ~20 shards"],
          verdict: "Chosen as the default: the latency is inside budget and accuracy is simple to reason about.",
          chosen: true,
        },
        {
          name: "Local counting, sync to Redis every ~100 ms (batched)",
          pros: ["No network on the hot path", "Redis load drops by orders of magnitude", "Survives short Redis outages naturally"],
          cons: ["A caller can overshoot by (gateways × requests per sync interval)", "Harder to explain and to test"],
          verdict: "The upgrade path when Redis cost or latency bites. For a 100 req/s caller, the 100 ms window means ≈10 requests of slack per gateway.",
        },
        {
          name: "Hybrid: local fast path for 'clearly fine', central for 'near the limit'",
          pros: ["Most callers (far below their limit) never touch Redis", "Accurate where it matters"],
          cons: ["Two code paths", "Needs a per-key view of how close we are to the limit"],
          verdict: "Best of both at scale: cheap callers skip the hop; callers above, say, 70% of their budget go central.",
        },
      ],
      recommendation:
        "Start with central + synchronous. If Redis ops or latency become the bottleneck, move to the hybrid. Never go fully local for limits tied to money or security.",
      sayIt:
        "I'd start with exact, synchronous counting, since 1.5 ms is in budget and it's easy to reason about. If Redis becomes the bottleneck, I'd let callers far below their limit skip Redis and keep the central check only for those approaching it.",
    },
    {
      id: "fail-mode",
      title: "Fail open or fail closed?",
      question: "The counter store is unreachable. Do we allow or reject?",
      context: [
        "This is a business decision hiding in an infrastructure question. The two failures have different costs.",
        "Failing open risks overload and abuse; failing closed guarantees an outage for legitimate users.",
      ],
      options: [
        {
          name: "Fail closed everywhere",
          pros: ["The backend is always protected", "No abuse window"],
          cons: ["A limiter incident takes the entire API down"],
          verdict: "Lost: the limiter exists to protect availability. It must not become the main threat to it.",
        },
        {
          name: "Fail open everywhere",
          pros: ["The API stays up"],
          cons: ["Zero protection when Redis is down, and attackers love that window"],
          verdict: "Lost: acceptable for a week-old startup, not for a platform.",
        },
        {
          name: "Per-rule policy: fail open + local fallback by default, fail closed for sensitive rules",
          pros: ["Matches the real cost of each endpoint", "Local fallback keeps even failing-open traffic bounded"],
          cons: ["Needs a policy decision for every rule, and someone to own it"],
          verdict: "Chosen: the choice belongs to the rule, not the infrastructure.",
          chosen: true,
        },
      ],
      recommendation:
        "failMode lives on the rule. Default: open with local fallback. Login, OTP, password reset and payment-initiation endpoints: closed.",
      sayIt:
        "Open or closed is a per-endpoint business decision. Most of the API fails open with a local limit, so the limiter can't cause an outage. Login and OTP fail closed, because a brute-force window is worse than a short outage there.",
    },
  ],

  // ───────────────────────────── Stage 7 — Defend ─────────────────────────────
  tradeOffs: [
    {
      decision: "Limiter in a gateway",
      alternative: "Library in each service",
      why: "One policy and implementation, and rejection happens before any backend work.",
      whenToSwitch: "When the rule needs business context a gateway can't see, such as 'max 3 refunds per order'. Those stay in the service.",
    },
    {
      decision: "Central Redis counters",
      alternative: "Sticky routing / local counters",
      why: "Shared state fixes the N× overshoot without coupling the LB to rate limiting.",
      whenToSwitch: "When Redis cost or latency dominates: move to hybrid or batched local counting.",
    },
    {
      decision: "Token bucket",
      alternative: "Sliding window counter",
      why: "Allows controlled bursts, uses constant space and gives an exact retry-after.",
      whenToSwitch: "When the contract is a strict 'N per minute' with no bursts (e.g. OTP attempts).",
    },
    {
      decision: "Atomic Lua script",
      alternative: "WATCH/MULTI or a distributed lock",
      why: "One round trip with no retries or lock failure modes under contention.",
      whenToSwitch: "When you need a multi-key atomic decision across shards (it then becomes a different problem).",
    },
    {
      decision: "Fail open + local fallback",
      alternative: "Fail closed",
      why: "The limiter must not cause an outage, and the fallback still bounds runaway clients.",
      whenToSwitch: "For security-critical endpoints, where an abuse window costs more than downtime.",
    },
    {
      decision: "Rules cached in gateways, polled",
      alternative: "Query rules per request, or push-only",
      why: "Keeps the rules service off the hot path and tolerates its downtime.",
      whenToSwitch: "When a change must apply in under a second: add push (pub/sub) on top of polling.",
    },
    {
      decision: "Events through Kafka",
      alternative: "Synchronous call to the abuse service",
      why: "Nobody waits on analytics, and the queue absorbs attack-time spikes.",
      whenToSwitch: "Never for the allow/deny decision itself. That stays synchronous.",
    },
  ],

  bottlenecks: [
    { item: "Redis shard for a very hot key", mitigation: "A caller is bounded by its own limit, but a platform-wide rule (a global 'all tenants' counter) isn't. Split global limits into per-gateway slices, or use local approximate counting for them." },
    { item: "Redis is on every request", mitigation: "Same-AZ placement, replicas, circuit breaker, local fallback; hybrid counting if hop cost grows." },
    { item: "A bad rule pushed to all gateways", mitigation: "Validation on write, staged rollout, versioned one-click rollback." },
    { item: "Clock skew between gateways", mitigation: "All refill math uses Redis TIME inside the script, so gateway clocks never matter." },
    { item: "Retry storms after a 429 wave", mitigation: "Retry-After on every 429, jittered backoff in our SDKs, and per-key rejection events so abusive retry loops get blocked." },
    { item: "Multi-region deployment", mitigation: "Counters per region with a per-region budget (limit × traffic share). Cross-region synchronous counting would add 100+ ms, which breaks the latency goal." },
  ],

  followUps: [
    {
      question: "How would this work across multiple regions?",
      answer: [
        "Synchronous global counters are out: cross-region RTT is 80–150 ms, far above the 3 ms budget.",
        "Give each region a budget, such as limit × that region's share of the caller's traffic, and enforce locally with the same design.",
        "Rebalance budgets periodically (every few seconds to minutes) from observed traffic. A caller can overshoot by one rebalance interval, and that's the accepted trade-off.",
        "For hard global limits (billing), count asynchronously and reconcile, as a quota system rather than a rate limiter.",
      ],
    },
    {
      question: "What if one customer legitimately needs 100× the normal rate?",
      answer: [
        "That's a per-customer rule override, so no code change. The rules model already supports it.",
        "If they hit a single shard hard, give them a dedicated rule key with sub-buckets (K#0..K#7) and check one at random. This trades a little accuracy for spreading load.",
      ],
    },
    {
      question: "How do you test a rate limiter?",
      answer: [
        "Unit-test the Lua script against a simple model implementation, using a fake clock and property tests (never allow more than burst + rate × t).",
        "Concurrency test with many parallel clients against one key, and assert total admitted is within tolerance.",
        "Chaos: kill a shard under load and assert the API error rate stays flat and the fallback engages.",
        "Shadow mode in production: evaluate new rules and log decisions without enforcing, before you turn them on.",
      ],
    },
    {
      question: "Should the limiter also use request cost, not just count?",
      answer: [
        "Yes: pass cost into the script (a search costs 5 tokens, a read costs 1). Same bucket, same algorithm.",
        "It's the fair model for expensive endpoints and for LLM-style APIs, where a token count matters more than a request count.",
      ],
    },
    {
      question: "Why not just use a queue in front of the API so nothing ever gets rejected?",
      answer: [
        "A queue makes callers wait. For interactive API traffic they time out and retry, adding load to the queue.",
        "A queue only delays the overload: if input exceeds capacity, it grows without bound until memory runs out.",
        "Queueing is right when callers can wait (batch jobs, outbound calls to a limited third party). Rejecting with Retry-After is right when they can't.",
      ],
    },
  ],

  mistakes: [
    "Counting per server and not noticing the limit is multiplied by the fleet size.",
    "A GET-then-SET race: two requests read 99 and both pass.",
    "Putting the allow/deny decision on a message queue. A queue can't answer a caller that is waiting.",
    "Never asking what happens when the limiter itself fails.",
    "Fixed windows without mentioning the 2× boundary burst.",
    "Using client clocks or gateway clocks for refill timing.",
    "Returning a bare 429 with no Retry-After, and so inviting a retry storm.",
  ],

  redFlags: [
    "'We'll just use a database table.' At 1M checks/s with a 3 ms budget, that's a non-starter.",
    "No answer for what happens when Redis is down.",
    "Exactly-once delivery promised for the event queue.",
    "A single global counter for all callers, with no thought for hot keys.",
    "Rate limiting only on the client side.",
  ],
};
