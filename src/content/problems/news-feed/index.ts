import type { Problem } from "../../types";

/**
 * News Feed (Twitter / Facebook / Instagram home timeline)
 *
 * Narrative spine: reads outnumber writes ~50:1, so we do the work at write time... until one author has 80M followers.
 *  - pulling 300 followees' posts on every read is a scatter-gather nightmare -> precompute timelines (fan-out on write)
 *  - timelines hold post IDs, not posts                                       -> hydrate from a post cache; deletes and edits stay cheap
 *  - celebrities make fan-out explode                                          -> hybrid: push for normal authors, pull for celebrities
 *  - most registered users never come back                                     -> only fan out to active users; rebuild on return
 *  - "latest first" isn't what keeps people reading                            -> two-stage ranking on top of the candidate set
 *  - likes outnumber posts 10:1 and concentrate on viral posts                 -> counters off the hot path
 * Posting is synchronous up to "stored"; fan-out, counting and indexing are queues, because the author isn't waiting for them.
 */
export const newsFeed: Problem = {
  slug: "news-feed",
  title: "News Feed",
  tagline: "Fan-out on write vs read, the celebrity problem, hydration and ranking",
  difficulty: "Hard",

  overview: {
    whatItIs:
      "A news feed is the scrolling list of posts you see when you open a social app: recent posts from the people and pages you follow, usually ranked so the most interesting come first. Behind it is a system that decides, for hundreds of millions of people, which few hundred posts out of billions each one should see, and serves that list in a fraction of a second.",
    whatItDoes: [
      "Collects new posts from everyone a user follows.",
      "Orders them (newest first, or ranked by predicted interest).",
      "Serves a page of the feed in well under a second, with infinite scroll.",
      "Reflects new posts, deletes, unfollows and likes within seconds.",
    ],
    whereUsed: [
      "Twitter/X home timeline, Facebook News Feed, Instagram, LinkedIn",
      "Activity feeds: GitHub dashboard, Strava, Slack 'activity'",
      "Content apps with a 'following' tab: YouTube subscriptions, Reddit home",
    ],
    coreIdea:
      "A feed is a merge of many authors' recent posts. You can do that merge when someone reads (pull) or when someone posts (push). Push makes reads cheap but makes celebrity posts explode; pull is the reverse. Every real design is a hybrid, and choosing the cut-off is the interview.",
    notToBeConfusedWith: [
      { term: "Search", difference: "Search finds posts matching a query from anyone. A feed is defined by your social graph." },
      { term: "Recommendations ('For You')", difference: "Recommendation feeds draw candidates from everyone using ML retrieval. A following feed draws candidates from the people you follow; ranking is a layer on top of either." },
      { term: "Notifications", difference: "Notifications are about you (someone liked, mentioned or followed you). The feed is about what the people you follow posted." },
    ],
  },

  // ───────────────────────────── Stage 1 — Understand ─────────────────────────────
  interviewQuestion:
    "Design the home news feed for a social network like Twitter or Facebook. Users follow others, publish posts, and see a feed of posts from the people they follow. Scale to hundreds of millions of daily users.",

  clarifyingQuestions: [
    {
      question: "Is the follow graph one-way (Twitter) or mutual (Facebook friends)? Is there a cap?",
      whyItMatters: "One-way follows allow accounts with 100M followers, which is what makes fan-out hard. Mutual friendships are usually capped (~5,000).",
      answer: "One-way follows, no cap on followers. Users can follow up to 5,000 accounts.",
      designImpact: "Follower counts are extremely skewed, so we must design for the celebrity case explicitly.",
    },
    {
      question: "Chronological or ranked?",
      whyItMatters: "Ranking adds a candidate-generation + scoring stage, and changes what 'the feed' even means for caching.",
      answer: "Ranked, with a chronological option. Start with chronological and add ranking.",
      designImpact: "Build a candidate set (recent posts from followees), then rank. The candidate machinery is the same for both modes.",
    },
    {
      question: "How many users, posts and feed loads?",
      whyItMatters: "It sets the read/write ratio, which decides where the work should happen.",
      answer: "500M DAU. ~100M new posts per day. Each user loads the feed ~10 times a day.",
      designImpact: "≈ 58K feed reads/s vs ≈ 1.2K posts/s: a ~50:1 read/write ratio. Precomputing at write time looks attractive.",
    },
    {
      question: "How fresh must the feed be?",
      whyItMatters: "Seconds vs minutes changes whether fan-out can be lazy.",
      answer: "A new post should appear in followers' feeds within ~5 seconds. Celebrity posts can be a little slower.",
      designImpact: "Fan-out is asynchronous but must keep up; the queue's lag is a key SLO.",
    },
    {
      question: "What's in a post? Media?",
      whyItMatters: "Media is served by a CDN and doesn't change the feed design, but post size affects caching.",
      answer: "Text up to 500 chars, optional images/videos by reference.",
      designImpact: "Post objects are ~1 KB; media URLs point to a CDN. Feed caches hold post IDs only.",
    },
    {
      question: "How quickly must deletes, unfollows and blocks take effect?",
      whyItMatters: "If feeds are precomputed copies, removing things is the hard part.",
      answer: "Deleted posts must disappear immediately. Unfollows within a minute is fine.",
      designImpact: "Filter at read time (hydration), not by scrubbing every precomputed timeline.",
    },
  ],

  requirements: {
    functional: [
      "Publish a post (text + media references).",
      "Follow / unfollow accounts.",
      "Home feed: posts from followed accounts, ranked or chronological, paginated (infinite scroll).",
      "Like a post; show like counts.",
      "Deleted posts and blocked users never appear.",
    ],
    nonFunctional: [
      { name: "Feed latency", target: "p99 < 300 ms for a page of 50", why: "The feed is the app's front door." },
      { name: "Freshness", target: "New posts visible to followers within ~5 s (celebrities ~seconds-to-a-minute)", why: "Stale feeds feel broken, especially during live events." },
      { name: "Throughput", target: "~175K feed reads/s and ~5K posts/s at peak", why: "500M DAU × 10 loads, peaky during events." },
      { name: "Availability", target: "99.99% for reads; posting can degrade", why: "A slightly stale feed is better than no feed." },
      { name: "Consistency", target: "Eventual for fan-out; immediate for deletes and your own posts", why: "Users notice their own post missing, or a deleted one still showing." },
    ],
    outOfScope: [
      "Recommendation of accounts you don't follow ('For You')",
      "Ads insertion",
      "Comments and replies threading",
      "Search and hashtags",
    ],
  },

  // ───────────────────────────── Stage 2 — Size ─────────────────────────────
  estimates: [
    {
      title: "Read vs write traffic",
      reasoning: [
        "Feed reads: 500M DAU × 10 = 5B/day ÷ 86,400 ≈ 58K/s; peak ~3× ≈ 175K/s",
        "Posts: 100M/day ÷ 86,400 ≈ 1.2K/s; peak during live events ~5K/s",
        "Read : write ≈ 50 : 1",
      ],
      result: "≈ 175K reads/s and ~5K writes/s at peak",
      soWhat:
        "Reads dominate, so move work from read time to write time: precompute each user's timeline so a read is a single lookup, not a merge across hundreds of authors.",
    },
    {
      title: "Pull cost (merge at read time)",
      reasoning: [
        "Average user follows ~300 accounts",
        "A pull feed = fetch recent posts for 300 authors, merge, sort, take 50",
        "Posts are sharded by post/author, so that's a scatter-gather to dozens of shards per read",
        "175K reads/s × ~300 author lookups ≈ 50M index lookups/s",
      ],
      result: "≈ 50M lookups/s for pure pull",
      soWhat:
        "Pure pull puts a huge, tail-latency-sensitive scatter-gather on every read. The slowest of dozens of shards decides p99.",
    },
    {
      title: "Push cost (fan-out on write)",
      reasoning: [
        "Average followers ≈ 200 (median far lower, mean dragged up by large accounts)",
        "100M posts/day × 200 = 20B timeline inserts/day ≈ 230K/s",
        "But one account with 80M followers posting = 80M inserts; at 1M inserts/s fleet-wide that's 80 s for one post",
        "Top accounts post several times a day, and during live events many large accounts post at once",
      ],
      result: "≈ 230K inserts/s normally; a single celebrity post = tens of millions",
      soWhat:
        "Push is cheap for the median author and catastrophic for the tail. The design must treat large accounts differently (hybrid push/pull).",
    },
    {
      title: "Timeline cache size",
      reasoning: [
        "Keep the newest 800 post IDs per user (Twitter's historical number)",
        "Sorted set entry ≈ 8 B ID + 8 B score + ~30 B overhead ≈ 50 B → 800 × 50 B = 40 KB per user",
        "40 KB × 500M active users ≈ 20 TB; × 2 replicas ≈ 40 TB of RAM",
      ],
      result: "≈ 20 TB (40 TB replicated) for active users only",
      soWhat:
        "Feasible in a Redis cluster of a few hundred nodes, but only for active users and only IDs. Storing full posts, or timelines for 2B registered users, would multiply it beyond reason.",
    },
    {
      title: "Hydration",
      reasoning: [
        "A page = 50 post IDs → 50 post objects (~1 KB each) + author profiles + counts",
        "175K pages/s × 50 ≈ 8.75M post lookups/s at peak",
        "Most lookups are for a small set of recent, popular posts",
      ],
      result: "≈ 9M post reads/s",
      soWhat:
        "A post cache with batched multi-get and a very high hit ratio is mandatory. The post store itself should see only misses.",
    },
    {
      title: "Likes",
      reasoning: [
        "~10 likes per post on average → 1B likes/day ≈ 12K/s, peak ~50K/s",
        "A viral post can take 100K+ likes per minute on one counter",
      ],
      result: "≈ 12–50K like writes/s, concentrated on a few hot posts",
      soWhat:
        "Counters on hot posts are hot keys. Likes go through a stream and are aggregated before touching storage.",
    },
  ],

  // ───────────────────────────── Stage 3 — Start simple ─────────────────────────────
  api: [
    {
      method: "POST",
      path: "/v1/posts",
      request: '{ "text": "…", "mediaIds": ["m_1"], "idempotencyKey": "…" }',
      response: '201 { "postId": "1830049912843300864", "createdAt": "…" }',
      notes: "Synchronous until the post is stored. Fan-out happens afterwards; the response doesn't wait for it. postId is a time-sortable Snowflake ID.",
    },
    {
      method: "GET",
      path: "/v1/feed?cursor=…&limit=50&mode=ranked|latest",
      response: '{ "posts": [{ "id", "author", "text", "media", "likes", "liked" }…], "nextCursor": "…" }',
      notes: "Cursor-based pagination (opaque: last post ID + ranking snapshot), never offset-based, so new posts at the top don't shift pages.",
    },
    {
      method: "POST / DELETE",
      path: "/v1/follows/{userId}",
      response: "204",
      notes: "Updates the social graph. Backfill of the new followee's recent posts into the timeline is asynchronous.",
    },
    {
      method: "POST / DELETE",
      path: "/v1/posts/{postId}/like",
      response: "204",
      notes: "Fire-and-forget into the engagement stream. The client shows the like optimistically.",
    },
    {
      method: "internal",
      path: "PostCreated { postId, authorId, createdAt }",
      response: "(message, no reply)",
      notes: "Drives fan-out. Carries the ID only; consumers never need the body.",
    },
  ],

  communication: {
    rule:
      "The author waits for 'stored', so creating a post is synchronous up to the write. Delivering it to followers' timelines is work nobody waits for, at a different speed, with a huge multiplier, so it's a queue. Reading the feed is synchronous throughout (the user is staring at a spinner), with deadlines on every fan-in call.",
    choices: [
      {
        interaction: "Client → Feed API: publish a post",
        style: "sync-api",
        why: "The author needs to know the post was accepted and get its ID. The call ends when the post is durably stored.",
        ifWrong: "Waiting for fan-out to complete would make posting take seconds to minutes for popular authors.",
      },
      {
        interaction: "Post stored → fan-out to followers' timelines",
        style: "async-queue",
        why: "Nobody waits, the work multiplies by follower count, and bursts (live events) must be absorbed. Workers consume and write timelines idempotently.",
        ifWrong: "Synchronous fan-out ties the author's request to up to millions of writes, and a slow timeline shard fails the post.",
      },
      {
        interaction: "Feed read → timeline, celebrity posts, ranker, post cache",
        style: "sync-api",
        why: "The user is waiting. Calls run in parallel with tight deadlines; if the ranker is slow, fall back to chronological; if the celebrity merge is slow, serve without it.",
        ifWrong: "There's no queue on a read path. The risk is serial calls and no fallbacks, so the slowest dependency sets p99.",
      },
      {
        interaction: "Likes → counters",
        style: "async-queue",
        why: "The client shows the like immediately; the count can lag by seconds. Events are aggregated per post before storage.",
        ifWrong: "Synchronous increments make a viral post a hot row taking 100K writes/min.",
      },
      {
        interaction: "Follow → backfill new followee's posts into my timeline",
        style: "async-queue",
        why: "A follow should return instantly; inserting the followee's last N posts into the follower's timeline can happen in the background.",
        ifWrong: "Doing it inline makes follow slow and couples it to timeline-cache health.",
      },
    ],
  },

  dataModel: [
    {
      entity: "post (post store)",
      fields: [
        { name: "post_id", type: "BIGINT", note: "Snowflake: time-sortable, globally unique; partition key" },
        { name: "author_id", type: "BIGINT", note: "secondary index (author_id, post_id DESC) for 'recent posts by author'" },
        { name: "text / media_refs", type: "STRING / JSON" },
        { name: "visibility / deleted", type: "ENUM / BOOL", note: "soft delete; checked on every hydration" },
        { name: "created_at", type: "TIMESTAMP" },
      ],
      accessPatterns: [
        "Insert (~5K/s peak)",
        "Multi-get by post_id (hydration, ~9M/s, almost all from cache)",
        "Recent posts by author (celebrity merge, cold-start rebuild)",
      ],
      insight:
        "Time-sortable IDs mean a timeline can be ordered by the ID alone, and 'newer than cursor' is a simple comparison. No separate timestamp index is needed.",
    },
    {
      entity: "timeline (Redis sorted set per user)",
      fields: [
        { name: "key", type: "timeline:{user_id}" },
        { name: "members", type: "post_id", note: "score = post_id (time-sortable)" },
        { name: "size", type: "≤ 800", note: "trimmed on insert" },
      ],
      accessPatterns: [
        "ZADD on fan-out (idempotent: same post twice is one entry)",
        "ZREVRANGEBYSCORE with cursor for pagination",
        "ZREM on unfollow cleanup (lazy) or post delete (optional; filtered at read anyway)",
      ],
      insight:
        "IDs only. A post is stored once and referenced by ~200 timelines on average, so edits, deletes and like counts never require touching timelines.",
    },
    {
      entity: "follow edge (social graph store)",
      fields: [
        { name: "follower_id → followee_id", type: "edge", note: "stored twice: by follower (who do I follow) and by followee (who follows me)" },
        { name: "created_at", type: "TIMESTAMP" },
        { name: "followee_follower_count", type: "BIGINT", note: "denormalised; drives the celebrity threshold" },
      ],
      accessPatterns: [
        "Followers of X, paged (fan-out): up to 80M rows",
        "Followees of Y, filtered to celebrities (read-time merge)",
      ],
      insight:
        "Both directions are first-class access patterns, so the edge is stored twice, partitioned by the source user in each direction.",
    },
  ],

  v1: {
    title: "v1: pull at read time from one database",
    description: [
      "One app server and one SQL database with users, follows and posts tables.",
      "The feed query: SELECT * FROM posts WHERE author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?) ORDER BY created_at DESC LIMIT 50.",
      "Posting is a single INSERT. It's correct, simple, and perfectly fine for a few thousand users.",
    ],
    diagram: {
      nodes: [
        { id: "client", label: "Users", sub: "app · web", kind: "client", x: 0, y: 220 },
        { id: "api", label: "App server", sub: "post + feed", kind: "service", x: 330, y: 220 },
        { id: "postdb", label: "SQL database", sub: "users · follows · posts", kind: "db", x: 660, y: 0 },
      ],
      edges: [
        { id: "client-api", from: "client", to: "api", label: "post / feed" },
        { id: "api-postdb", from: "api", to: "postdb", label: "insert · IN (followees) ORDER BY" },
      ],
    },
    whatBreaksFirst: [
      "The feed query is an IN-list of ~300 authors with a sort: it gets slower as the posts table grows, and it runs 58K times a second.",
      "Sharding posts by author turns each feed read into a scatter-gather across many shards; p99 follows the slowest shard.",
      "One database handles both the tiny write load and the enormous read load, so reads starve writes.",
    ],
  },

  // ───────────────────────────── Stage 4 — Evolve ─────────────────────────────
  evolution: [
    {
      version: "v2",
      title: "Fan-out on write into precomputed timelines",
      problem: "Every feed read merges ~300 authors' posts. At 175K reads/s that's ~50M index lookups/s, and the slowest shard sets p99.",
      evidence: "Load test with posts sharded by author across 64 shards: feed p50 180 ms, p99 2.1 s, with each read touching ~40 shards. Adding shards made p99 worse, since more shards per read means a slower worst one.",
      options: [
        {
          name: "Cache each user's computed feed for N minutes",
          pros: ["Easy to add"],
          cons: ["Stale for N minutes", "Every cache miss is still the full scatter-gather", "Low hit ratio: users load the feed a few times a day"],
          verdict: "Lost: the expensive path still runs constantly.",
        },
        {
          name: "Pull, but with a per-author 'recent posts' cache",
          pros: ["Each author lookup is a cache hit"],
          cons: ["Still ~300 lookups per read", "Still a merge at read time"],
          verdict: "Lost as the primary design, but useful later for celebrities.",
        },
        {
          name: "Fan-out on write: when someone posts, push the post ID into each follower's timeline (sorted set); a read is one range query",
          pros: ["A read is a single lookup in one shard", "Work moves to the 50× less frequent operation", "Timeline order is ready-made"],
          cons: ["Write amplification × follower count", "Fan-out lag between posting and appearing", "Celebrities (80M followers) explode it"],
          verdict: "Chosen: it matches the 50:1 read/write ratio. The celebrity problem comes next.",
          chosen: true,
        },
      ],
      decision:
        "Posts are stored, then PostCreated{postId, authorId} goes to a fan-out queue. Fan-out workers page through the author's followers from a dedicated social-graph store and ZADD the post ID into each follower's timeline sorted set in Redis (pipelined, trimmed to 800). Reading the feed is ZREVRANGE on one key, then fetching those posts.",
      newRisks: [
        { risk: "A post from an account with tens of millions of followers takes minutes to fan out and clogs the queue for everyone.", mitigation: "Hybrid push/pull (v4)." },
        { risk: "Worker crashes mid-fan-out redeliver the event.", mitigation: "ZADD with post_id as member is idempotent; a re-run is harmless." },
        { risk: "Each read now fetches 50 posts by ID from the post store.", mitigation: "A post cache (v3)." },
      ],
      sayIt:
        "Reads outnumber writes 50 to 1, so I do the merge at write time. A post goes onto a queue, workers push its ID into every follower's timeline in Redis, and a feed read becomes one range query on one key. The obvious problem is the account with 80 million followers.",
      delta: {
        addNodes: [
          { id: "fanq", label: "Fan-out queue", sub: "Kafka · PostCreated", kind: "queue", x: 330, y: 440 },
          { id: "fanworkers", label: "Fan-out workers", sub: "page followers · ZADD", kind: "worker", x: 660, y: 440 },
          { id: "graph", label: "Social graph", sub: "followers / followees · sharded", kind: "db", x: 990, y: 440 },
          { id: "timeline", label: "Timeline cache", sub: "Redis ZSET per user · 800 IDs", kind: "cache", x: 990, y: 0 },
        ],
        updateNodes: [
          { id: "api", label: "Feed API", sub: "stateless × N" },
          { id: "postdb", label: "Post store", sub: "sharded by post_id" },
        ],
        addEdges: [
          { id: "api-fanq", from: "api", to: "fanq", label: "PostCreated", async: true },
          { id: "fanq-fanworkers", from: "fanq", to: "fanworkers", label: "consume", async: true },
          { id: "fanworkers-graph", from: "fanworkers", to: "graph", label: "followers(author)" },
          { id: "fanworkers-timeline", from: "fanworkers", to: "timeline", label: "ZADD post_id" },
          { id: "api-timeline", from: "api", to: "timeline", label: "ZREVRANGE" },
        ],
      },
    },
    {
      version: "v3",
      title: "Timelines hold IDs; hydrate from a post cache",
      problem: "Every page needs 50 full posts. Fetching them from the post store at peak is ~9M reads/s, and putting full posts in timelines would make edits and deletes impossible.",
      evidence: "175K pages/s × 50 IDs ≈ 8.75M post reads/s. Storing full 1 KB posts in 800-entry timelines for 500M users would need ~400 TB of RAM (vs ~20 TB for IDs), and a single edit would touch every follower's copy.",
      options: [
        {
          name: "Store full post objects inside each timeline",
          pros: ["A read is one fetch"],
          cons: ["~20× the RAM", "Edits, deletes and like counts must update every copy", "Hot posts are duplicated millions of times"],
          verdict: "Lost: copies of mutable data are a consistency trap.",
        },
        {
          name: "Read posts from the post store's read replicas",
          pros: ["No new tier"],
          cons: ["9M reads/s is far beyond disk-backed replicas", "Popular posts hammer the same shard"],
          verdict: "Lost: it puts the database on the hottest path in the system.",
        },
        {
          name: "Timelines hold IDs only; a post cache (memcached/Redis) serves batched multi-gets; the store sees only misses",
          pros: ["One copy of each post: edits and deletes are one write plus invalidation", "Very high hit ratio, since recent popular posts dominate", "Multi-get batches 50 lookups into a few round trips"],
          cons: ["A second hop per read", "Cache invalidation on edit/delete"],
          verdict: "Chosen: normalise the data, denormalise only the ordering.",
          chosen: true,
        },
      ],
      decision:
        "Timelines store post IDs only. The Feed API reads a page of IDs, then multi-gets post objects (with author summary and counts) from a post cache, falling back to the post store for misses (cache-aside, populated on miss and on write). Deletes and edits update the store and invalidate the cache key; deleted posts are filtered during hydration.",
      newRisks: [
        { risk: "A viral post's cache key is hot and its expiry causes a stampede.", mitigation: "Single-flight on miss, in-process L1 for the hottest keys, no hard expiry for very hot entries (see failure flow)." },
        { risk: "Cache and store disagree after an edit.", mitigation: "Write to store then delete the cache key (not update), so the next read repopulates from the truth." },
      ],
      sayIt:
        "Timelines hold only post IDs, and the posts themselves live once in a post cache in front of the store. That keeps timelines 20 times smaller, and an edit, delete or like count is one write instead of a million.",
      delta: {
        addNodes: [{ id: "postcache", label: "Post cache", sub: "multi-get · ~99% hit ratio", kind: "cache", x: 660, y: 220 }],
        addEdges: [
          { id: "api-postcache", from: "api", to: "postcache", label: "multi-get 50 IDs" },
          { id: "postcache-postdb", from: "postcache", to: "postdb", label: "miss" },
        ],
      },
    },
    {
      version: "v4",
      title: "Hybrid fan-out: push for most authors, pull for celebrities",
      problem: "Accounts with tens of millions of followers turn one post into tens of millions of writes. Fan-out lag grows for everyone behind them in the queue.",
      evidence: "An 80M-follower account posting: 80M ZADDs ≈ 80 s of the entire fleet's fan-out capacity. During a final match, 40 large accounts posted within 2 minutes and fan-out lag for ordinary users hit 9 minutes. Meanwhile ~0.01% of accounts have > 1M followers.",
      options: [
        {
          name: "Push for everyone, with more fan-out workers",
          pros: ["One model"],
          cons: ["Capacity sized for celebrity bursts sits idle otherwise", "Writes go to followers who won't read for days"],
          verdict: "Lost: paying peak cost to precompute timelines nobody reads.",
        },
        {
          name: "Pull for everyone",
          pros: ["No write amplification"],
          cons: ["Back to the v1 scatter-gather on every read"],
          verdict: "Lost: solved one problem by bringing back the other.",
        },
        {
          name: "Hybrid: authors below a threshold (~1M followers) are pushed; above it, their posts go to a per-author recent-posts cache and are merged at read time",
          pros: ["Fan-out cost is bounded per post", "A typical user follows only a handful of celebrities, so the read-time merge is small", "Celebrity posts are cached once and read by millions, which is ideal for a cache"],
          cons: ["Two code paths", "Read does a small merge", "Threshold tuning and accounts crossing it"],
          verdict: "Chosen: it's how Twitter and Facebook actually do it.",
          chosen: true,
        },
      ],
      decision:
        "Authors with more than ~1M followers are marked 'pull'. Their new posts are stored, appended to a celebrity recent-posts cache (author → last ~100 post IDs), and not fanned out. At read time, the Feed API gets the user's followed celebrities from the social graph (cached), reads their recent IDs, and merges them with the precomputed timeline before ranking and hydration.",
      newRisks: [
        { risk: "A user who follows 2,000 celebrities makes the read-time merge expensive.", mitigation: "Cap the merge to the most-engaged followed celebrities, and cache that user's followed-celebrity list." },
        { risk: "An account crossing the threshold flips between modes.", mitigation: "Hysteresis (push below 900K, pull above 1.1M) and a switch that doesn't rewrite existing timelines." },
        { risk: "The celebrity cache is a set of very hot keys.", mitigation: "Replicate hot keys across nodes and cache them in-process on API servers for a second or two." },
      ],
      sayIt:
        "Push for normal accounts and pull for celebrities. Above about a million followers we stop fanning out and cache that author's recent posts once, then merge them in at read time. The merge is small because people follow a handful of celebrities, and fan-out cost per post is now bounded.",
      delta: {
        addNodes: [{ id: "hotcache", label: "Celebrity posts cache", sub: "author → recent IDs · pull path", kind: "cache", x: 330, y: 0 }],
        updateNodes: [{ id: "fanworkers", sub: "push only if author < 1M followers" }],
        addEdges: [
          { id: "api-hotcache", from: "api", to: "hotcache", label: "recent posts of followed celebs" },
          { id: "api-graph", from: "api", to: "graph", label: "followed celebs · followees" },
        ],
      },
    },
    {
      version: "v5",
      title: "Fan out only to active users; rebuild timelines on return",
      problem: "We fan out to every follower, but most of them won't open the app before the post scrolls out of their 800-entry timeline. That is wasted writes and wasted RAM.",
      evidence: "2B registered accounts vs 500M DAU. ~60% of fan-out writes went to users inactive for 30+ days, and their timelines held ~30 TB of RAM nobody read.",
      options: [
        {
          name: "Keep fanning out to everyone",
          pros: ["Every timeline always ready"],
          cons: ["60% of writes and RAM wasted"],
          verdict: "Lost.",
        },
        {
          name: "Evict inactive users' timelines by LRU only",
          pros: ["Memory reclaimed automatically"],
          cons: ["Fan-out still writes to them, so evicted keys are recreated constantly"],
          verdict: "Lost: fixes RAM but not write cost.",
        },
        {
          name: "Fan out only to followers active in the last ~30 days; when an inactive user returns, rebuild their timeline with a bounded pull",
          pros: ["Write and RAM cost track real readers", "Returning users pay one slower first load"],
          cons: ["First feed load after a long absence is slower (~300–800 ms)", "Need an 'active' flag in the follower lists"],
          verdict: "Chosen: precompute only for people who will read it.",
          chosen: true,
        },
      ],
      decision:
        "The social graph keeps an 'active' bit per follower (updated daily and on login). Fan-out pages through active followers only. A timeline missing in Redis triggers a rebuild: get followees, read recent posts per followee from the post store (bounded: last 2 days, at most 20 per author, parallel with a deadline), merge to 800, write the timeline, then serve.",
      newRisks: [
        { risk: "Rebuild storms when many users return at once (after an outage or a push campaign).", mitigation: "Rate-limit rebuilds per shard and serve a partial feed (celebrity posts + whatever has loaded) on deadline." },
        { risk: "A user who becomes active misses posts made while inactive.", mitigation: "The rebuild pulls recent posts, so nothing in the window is missed." },
      ],
      sayIt:
        "Only active users get fan-out. For someone who hasn't opened the app in a month, we skip the writes and rebuild their timeline with a bounded pull when they come back. Precomputation is only worth it for people who are going to read.",
      delta: {
        updateNodes: [
          { id: "fanworkers", sub: "push to active followers only · author < 1M" },
          { id: "timeline", sub: "Redis ZSET · active users · rebuilt on miss" },
        ],
      },
    },
    {
      version: "v6",
      title: "Ranking: score candidates instead of sorting by time",
      problem: "Reverse-chronological feeds bury the posts people care about under whatever was posted last, and engagement drops as users follow more accounts.",
      evidence: "Users following 500+ accounts saw only ~10% of their followees' posts in a session; most-liked posts from close connections were often 3+ pages down. Experiments with a ranked feed showed +12% sessions per user.",
      options: [
        {
          name: "Rank at write time (store a score in the timeline)",
          pros: ["Read stays a plain range query"],
          cons: ["Scores go stale: engagement and recency change after fan-out", "Can't personalise per viewer at write time cheaply"],
          verdict: "Lost: the best signals only exist at read time.",
        },
        {
          name: "One heavy model over every candidate",
          pros: ["Best quality per candidate"],
          cons: ["Hundreds of candidates × heavy model per read blows the latency budget"],
          verdict: "Lost on latency.",
        },
        {
          name: "Two-stage: candidates from timeline + celebrity merge (~500), light model filters to ~100, heavy model scores the top; chronological fallback on timeout",
          pros: ["Fits a ~100 ms budget", "Uses fresh signals (likes in the last minute, viewer affinity)", "Graceful degradation to chronological"],
          cons: ["A feature store and model serving to run", "Pagination needs a ranking snapshot so pages don't repeat"],
          verdict: "Chosen.",
          chosen: true,
        },
      ],
      decision:
        "The Feed API gathers ~500 candidates (timeline + celebrity posts), calls a ranking service with a 100 ms deadline, and gets back an ordered list. Features come from a feature store (viewer-author affinity, post engagement velocity, media type, age). The ranked list is snapshotted per session so the cursor pages through a stable order. On timeout the API serves chronological.",
      newRisks: [
        { risk: "Ranker latency spikes take the feed down.", mitigation: "Strict deadline and fallback to chronological; the ranker is an enhancement, not a dependency." },
        { risk: "Pagination shows duplicates as scores change between pages.", mitigation: "Snapshot the ranked candidate list (IDs) for the session; the cursor indexes into it." },
      ],
      sayIt:
        "Ranking sits on top of the same candidate set. I gather a few hundred candidates, a cheap model trims them and a heavier one orders the top, all within about 100 ms, with chronological order as the fallback if the ranker is slow.",
      delta: {
        addNodes: [{ id: "ranker", label: "Ranking service", sub: "2-stage · 100 ms budget", kind: "service", x: 0, y: 440 }],
        addEdges: [{ id: "api-ranker", from: "api", to: "ranker", label: "score candidates" }],
      },
    },
    {
      version: "v7",
      title: "Likes and counters off the hot path",
      problem: "Every like increments a counter on the post. Viral posts turn into hot keys and hot rows exactly when the most people are looking at them.",
      evidence: "A viral post received ~150K likes in a minute (2.5K/s on one counter). Synchronous increments on that row made it the slowest key in its shard and raised feed hydration p99 by 4× for every post on the shard.",
      options: [
        {
          name: "Synchronous UPDATE likes = likes + 1",
          pros: ["Exact"],
          cons: ["Row lock contention on hot posts", "Slows hydration reads on the same shard"],
          verdict: "Lost.",
        },
        {
          name: "Sharded counters (N sub-counters per post, summed on read)",
          pros: ["Spreads write contention"],
          cons: ["Reads must sum N keys", "Still synchronous"],
          verdict: "Useful inside the counter service, but not enough alone.",
        },
        {
          name: "Likes go to an event stream; a counter service aggregates per post per second and writes batched increments; hydrated counts come from the post cache",
          pros: ["Like requests return immediately", "2.5K/s on one post becomes one write per second", "The same stream feeds notifications and ranking signals"],
          cons: ["Counts lag by a second or two", "Dedupe needed for like/unlike toggles"],
          verdict: "Chosen: counts are approximate by nature and should never slow down reading.",
          chosen: true,
        },
      ],
      decision:
        "POST /like writes the (user, post) like edge and publishes LikeEvent to a stream partitioned by post_id. The counter service aggregates per post per second and applies one increment to its durable store and to the counts hash in the post cache. The viewer's own like state is read from the like edge, so it's always correct for them.",
      newRisks: [
        { risk: "A crash loses an in-memory aggregation window.", mitigation: "Commit stream offsets only after the batched write; replay from the last offset." },
        { risk: "A user sees their like reflected in 'liked' but not yet in the count.", mitigation: "The client adds its own like to the displayed count optimistically." },
      ],
      sayIt:
        "Likes go onto a stream partitioned by post, and a counter service turns thousands of increments a second on a viral post into one batched write. The viewer's own like is stored directly so it's always right for them, while the public count can lag a second.",
      delta: {
        addNodes: [
          { id: "engq", label: "Engagement stream", sub: "Kafka · LikeEvent by post_id", kind: "queue", x: 660, y: 660 },
          { id: "counters", label: "Counter service", sub: "aggregate per second · durable", kind: "worker", x: 990, y: 660 },
        ],
        addEdges: [
          { id: "api-engq", from: "api", to: "engq", label: "LikeEvent", async: true },
          { id: "engq-counters", from: "engq", to: "counters", label: "consume", async: true },
          { id: "counters-postcache", from: "counters", to: "postcache", label: "counts += n" },
        ],
      },
    },
  ],

  // ───────────────────────────── Stage 5 — Flows ─────────────────────────────
  flows: [
    {
      id: "publish",
      name: "Publishing a post (normal author, 312 active followers)",
      kind: "write",
      summary: "Stored synchronously, fanned out asynchronously into each follower's timeline.",
      hops: [
        { from: "client", to: "api", label: "POST /posts {text, idempotencyKey}", narration: "The author publishes.", why: "The idempotency key stops a double-tap from creating two posts." },
        { from: "api", to: "postdb", label: "insert post_id 1830…864 (Snowflake)", narration: "The post is written to its shard.", why: "Time-sortable ID: the ID alone orders it in every timeline." },
        { from: "api", to: "client", label: "201 {postId}", narration: "The author gets a response.", why: "The author's own feed merges their recent posts, so they see it immediately." },
        { from: "api", to: "fanq", label: "PostCreated{postId, authorId}", narration: "A fan-out event is queued.", why: "Fan-out multiplies by followers; nobody should wait for it.", async: true },
        { from: "fanq", to: "fanworkers", label: "consume", narration: "A fan-out worker picks it up.", why: "Partitioned by author so one author's posts fan out in order.", async: true },
        { from: "fanworkers", to: "graph", label: "active followers(author) → 312", narration: "Followers come back in pages of 5K (here, one page).", why: "Only active followers, and only for authors under the celebrity threshold." },
        { from: "fanworkers", to: "timeline", label: "pipelined ZADD ×312, trim to 800", narration: "The post ID is added to 312 sorted sets.", why: "ZADD is idempotent, so a redelivered event can't create duplicates." },
      ],
      takeaway: "The author's request ends at 'stored'. The 312 writes happen afterwards, typically within a second, and could be 3 or 3 million without changing the author's latency.",
    },
    {
      id: "read",
      name: "Loading the home feed",
      kind: "read",
      summary: "Timeline + celebrity merge → rank → hydrate → filter.",
      hops: [
        { from: "client", to: "api", label: "GET /feed?limit=50", narration: "The user opens the app.", why: "~175K of these per second at peak." },
        { from: "api", to: "timeline", label: "ZREVRANGE timeline:u 0 499", narration: "500 candidate IDs from the precomputed timeline.", why: "One key on one shard, ~1 ms." },
        { from: "api", to: "graph", label: "followed celebrities(u) → 14", narration: "In parallel: which pull-mode authors does this user follow?", why: "Cached per user; changes only on follow/unfollow." },
        { from: "api", to: "hotcache", label: "recent IDs for 14 authors", narration: "In parallel: their latest posts.", why: "Celebrity posts are cached once, read by millions." },
        { from: "api", label: "merge → ~560 candidates", narration: "Pushed and pulled candidates are merged and deduped.", why: "The hybrid's cost on the read side: a small, in-memory merge." },
        { from: "api", to: "ranker", label: "score 560 → top 50 (deadline 100 ms)", narration: "The ranker orders candidates.", why: "If it times out, use chronological order." },
        { from: "api", to: "postcache", label: "multi-get 50 posts + counts", narration: "The top 50 are hydrated.", why: "One batched call; misses go to the post store." },
        { from: "api", label: "drop deleted / blocked / unfollowed", narration: "Filters are applied to the hydrated posts.", why: "Read-time filtering makes deletes and blocks instant without touching timelines." },
        { from: "api", to: "client", label: "50 posts + cursor", narration: "The page is returned.", why: "The cursor points into a snapshot of the ranked list, so page 2 doesn't repeat page 1." },
      ],
      takeaway: "Every call on the read path runs in parallel with a deadline and a fallback. The precomputed timeline makes the common case one lookup.",
    },
    {
      id: "celebrity",
      name: "A celebrity with 80M followers posts",
      kind: "write",
      summary: "No fan-out. One cached list read by millions.",
      hops: [
        { from: "client", to: "api", label: "POST /posts", narration: "A celebrity account posts.", why: "Same API as everyone." },
        { from: "api", to: "postdb", label: "insert post", narration: "Stored like any post.", why: "One copy of the post, as always." },
        { from: "api", to: "hotcache", label: "LPUSH author:recent ← postId (keep 100)", narration: "The post ID is added to the author's recent list.", why: "This is the only 'fan-out' a celebrity post gets." },
        { from: "api", to: "fanq", label: "PostCreated", narration: "The event is still published.", why: "Other consumers (search, notifications) still need it.", async: true },
        { from: "fanq", to: "fanworkers", label: "consume", narration: "A fan-out worker receives it.", why: "—", async: true },
        { from: "fanworkers", to: "graph", label: "follower_count = 80M > 1M → pull mode", narration: "The worker sees the author is above the threshold.", why: "One check replaces 80M writes." },
        { from: "fanworkers", label: "skip fan-out", narration: "No timeline writes happen.", why: "Followers will pick the post up from the celebrity cache at read time." },
      ],
      takeaway: "The hybrid caps write cost per post. The read side pays a small merge, and the celebrity's recent list is the hottest, most cacheable data in the system.",
    },
    {
      id: "cold-start",
      name: "A user returns after two months",
      kind: "read",
      summary: "No precomputed timeline. Rebuild it with a bounded pull, then serve.",
      hops: [
        { from: "client", to: "api", label: "GET /feed", narration: "An inactive user opens the app.", why: "They weren't receiving fan-out." },
        { from: "api", to: "timeline", label: "ZREVRANGE → key missing", narration: "No timeline exists for this user.", why: "Inactive users are skipped by fan-out and their keys expire." },
        { from: "api", to: "graph", label: "followees(u) → 340 (14 celebrities)", narration: "Who does this user follow?", why: "Celebrities are handled by the normal pull path." },
        { from: "api", to: "postdb", label: "recent posts for 326 authors (2 days, ≤ 20 each), parallel, 250 ms deadline", narration: "A bounded scatter-gather on the author index.", why: "Bounded by time window, per-author cap and a deadline. Partial results are fine." },
        { from: "api", label: "merge → newest 800 IDs", narration: "Results are merged.", why: "Same shape as a precomputed timeline." },
        { from: "api", to: "timeline", label: "write timeline:u (800 IDs)", narration: "The timeline is materialised.", why: "From now on, the user is active and receives fan-out." },
        { from: "api", to: "postcache", label: "hydrate top 50", narration: "Posts are hydrated as usual.", why: "Same path as any read." },
        { from: "api", to: "client", label: "feed (first load ~500 ms)", narration: "The returning user gets a full feed.", why: "One slower load instead of months of wasted fan-out." },
      ],
      takeaway: "Pull is the fallback that lets push be selective: precompute for active users, rebuild for the rest on demand.",
    },
    {
      id: "like",
      name: "Liking a post",
      kind: "write",
      summary: "Immediate for the viewer, aggregated for everyone else.",
      hops: [
        { from: "client", to: "api", label: "POST /posts/1830…/like", narration: "The user taps the heart; the app shows it liked immediately.", why: "Optimistic UI: the user's own state doesn't wait." },
        { from: "api", to: "engq", label: "LikeEvent{user, post, +1}", narration: "The like edge is written and an event is published.", why: "Partitioned by post_id so one post's likes aggregate in one place.", async: true },
        { from: "api", to: "client", label: "204", narration: "The request returns.", why: "No counter write on the request path." },
        { from: "engq", to: "counters", label: "consume", narration: "The counter service reads the partition.", why: "—", async: true },
        { from: "counters", label: "1 s window: post 1830… +2,412", narration: "Likes are summed per post per second.", why: "2.4K writes become one." },
        { from: "counters", to: "postcache", label: "HINCRBY counts likes 2412", narration: "The cached count is updated (and the durable count persisted).", why: "Readers see the new count on their next hydration." },
      ],
      takeaway: "The viewer's own like is exact; the public count is a second behind. That trade removes the hottest key in the system from the request path.",
    },
    {
      id: "fanout-lag",
      name: "Failure: a live event floods the fan-out queue",
      kind: "failure",
      summary: "A final match ends. Millions post within minutes and fan-out lag climbs.",
      hops: [
        { from: "client", to: "api", label: "posts spike to 25K/s (20× normal)", narration: "Everyone posts at the final whistle.", why: "Load is synchronised by real-world events.", failure: true },
        { from: "api", to: "fanq", label: "PostCreated × 25K/s", narration: "The queue absorbs the burst.", why: "Posting stays fast because it doesn't wait for fan-out.", async: true },
        { from: "fanq", label: "consumer lag 0 → 4 min", narration: "Fan-out workers fall behind.", why: "The queue turns overload into delay, not errors.", failure: true },
        { from: "fanworkers", label: "autoscale on lag; large fan-outs on a separate lane", narration: "Workers scale out; authors with big follower counts are processed on their own partitions.", why: "Big fan-outs can't block small ones, and most feeds catch up within seconds." },
        { from: "fanworkers", to: "timeline", label: "batch ZADDs (pipelines of 1K)", narration: "Write efficiency goes up as batches grow.", why: "Throughput per worker rises under load." },
        { from: "api", to: "hotcache", label: "read path still merges celebrity posts live", narration: "The biggest accounts' posts appear instantly anyway.", why: "Pull mode is immune to fan-out lag." },
      ],
      takeaway: "A queue converts a write spike into lag. Separate lanes and pull-mode for the largest accounts mean the posts most people are waiting for aren't stuck behind the backlog.",
    },
    {
      id: "timeline-node-dies",
      name: "Failure: a timeline cache shard dies (node death)",
      kind: "failure",
      summary: "1/200th of users lose their precomputed timeline. The feed must still load.",
      hops: [
        { from: "api", to: "timeline", label: "ZREVRANGE → connection refused", narration: "The primary for this shard is down.", why: "At a few hundred nodes, this happens weekly.", failure: true },
        { from: "timeline", label: "replica promoted in ~10 s", narration: "Redis failover promotes a replica.", why: "Replicas are asynchronous, so the last second of ZADDs may be lost." },
        { from: "api", to: "graph", label: "meanwhile: followees(u)", narration: "For the affected users, the API falls back to the rebuild path.", why: "Pull is always available as a fallback." },
        { from: "api", to: "postdb", label: "bounded pull (tight deadline, smaller window)", narration: "A cheaper version of the cold-start rebuild.", why: "Degraded but working: 1/200th of users get a slightly slower feed.", failure: true },
        { from: "api", to: "postcache", label: "hydrate", narration: "Hydration is unaffected.", why: "Posts live in a different tier." },
        { from: "fanworkers", to: "timeline", label: "fan-out resumes on the new primary", narration: "Lost ZADDs are only a few posts, and they reappear on the next rebuild.", why: "Timelines are a cache. The post store and graph are the truth." },
      ],
      takeaway: "Timelines are a derived cache, so losing one is a latency problem, not data loss. The pull path that serves returning users doubles as the failover path.",
    },
    {
      id: "duplicate-fanout",
      name: "Failure: a fan-out worker crashes halfway (duplicate processing)",
      kind: "failure",
      summary: "The event is redelivered and fan-out starts again from the top.",
      hops: [
        { from: "fanq", to: "fanworkers", label: "PostCreated (author with 400K followers)", narration: "A worker starts fanning out.", why: "80 pages of 5K followers." },
        { from: "fanworkers", to: "timeline", label: "ZADD pages 1–47", narration: "The first 47 pages are written.", why: "—" },
        { from: "fanworkers", label: "crash before committing the offset", narration: "The worker dies.", why: "The offset is committed only when the whole fan-out completes.", failure: true },
        { from: "fanq", to: "fanworkers", label: "redelivered to another worker", narration: "The event is processed again from page 1.", why: "At-least-once delivery.", failure: true },
        { from: "fanworkers", to: "timeline", label: "ZADD pages 1–80 (1–47 are no-ops)", narration: "Re-adding the same post ID to a sorted set changes nothing.", why: "Idempotency comes from the data structure: a set can't hold a duplicate." },
      ],
      takeaway: "Pick operations that are naturally idempotent (set-add keyed by post ID) and redelivery stops being a problem. With a list (LPUSH), the same crash would show the post twice.",
    },
    {
      id: "hot-post",
      name: "Failure: a viral post's cache entry expires (stampede)",
      kind: "failure",
      summary: "Millions of feeds include the same post. Its cache key expires and every reader misses at once.",
      hops: [
        { from: "api", to: "postcache", label: "multi-get includes viral post → miss", narration: "The entry expired; thousands of API servers miss in the same second.", why: "Every feed read hydrates it.", failure: true },
        { from: "postcache", to: "postdb", label: "50K concurrent reads of one row", narration: "Without protection, every miss goes to the same shard.", why: "The shard holding one viral post becomes the bottleneck for all its neighbours.", failure: true },
        { from: "api", label: "single-flight: 1 fetch per key per API server", narration: "Concurrent misses on one server share a single fetch.", why: "Collapses thousands of misses to one per server." },
        { from: "postcache", label: "hot keys: no hard TTL; refresh in background", narration: "Very hot entries are refreshed before expiry instead of expiring.", why: "A hot key should never be absent." },
        { from: "api", label: "in-process L1 cache (1–2 s) for top keys", narration: "API servers keep the hottest posts in memory for a moment.", why: "Takes the hottest keys off the network entirely." },
      ],
      takeaway: "Hot keys need special handling: coalesce misses, refresh instead of expire, and keep the very hottest in-process.",
    },
  ],

  // ───────────────────────────── Stage 6 — Deep dives ─────────────────────────────
  deepDives: [
    {
      id: "push-pull",
      title: "Push, pull or hybrid fan-out",
      question: "Where should the merge of followees' posts happen: when the author writes, or when the reader reads?",
      context: [
        "Read:write ≈ 50:1, which favours push.",
        "Follower counts are extremely skewed: median ~100, max ~100M+.",
        "Most registered users are inactive on any given day.",
      ],
      options: [
        {
          name: "Pure pull (fan-out on read)",
          pros: ["No write amplification", "Always fresh", "Simple deletes"],
          cons: ["Scatter-gather on every read", "p99 set by the slowest shard", "Wasted work for users who load often"],
          verdict: "Lost as the main path. Right for celebrities and inactive users.",
        },
        {
          name: "Pure push (fan-out on write)",
          pros: ["Reads are one lookup", "Matches a read-heavy workload"],
          cons: ["Celebrity posts explode into tens of millions of writes", "Wasted writes to inactive users", "Fan-out lag during spikes"],
          verdict: "Lost as the only path.",
        },
        {
          name: "Hybrid: push for normal authors to active followers; pull for celebrities and for inactive users on return",
          pros: ["Write cost bounded per post", "Read cost is one lookup plus a small merge", "Each mechanism handles the case it's good at"],
          cons: ["Two code paths to test and monitor", "Threshold tuning"],
          verdict: "Chosen.",
          chosen: true,
        },
      ],
      recommendation:
        "Push by default, with two exceptions decided by data: authors above ~1M followers are pulled at read time from a per-author recent-posts cache; followers inactive for 30+ days are skipped and rebuilt on return. Monitor fan-out lag, merge cost per read, and the share of followers on each path.",
      sayIt:
        "Push suits a read-heavy feed until one author has 80 million followers, so it's a hybrid: push to active followers of normal accounts, pull celebrities at read time, and rebuild inactive users on demand. Each mechanism only handles the case it's good at.",
    },
    {
      id: "timeline-storage",
      title: "What goes in the timeline cache",
      question: "How big is a timeline, what does it hold, and which data structure?",
      context: [
        "≈ 500M active users, ~800 entries each.",
        "Posts are mutable (edits, deletes, counts); ordering is not.",
        "Fan-out is at-least-once.",
      ],
      options: [
        {
          name: "Full post objects in a Redis list",
          pros: ["Read = one call"],
          cons: ["~400 TB RAM", "Every edit/delete/like touches millions of copies", "LPUSH duplicates on redelivery"],
          verdict: "Lost.",
        },
        {
          name: "Post IDs in a Redis list (LPUSH + LTRIM)",
          pros: ["Small", "Simple"],
          cons: ["Not idempotent: redelivery inserts a duplicate", "Out-of-order fan-outs produce out-of-order timelines"],
          verdict: "Close, but redelivery and ordering bite.",
        },
        {
          name: "Post IDs in a sorted set scored by the time-sortable ID, trimmed to 800",
          pros: ["Idempotent ZADD", "Always ordered, even if fan-outs arrive out of order", "Cursor pagination by score", "~40 KB per user"],
          cons: ["Slightly more memory per entry than a list"],
          verdict: "Chosen.",
          chosen: true,
        },
      ],
      recommendation:
        "Sorted sets of post IDs, scored by Snowflake ID, capped at 800, only for active users, replicated, and treated as a cache that can always be rebuilt from the post store and graph. Everything mutable lives in the post cache and is joined at read time.",
      sayIt:
        "The timeline is a sorted set of post IDs scored by a time-sortable ID: idempotent under redelivery, ordered even when fan-outs arrive late, and about 40 KB per user. Everything that changes lives once in the post cache.",
    },
    {
      id: "consistency",
      title: "Deletes, unfollows and seeing your own post",
      question: "Timelines are precomputed copies of IDs. How do deletes, blocks and unfollows take effect, and how does an author see their own post right away?",
      context: [
        "A deleted post may be referenced by millions of timelines.",
        "Fan-out is asynchronous and can lag by seconds to minutes.",
        "Users notice two things above all: their own post missing, and a deleted or blocked post still showing.",
      ],
      options: [
        {
          name: "Scrub every timeline on delete/unfollow (reverse fan-out)",
          pros: ["Timelines are always clean"],
          cons: ["A delete from a big account costs as much as the original fan-out", "Still racy with in-flight fan-out"],
          verdict: "Lost as the primary mechanism (fine as lazy cleanup).",
        },
        {
          name: "Filter at read time during hydration: deleted flag, block list, current followee set; merge the viewer's own recent posts",
          pros: ["Deletes and blocks are effective immediately", "No reverse fan-out", "Read-your-own-writes without waiting for fan-out"],
          cons: ["A few filtered IDs per page means fetching slightly more candidates", "Block/followee sets must be cheap to check (cached)"],
          verdict: "Chosen.",
          chosen: true,
        },
      ],
      recommendation:
        "Make the timeline a hint and hydration the authority. Deleted posts are tombstoned in the store and cache; blocks and unfollows are checked against cached sets during hydration; the viewer's own last few posts are merged in from the author index. Background jobs lazily remove stale IDs from timelines.",
      sayIt:
        "I never trust the precomputed timeline as final. Hydration filters out deleted, blocked and unfollowed posts and merges in your own recent posts, so deletes are instant and you always see what you just posted, however far behind fan-out is.",
    },
  ],

  // ───────────────────────────── Stage 7 — Defend ─────────────────────────────
  tradeOffs: [
    {
      decision: "Hybrid fan-out (push + pull for celebrities)",
      alternative: "Pure push or pure pull",
      why: "Bounds write cost per post and keeps reads to one lookup plus a small merge.",
      whenToSwitch: "Small networks without celebrities: pure push is simpler. Recommendation-style feeds: mostly pull from a candidate index.",
    },
    {
      decision: "IDs in timelines, posts in a separate cache",
      alternative: "Full posts in timelines",
      why: "One copy of mutable data; ~20× less RAM.",
      whenToSwitch: "Never at this scale. For a small, read-only activity log, embedding is fine.",
    },
    {
      decision: "Fan out only to active users",
      alternative: "Fan out to everyone",
      why: "Most writes would go to people who never read them.",
      whenToSwitch: "If returning users' first load must be as fast as everyone else's (premium tier), keep their timelines warm.",
    },
    {
      decision: "Read-time filtering for deletes/blocks",
      alternative: "Scrub timelines on every change",
      why: "Instant effect, no reverse fan-out.",
      whenToSwitch: "Legal takedowns may also require scrubbing derived stores; do it lazily on top of the filter.",
    },
    {
      decision: "Two-stage ranking with chronological fallback",
      alternative: "Rank at write time, or no ranking",
      why: "Fresh signals only exist at read time; the fallback keeps the feed up when the ranker isn't.",
      whenToSwitch: "Products where users explicitly want chronological (a 'Latest' tab) skip the ranker.",
    },
    {
      decision: "Aggregated, slightly lagging like counts",
      alternative: "Exact synchronous counters",
      why: "Viral posts would become hot rows on the read path.",
      whenToSwitch: "When counts drive payouts, reconcile from the stream in batch.",
    },
  ],

  bottlenecks: [
    { item: "Celebrity posts and the read-time merge", mitigation: "Threshold with hysteresis, cap merged celebrities per user, replicate hot celebrity keys, in-process L1." },
    { item: "Fan-out lag during live events", mitigation: "Autoscale on lag, separate lanes for large fan-outs, pipelined ZADDs." },
    { item: "Timeline cache memory", mitigation: "IDs only, 800 cap, active users only, rebuild on demand." },
    { item: "Hot posts in the post cache", mitigation: "Single-flight, background refresh for hot keys, L1 cache in API servers." },
    { item: "Social graph reads for huge accounts", mitigation: "Paged follower lists, active-only indexes, cached followed-celebrity lists per user." },
    { item: "Rebuild storms after outages", mitigation: "Rate-limited rebuilds per shard, partial feeds on deadline." },
  ],

  followUps: [
    {
      question: "How would you add a 'For You' feed with posts from accounts I don't follow?",
      answer: [
        "Candidate generation changes: instead of (or as well as) the following timeline, retrieve candidates from an embedding index (two-tower model: user vector vs post vectors) and from trending/topic pools.",
        "The ranking stage stays the same shape, with more features. It's pull-based by nature: nothing is fanned out.",
      ],
    },
    {
      question: "How do you handle a new follow? Should old posts appear?",
      answer: [
        "Asynchronously backfill the followee's last N posts into the follower's timeline (ZADD, so ordering is automatic).",
        "For a celebrity followee, nothing to backfill: they're merged at read time from the start.",
      ],
    },
    {
      question: "How would you run this across multiple regions?",
      answer: [
        "Each user has a home region where their timeline is maintained. Posts are written in the author's region and replicated globally (asynchronously).",
        "Fan-out runs in each follower's home region, consuming the replicated PostCreated stream, so timelines are always local reads.",
        "On region loss, users are served from another region by rebuilding timelines via pull, which is the same fallback as a cache shard loss.",
      ],
    },
    {
      question: "How do you show 'N new posts' at the top while the user is scrolling?",
      answer: [
        "The client periodically asks for the count of timeline entries newer than its first item (ZCOUNT by score), or the server pushes a small hint over an existing connection.",
        "Inserting them only on tap keeps the user's scroll position and the cursor stable.",
      ],
    },
  ],

  mistakes: [
    "Choosing push or pull without discussing the celebrity case.",
    "Storing full posts in every follower's timeline.",
    "Offset-based pagination on a feed that changes at the top.",
    "Synchronous fan-out inside the post request.",
    "Fanning out to every registered user, including inactive ones.",
    "Using a list (LPUSH) and getting duplicates when fan-out is retried.",
    "No fallback when the ranker or a cache shard is slow.",
  ],

  redFlags: [
    "'Just query posts WHERE author IN (followees) ORDER BY time' at 175K reads/s.",
    "No answer to 'what happens when someone with 80M followers posts?'",
    "Deletes that require rewriting millions of timelines.",
    "Exact, synchronous like counters on viral posts.",
    "Treating the timeline cache as the source of truth.",
  ],
};
