import type { Problem } from "../../types";

/**
 * Video Streaming (YouTube / Netflix-style)
 *
 * Narrative spine: two completely different systems share one product.
 *  - The UPLOAD side is a batch pipeline: big files in, minutes of CPU per video, nobody waiting on the result.
 *  - The WATCH side is a bandwidth problem: tens of Tbps out, and the only thing that can serve it is a CDN.
 * The metadata (title, status, manifest URL) is tiny and read-heavy; the bytes never touch our API servers.
 *  - uploads go straight to object storage           -> API servers stay small and stateless
 *  - transcoding is a queue-fed, chunk-parallel DAG  -> a 2-hour film is ready in minutes, crashes cost one chunk
 *  - adaptive bitrate (HLS/DASH) segments            -> the player, not the server, picks quality every 4 s
 *  - CDN + origin shield + request coalescing        -> a viral video costs one origin read per region, not millions
 *  - views go through an event stream                -> counting never sits on the playback path
 */
export const videoStreaming: Problem = {
  slug: "video-streaming",
  title: "Video Streaming",
  tagline: "Upload pipeline, chunk-parallel transcoding, adaptive bitrate and a CDN that carries 40 Tbps",
  difficulty: "Hard",

  overview: {
    whatItIs:
      "A video streaming platform lets people upload videos and lets everyone else watch them on any device and any network, starting in a second or two and without stalling. Behind the play button sits a factory that turns one uploaded file into dozens of small, ready-to-serve pieces, and a delivery network that puts those pieces close to every viewer.",
    whatItDoes: [
      "Accepts large uploads reliably, even over flaky mobile networks.",
      "Converts each upload into many resolutions and codecs (the 'encoding ladder').",
      "Cuts video into short segments so the player can switch quality mid-stream.",
      "Delivers segments from servers near the viewer (CDN) instead of a central data centre.",
      "Tracks views and watch time for creators, ranking and billing.",
    ],
    whereUsed: [
      "YouTube, Netflix, Twitch VODs, Vimeo, TikTok",
      "Course platforms (Coursera, Udemy) and corporate video portals",
      "Video in social apps: Instagram Reels, LinkedIn, X",
      "Any app that plays recorded video at scale: news sites, sports highlights",
    ],
    coreIdea:
      "Do the expensive work once, at upload time, so watching is just serving static files. Transcode into many small segments at many bitrates, push them to the edge, and let the player choose. The hard parts are the transcoding pipeline (CPU) and delivery (bandwidth), and they're separate systems.",
    notToBeConfusedWith: [
      { term: "Live streaming", difference: "Live has seconds of latency budget, so transcoding happens in real time and segments are produced while viewers watch. VOD (this problem) can take minutes to prepare a video and serve it forever." },
      { term: "Video calling (WebRTC)", difference: "Calls are peer-to-peer or SFU-relayed with sub-200 ms latency and no storage. Streaming tolerates seconds of buffering in exchange for quality and scale." },
      { term: "File download", difference: "A download is one file at one quality. Streaming is many small segments at many qualities, chosen continuously by the player." },
    ],
  },

  // ───────────────────────────── Stage 1 — Understand ─────────────────────────────
  interviewQuestion:
    "Design a video streaming platform like YouTube. Users upload videos, and viewers around the world watch them on phones, laptops and TVs. Focus on the upload/processing pipeline and on playback at scale.",

  clarifyingQuestions: [
    {
      question: "Is this video on demand only, or live streaming too?",
      whyItMatters:
        "Live needs real-time transcoding and seconds of end-to-end latency. VOD lets us spend minutes preparing each video. The pipelines are very different.",
      answer: "Video on demand only. Live is a follow-up.",
      designImpact:
        "Transcoding is an offline batch pipeline fed by a queue. We optimise for throughput and cost, not seconds of latency.",
    },
    {
      question: "How many views and uploads per day?",
      whyItMatters: "Views set egress bandwidth and CDN size. Uploads set ingest bandwidth, transcoding compute and storage growth.",
      answer: "About 1 billion views a day, average watch time 8 minutes. About 500K uploads a day, averaging 10 minutes each.",
      designImpact:
        "≈ 5.5M concurrent streams on average and ~40 Tbps at peak. Delivery has to be a CDN. 5M minutes of new video a day makes transcoding the biggest compute bill.",
    },
    {
      question: "Which devices and network conditions must we support?",
      whyItMatters:
        "A 4K TV on fibre and a phone on a train need different bitrates, and the train's bandwidth changes every few seconds.",
      answer: "Everything from 2G-ish mobile to 4K TVs. Playback should adapt to the network.",
      designImpact:
        "Adaptive bitrate streaming (HLS/DASH): an encoding ladder from 144p to 4K and short segments (~4 s) so the player can switch quality between segments.",
    },
    {
      question: "How fast must a video be watchable after upload?",
      whyItMatters: "It decides whether transcoding can be a slow serial job or must be parallelised.",
      answer: "Most videos within a few minutes of upload finishing. A 2-hour upload shouldn't take 2 hours.",
      designImpact: "Split each video into chunks and transcode them in parallel, then stitch the manifests. Low resolutions publish first.",
    },
    {
      question: "What start-up time and rebuffering targets do we have?",
      whyItMatters: "Viewer abandonment rises sharply after ~2 s of start-up delay, so this drives caching and segment design.",
      answer: "Start playing in under 2 s at p90. Rebuffering under 1% of watch time.",
      designImpact:
        "Metadata and manifests must be cache hits. The first segment should be small and low bitrate, served from a nearby edge.",
    },
    {
      question: "Do we need view counts, recommendations, comments, DRM?",
      whyItMatters: "Each is a sizeable system. We should agree what's in scope.",
      answer: "View counts yes (approximate is fine). Recommendations, comments and DRM are out of scope.",
      designImpact:
        "View counting is an analytics stream, eventually consistent, and never on the playback path.",
    },
  ],

  requirements: {
    functional: [
      "Upload: users upload video files (up to a few GB), resumably.",
      "Process: transcode each upload into an adaptive-bitrate ladder with thumbnails.",
      "Watch: viewers stream any ready video on any device, with quality adapting to their network.",
      "Metadata: title, description, status (processing / ready / failed), duration.",
      "View counts per video, approximately real-time.",
    ],
    nonFunctional: [
      { name: "Playback start", target: "< 2 s p90", why: "Every extra second of start-up loses viewers." },
      { name: "Rebuffering", target: "< 1% of watch time", why: "Stalls are the top driver of abandonment." },
      { name: "Egress", target: "≈ 17 Tbps average, ~40 Tbps peak", why: "5.5M concurrent streams × ~3 Mbps average." },
      { name: "Processing latency", target: "Most videos ready within ~5 min of upload completing", why: "Creators expect to share right away." },
      { name: "Durability", target: "Never lose an uploaded original", why: "Re-encoding later (new codecs) needs the source." },
      { name: "Availability", target: "Playback 99.99%; upload 99.9%", why: "Playback is the product. A failed upload can be retried." },
    ],
    outOfScope: [
      "Live streaming (follow-up)",
      "Recommendations, search, comments",
      "DRM and content licensing",
      "Monetisation / ads insertion",
    ],
  },

  // ───────────────────────────── Stage 2 — Size ─────────────────────────────
  estimates: [
    {
      title: "Concurrent streams and egress",
      reasoning: [
        "1B views/day × 8 min = 8B watch-minutes/day",
        "8B ÷ 1,440 min/day ≈ 5.5M concurrent streams on average; peak ~2.5× ≈ 14M",
        "Average delivered bitrate ~3 Mbps (mix of mobile 480p and TV 1080p/4K)",
        "5.5M × 3 Mbps ≈ 17 Tbps average, ~40 Tbps peak",
      ],
      result: "≈ 17 Tbps average, ~40 Tbps peak egress",
      soWhat:
        "No data centre can push 40 Tbps to the whole planet. Delivery has to be a CDN with thousands of edge servers, and the origin must only see cache misses.",
    },
    {
      title: "Playback request rate",
      reasoning: [
        "Video starts: 1B ÷ 86,400 ≈ 11.6K/s, peak ~30K/s (each = metadata + manifest)",
        "Segments: 5.5M streams each fetch one 4 s segment every 4 s ≈ 1.4M segment requests/s",
      ],
      result: "≈ 30K metadata reads/s at peak, ≈ 1.4M segment GETs/s on average",
      soWhat:
        "Segment requests are static-file GETs and belong entirely to the CDN. Metadata reads are small and must be cached so start-up stays under 2 s.",
    },
    {
      title: "Upload ingest",
      reasoning: [
        "500K uploads/day × 10 min = 5M minutes of video per day",
        "Phone 1080p at ~15 Mbps ≈ 110 MB per minute",
        "5M × 110 MB ≈ 550 TB/day ≈ 6.4 GB/s ≈ 51 Gbps sustained inbound",
      ],
      result: "≈ 550 TB/day of originals, ~50 Gbps inbound",
      soWhat:
        "Proxying 50 Gbps of multi-GB uploads through API servers would tie up thousands of connections for minutes each. Clients upload directly to object storage with presigned, resumable URLs.",
    },
    {
      title: "Transcoding compute",
      reasoning: [
        "Ladder: 6 resolutions (144p → 1080p, + 4K when the source allows) × H.264 for compatibility",
        "≈ 1–2 CPU-minutes per rendition per minute of video at a reasonable preset → ~10 CPU-min per video-minute",
        "Add a modern codec (VP9/AV1) for popular videos: AV1 is ~5–10× the CPU of H.264",
        "5M video-min/day × 10 CPU-min ≈ 50M CPU-min/day ÷ 1,440 ≈ 35K cores busy around the clock (before AV1)",
      ],
      result: "≈ 35K+ cores of continuous transcoding",
      soWhat:
        "Transcoding is the biggest compute cost. It must be queue-fed, autoscaled, preemptible-friendly (spot instances) and chunked, and expensive codecs should only be spent on videos that earn the views.",
    },
    {
      title: "Storage growth",
      reasoning: [
        "Original: ~110 MB/min. H.264 ladder (≈ 5 + 2.5 + 1.2 + 0.7 + 0.4 + 0.2 Mbps ≈ 10 Mbps) ≈ 75 MB/min",
        "≈ 185 MB per video-minute × 5M min/day ≈ 925 TB/day",
        "× 365 ≈ 340 PB/year before replication",
      ],
      result: "≈ 1 PB/day, ~340 PB/year",
      soWhat:
        "Storage is object storage with lifecycle tiers: originals move to cold/archive storage after processing, and long-tail renditions to infrequent-access tiers. Nothing here belongs in a database.",
    },
    {
      title: "Popularity skew",
      reasoning: [
        "Assume ~10% of videos get ~90% of views; most uploads are watched a handful of times",
        "At a 95% CDN hit ratio, origin still serves 5% × 17 Tbps ≈ 850 Gbps",
        "Each extra 1% of hit ratio saves ~170 Gbps of origin egress",
      ],
      result: "The CDN hit ratio is the most important cost number",
      soWhat:
        "Popular videos live at the edge and the long tail is served through a regional mid-tier (origin shield). Hit ratio is worth engineering for: shields, request coalescing and prefetching the next segment.",
    },
  ],

  // ───────────────────────────── Stage 3 — Start simple ─────────────────────────────
  api: [
    {
      method: "POST",
      path: "/v1/uploads",
      request: '{ "fileName": "trip.mp4", "sizeBytes": 1240000000, "contentType": "video/mp4" }',
      response: '201 { "uploadId": "u_9f2", "videoId": "v_7Kp", "partSize": 16777216, "partUrls": ["https://store…?sig=…"] }',
      notes: "Returns presigned URLs for a multipart (resumable) upload straight to object storage. The API server never carries video bytes.",
    },
    {
      method: "POST",
      path: "/v1/uploads/{uploadId}/complete",
      request: '{ "parts": [{ "n": 1, "etag": "…" }, …] }',
      response: '202 { "videoId": "v_7Kp", "status": "PROCESSING" }',
      notes: "Finalises the multipart upload and publishes VideoUploaded. 202 because processing is asynchronous.",
    },
    {
      method: "GET",
      path: "/v1/videos/{videoId}",
      response: '{ "title": "…", "status": "READY", "durationS": 612, "manifestUrl": "https://cdn…/v_7Kp/master.m3u8?token=…", "thumbnails": […] }',
      notes: "The only API call on the playback path. Cached aggressively. The manifest URL is signed and short-lived so it can't be hot-linked forever.",
    },
    {
      method: "GET",
      path: "{cdn}/v/{videoId}/master.m3u8  ·  /720p/seg_00042.m4s",
      response: "Manifest (list of renditions) · 4 s media segment",
      notes: "Static files served by the CDN. The player reads the master manifest, picks a rendition, then fetches segments one by one, switching rendition as bandwidth changes.",
    },
    {
      method: "POST",
      path: "/v1/videos/{videoId}/events",
      request: '{ "sessionId": "…", "type": "heartbeat", "positionS": 184, "rendition": "720p" }',
      response: "204 No Content",
      notes: "Watch heartbeats (every ~30 s) for view counts and quality metrics. Fire-and-forget: published to a stream, never written to the video row.",
    },
    {
      method: "internal",
      path: "VideoUploaded { videoId, objectKey }  ·  TranscodeTask { videoId, chunk, rendition }",
      response: "(messages, no reply)",
      notes: "Events that drive the processing pipeline. Tasks have deterministic output keys so a retried task overwrites, not duplicates.",
    },
  ],

  communication: {
    rule:
      "If the caller is blocked on the answer (the player needs the manifest, the uploader needs an upload URL), it's a synchronous call with a deadline. If the work takes minutes and nobody waits on it (transcoding, counting views), it goes through a queue. Bytes never travel through our API: uploads go straight to object storage and playback straight to the CDN.",
    choices: [
      {
        interaction: "Uploader → Video API: start/complete an upload",
        style: "sync-api",
        why: "The client can't do anything until it has upload URLs, and it needs to know the upload was accepted. Both calls are tiny and fast.",
        ifWrong: "Making 'complete' wait for transcoding would hold a request open for minutes. It returns 202 and the client polls (or gets a notification) for READY.",
      },
      {
        interaction: "Uploader → object storage: the video bytes",
        style: "sync-api",
        why: "A direct, resumable HTTP upload (multipart) using presigned URLs. Each part is retried independently.",
        ifWrong: "Proxying through the API (or putting bytes on a queue) means 50 Gbps through our servers and multi-GB messages, which no broker is designed for.",
      },
      {
        interaction: "Upload complete → transcoding pipeline",
        style: "async-queue",
        why: "Minutes of CPU work at a different speed from the API. The queue absorbs upload bursts, lets transcoders scale on backlog, and survives worker crashes.",
        ifWrong: "A synchronous call to a transcoder ties the upload request to a 10-minute job, and a burst of uploads overwhelms a fixed transcoder pool.",
      },
      {
        interaction: "Orchestrator → transcode workers (chunk tasks)",
        style: "async-queue",
        why: "A work queue of independent tasks, leased by workers. A worker dying (spot instance reclaimed) only re-runs one 10-second chunk.",
        ifWrong: "RPC from orchestrator to a specific worker needs the orchestrator to track worker health and pace. A pull-based queue gets that for free.",
      },
      {
        interaction: "Player → CDN → origin (segments)",
        style: "sync-api",
        why: "The player is blocked on each segment: no segment, no picture. On a miss, the edge fetches from the shield/origin synchronously, with request coalescing so a million viewers produce one fetch.",
        ifWrong: "There's no queue on a playback path. The thing to avoid is every edge miss going all the way to storage, which is what the shield fixes.",
      },
      {
        interaction: "Player → view events → counters",
        style: "async-queue",
        why: "Nobody waits on a view count. Heartbeats go to a stream, are aggregated in windows, and written in batches.",
        ifWrong: "Incrementing the video row on every view makes a viral video a single hot row taking 50K writes/s, and puts a database on the playback path.",
      },
    ],
  },

  dataModel: [
    {
      entity: "video (metadata DB)",
      fields: [
        { name: "video_id", type: "STRING", note: "short random ID, partition key" },
        { name: "uploader_id", type: "BIGINT", note: "secondary index for 'my videos'" },
        { name: "title / description", type: "STRING" },
        { name: "status", type: "ENUM(UPLOADING, PROCESSING, READY, FAILED, BLOCKED)" },
        { name: "duration_s", type: "INT" },
        { name: "renditions", type: "JSON", note: "e.g. [144p…1080p] × [h264, av1]; grows as more are produced" },
        { name: "manifest_path / thumbnail_paths", type: "STRING", note: "object-storage keys, served via the CDN" },
        { name: "view_count", type: "BIGINT", note: "approximate, written in batches by aggregators" },
      ],
      accessPatterns: [
        "Get by video_id (~30K/s at peak, almost all from cache)",
        "List by uploader_id (creator dashboard)",
        "Update status / renditions from the pipeline (a few writes per video)",
      ],
      insight:
        "The metadata row is a few KB, while the video is gigabytes. Keeping them apart is the whole design: the DB serves small, cacheable reads, and the bytes live in object storage behind a CDN.",
    },
    {
      entity: "transcode_task (pipeline state)",
      fields: [
        { name: "video_id + chunk_idx + rendition", type: "KEY", note: "unique task identity" },
        { name: "state", type: "ENUM(PENDING, LEASED, DONE, FAILED)" },
        { name: "lease_owner / lease_expires", type: "STRING / TIMESTAMP" },
        { name: "attempt", type: "INT", note: "dead-letter after N" },
        { name: "output_key", type: "STRING", note: "deterministic: v/{id}/{rendition}/seg_{chunk}.m4s" },
      ],
      accessPatterns: [
        "Lease next PENDING task (workers pull)",
        "Mark DONE; orchestrator checks 'all chunks of rendition R done?'",
      ],
      insight:
        "Deterministic output keys make every task idempotent: a re-run writes the same object. That's what lets us retry freely on spot instances.",
    },
    {
      entity: "object layout (object storage)",
      fields: [
        { name: "originals/{video_id}", type: "BLOB", note: "kept forever, moved to cold tier after processing" },
        { name: "v/{video_id}/master.m3u8", type: "TEXT", note: "lists renditions and bandwidths" },
        { name: "v/{video_id}/{rendition}/index.m3u8", type: "TEXT", note: "segment list for one rendition" },
        { name: "v/{video_id}/{rendition}/seg_NNNNN.m4s", type: "BLOB", note: "~4 s CMAF/fMP4 segment" },
      ],
      accessPatterns: [
        "Write once by transcoders",
        "Read by CDN shields on cache miss, otherwise never",
      ],
      insight:
        "Everything the player touches is an immutable static file. Immutable means it can be cached for a year at every edge without any invalidation logic.",
    },
  ],

  v1: {
    title: "v1: one app server that does everything",
    description: [
      "A single app server accepts the upload over HTTP, writes the file to local disk, runs ffmpeg to produce one 720p MP4, and saves metadata to a database.",
      "Playback is a progressive download: the player GETs the MP4 from the same server with HTTP range requests.",
      "It works for a team's internal video portal with a few hundred videos and a few viewers at a time.",
    ],
    diagram: {
      nodes: [
        { id: "client", label: "Viewers & uploaders", sub: "web · mobile · TV", kind: "client", x: 0, y: 220 },
        { id: "api", label: "App server", sub: "upload + ffmpeg + serve file", kind: "service", x: 330, y: 220 },
        { id: "db", label: "Metadata DB", sub: "videos table", kind: "db", x: 330, y: 440 },
        { id: "obj", label: "Local disk", sub: "originals + one MP4", kind: "db", x: 990, y: 0 },
      ],
      edges: [
        { id: "client-api", from: "client", to: "api", label: "upload / watch" },
        { id: "api-db", from: "api", to: "db", label: "metadata" },
        { id: "api-obj", from: "api", to: "obj", label: "write / read video" },
      ],
    },
    whatBreaksFirst: [
      "A 1 GB upload holds an app-server connection for minutes. A few hundred concurrent uploads exhaust it.",
      "ffmpeg pins every core for ~10 minutes per video, so playback requests on the same box time out.",
      "One 720p file: buffers on mobile, looks bad on a TV, and wastes bandwidth for small screens.",
      "One server's NIC (~10–25 Gbps) is ~1,000× short of the egress we need.",
    ],
  },

  // ───────────────────────────── Stage 4 — Evolve ─────────────────────────────
  evolution: [
    {
      version: "v2",
      title: "Direct-to-storage uploads and an async transcoding pipeline",
      problem: "Uploads and transcoding share a box with playback. Long uploads exhaust connections and ffmpeg starves the CPU, so watching breaks whenever people upload.",
      evidence: "550 TB/day of uploads ≈ 50 Gbps of long-lived connections. Each video costs ~10 CPU-minutes per video-minute; a 10-minute upload is ~100 CPU-minutes, so a 32-core box handles ~20 uploads an hour while serving nothing else.",
      options: [
        {
          name: "Bigger app servers, with transcoding in a background thread",
          pros: ["No new components"],
          cons: ["Upload bytes still pass through the API tier", "CPU contention with request handling remains", "A crash loses the in-progress transcode"],
          verdict: "Lost: it hides the problem inside the same box.",
        },
        {
          name: "API proxies uploads to storage; a separate transcoder service is called synchronously on completion",
          pros: ["Separates CPU work from API"],
          cons: ["The API still carries 50 Gbps of bytes", "A synchronous call to a 10-minute job blocks a request", "No buffering when uploads spike"],
          verdict: "Lost: it moves the CPU but keeps the bandwidth and adds a blocking call.",
        },
        {
          name: "Presigned multipart uploads straight to object storage; 'complete' publishes an event to a queue; transcoder workers consume",
          pros: ["API servers never touch bytes, so they stay tiny and stateless", "Resumable uploads survive network drops", "Queue absorbs bursts; workers autoscale on backlog", "Worker crash = message redelivered"],
          cons: ["Two-phase upload flow (init → parts → complete)", "Uploads that never complete leave orphan parts", "Status is eventually consistent (PROCESSING → READY)"],
          verdict: "Chosen: it separates the three resources (API requests, bytes, CPU) so each scales on its own.",
          chosen: true,
        },
      ],
      decision:
        "POST /uploads returns presigned multipart URLs; the client PUTs 16 MB parts directly to object storage, retrying parts individually. On /complete the API marks the video PROCESSING and publishes VideoUploaded to a transcode queue. Stateless transcoder workers consume, read the original, write renditions back to object storage and mark the video READY.",
      newRisks: [
        { risk: "Abandoned multipart uploads accumulate storage cost.", mitigation: "Lifecycle rule: abort incomplete multipart uploads after 24 h." },
        { risk: "A malformed or malicious file crashes the transcoder repeatedly.", mitigation: "Probe the file first (ffprobe) in a sandbox; retry limit then dead-letter; mark FAILED and tell the uploader." },
        { risk: "One worker transcodes a whole 2-hour video serially, so long videos take hours.", mitigation: "That's the next problem (v4): split into chunks and parallelise." },
      ],
      sayIt:
        "API servers should never carry video bytes. The client uploads straight to object storage with presigned, resumable URLs, and 'complete' just drops an event on a queue. Transcoders pull from that queue, so uploads, API traffic and CPU-heavy encoding each scale independently.",
      delta: {
        addNodes: [
          { id: "queue", label: "Transcode queue", sub: "VideoUploaded events", kind: "queue", x: 660, y: 220 },
          { id: "workers", label: "Transcode workers", sub: "ffmpeg · stateless · autoscaled", kind: "worker", x: 1320, y: 220 },
        ],
        updateNodes: [
          { id: "api", label: "Video API", sub: "stateless × N · no video bytes" },
          { id: "obj", label: "Object storage", sub: "originals + renditions" },
        ],
        removeEdges: ["api-obj"],
        addEdges: [
          { id: "client-obj", from: "client", to: "obj", label: "multipart upload (presigned)" },
          { id: "api-queue", from: "api", to: "queue", label: "VideoUploaded", async: true },
          { id: "queue-workers", from: "queue", to: "workers", label: "consume", async: true },
          { id: "workers-obj", from: "workers", to: "obj", label: "read original · write renditions" },
          { id: "workers-db", from: "workers", to: "db", label: "status = READY" },
        ],
      },
    },
    {
      version: "v3",
      title: "Adaptive bitrate: an encoding ladder cut into 4-second segments",
      problem: "One 720p MP4 is wrong for almost everyone: it stalls on weak mobile networks, looks soft on TVs, and a viewer whose bandwidth drops mid-video has no way to step down.",
      evidence: "Mobile throughput routinely swings between 1 and 20 Mbps within a minute. With a single 2.5 Mbps file, any viewer below ~3 Mbps rebuffers. Measured on the v2 player: 6% of watch time spent rebuffering on mobile, against a 1% target.",
      options: [
        {
          name: "Several full-length MP4s (480p / 720p / 1080p); the player picks one at start",
          pros: ["Simple to produce", "Works with plain progressive download"],
          cons: ["The choice is fixed for the whole video", "Switching means restarting at a byte offset in another file"],
          verdict: "Lost: networks change mid-video, so the choice has to be revisited continuously.",
        },
        {
          name: "Server-side adaptation: the server measures throughput and picks the bitrate per request",
          pros: ["Thin client"],
          cons: ["Server state per viewer", "The server can't see the player's buffer level", "Breaks plain CDN caching"],
          verdict: "Lost: it makes stateless static delivery stateful.",
        },
        {
          name: "HLS/DASH: transcode to a ladder of renditions, cut each into ~4 s aligned segments, publish manifests; the player chooses per segment",
          pros: ["The player adapts every 4 s based on measured throughput and buffer", "Everything stays static files, so it's perfectly CDN-cacheable", "Standard on every device (HLS on Apple, DASH/CMAF elsewhere)"],
          cons: ["~6–12 renditions to produce and store per video", "Segment boundaries must be aligned (keyframe every 2 s) across renditions", "More objects per video (thousands of segments)"],
          verdict: "Chosen: it is the industry standard because the decision belongs where the information is, in the player.",
          chosen: true,
        },
      ],
      decision:
        "Transcode each video into a ladder (144p, 240p, 360p, 480p, 720p, 1080p, plus 1440p/4K if the source supports it), with a forced keyframe every 2 s so segments align. Package as CMAF (fMP4) with both an HLS and a DASH manifest. The master manifest lists every rendition with its bandwidth; the player starts low and climbs.",
      newRisks: [
        { risk: "Storage multiplies by the number of renditions.", mitigation: "Per-title encoding: a static slideshow needs far fewer bits than a football match. Skip rungs that add nothing." },
        { risk: "The player oscillates between renditions on a jittery link.", mitigation: "Buffer-based ABR with hysteresis: only step up after sustained throughput, step down early when the buffer drains." },
        { risk: "Transcoding a full ladder serially makes long videos even slower to publish.", mitigation: "Chunk-parallel transcoding (v4)." },
      ],
      sayIt:
        "I transcode into a ladder of resolutions and cut each into aligned 4-second segments, with an HLS/DASH manifest on top. The player measures its own throughput and buffer and picks a rendition per segment. Quality adapts every few seconds, and everything stays static files the CDN can cache.",
      delta: {
        updateNodes: [
          { id: "workers", sub: "ABR ladder 144p → 4K · 4 s CMAF segments" },
          { id: "obj", sub: "originals + segments + HLS/DASH manifests" },
        ],
      },
    },
    {
      version: "v4",
      title: "Chunk-parallel transcoding, coordinated by a pipeline orchestrator",
      problem: "One worker transcodes a whole video and all its renditions serially. A 2-hour film takes hours, and a worker dying at 95% throws all of it away.",
      evidence: "A 120-minute 1080p source × ~10 CPU-min per video-minute ≈ 1,200 CPU-minutes. On one 32-core box that's ~40 minutes at best, and much more with AV1. Transcoders run on spot instances that get reclaimed several times a day, so long jobs restart from zero.",
      options: [
        {
          name: "Bigger transcode boxes (GPUs / hardware encoders)",
          pros: ["Faster per job", "Hardware encoders are very fast for H.264/HEVC"],
          cons: ["Still one failure domain per video", "Hardware quality per bit is worse than software at the same bitrate", "Expensive to keep idle between bursts"],
          verdict: "Useful for some rungs, but doesn't solve 'one crash restarts everything'.",
        },
        {
          name: "One task per rendition (6–8 parallel tasks per video)",
          pros: ["Easy split", "Natural parallelism"],
          cons: ["The 1080p/4K task still takes most of the time", "A crash still loses a whole rendition"],
          verdict: "Lost: parallelism is capped by the slowest rendition.",
        },
        {
          name: "Split the source into ~10 s GOP-aligned chunks; a DAG of tasks (split → chunk × rendition → package) run by an orchestrator over a work queue",
          pros: ["Parallelism = chunks × renditions (4,320 tasks for a 2-hour film)", "A crash re-runs one 10 s chunk", "Low rungs finish first, so the video can go live at 360p early", "Fits spot instances perfectly"],
          cons: ["An orchestrator to build and operate", "Chunk boundaries need care (keyframes, audio sync)", "Many small objects and task records"],
          verdict: "Chosen: it turns hours into minutes and makes failure cheap.",
          chosen: true,
        },
      ],
      decision:
        "An orchestrator consumes VideoUploaded and builds a DAG: one split task (cut the source at keyframes into ~10 s chunks), then one task per chunk × rendition, then a package task per rendition that writes the manifest. Tasks go on a work queue that workers lease. When all renditions up to 480p are packaged, the orchestrator marks the video READY (with those renditions); higher rungs are added as they finish.",
      newRisks: [
        { risk: "A duplicate task completion (lease expired, two workers finished) double-counts progress.", mitigation: "Completion is keyed by task ID, so the orchestrator's 'done' set is idempotent, and the output key is deterministic." },
        { risk: "The orchestrator itself becomes a single point of failure.", mitigation: "Its state (DAG + task table) lives in a durable store; any orchestrator instance can resume a pipeline. Workflow engines (Temporal, Step Functions) do exactly this." },
        { risk: "Audio drift or glitches at chunk boundaries.", mitigation: "Transcode audio as one task per video (it's cheap), and split video only at closed-GOP keyframes." },
      ],
      sayIt:
        "I split the source into 10-second chunks at keyframes and fan out one task per chunk per rendition through a work queue, with an orchestrator tracking the DAG. A 2-hour film becomes ~4,300 small tasks that finish in minutes, a reclaimed spot instance costs one chunk, and the low rungs go live first.",
      delta: {
        addNodes: [{ id: "orch", label: "Pipeline orchestrator", sub: "DAG: split → chunk × rendition → package", kind: "service", x: 990, y: 220 }],
        updateNodes: [{ id: "workers", label: "Transcode workers", sub: "lease chunk tasks · spot instances" }],
        removeEdges: ["queue-workers", "workers-db"],
        addEdges: [
          { id: "queue-orch", from: "queue", to: "orch", label: "consume", async: true },
          { id: "orch-workers", from: "orch", to: "workers", label: "chunk tasks (leased)", async: true },
          { id: "orch-db", from: "orch", to: "db", label: "status · renditions" },
        ],
      },
    },
    {
      version: "v5",
      title: "Serve segments from a CDN with signed URLs",
      problem: "Segments are static files, but they're still served from our origin. The required egress is three orders of magnitude beyond any data centre.",
      evidence: "17 Tbps average, ~40 Tbps peak, and ~1.4M segment requests/s. Viewers in Mumbai fetching from a US origin see 250 ms+ RTT per segment request, so start-up blows past 2 s.",
      options: [
        {
          name: "More origin servers in a few big regions",
          pros: ["Full control"],
          cons: ["Still far from most viewers", "Transit costs at 40 Tbps are enormous", "Every request hits our infrastructure"],
          verdict: "Lost: distance and bandwidth are the problem, and this fixes neither.",
        },
        {
          name: "Commercial CDN (Akamai, CloudFront, Fastly)",
          pros: ["Thousands of PoPs immediately", "Pay as you go"],
          cons: ["Per-GB pricing at this volume is huge", "Less control over cache policy"],
          verdict: "Chosen to start: it's the fastest way to get edge capacity.",
          chosen: true,
        },
        {
          name: "Own CDN with appliances inside ISP networks (Netflix Open Connect, Google Global Cache)",
          pros: ["Cheapest per bit at very large scale", "Content sits one hop from viewers"],
          cons: ["Years of ISP partnerships and hardware logistics"],
          verdict: "The end state at YouTube/Netflix scale. Mention it, but don't start here.",
        },
      ],
      decision:
        "All manifests and segments are served through a CDN with long cache lifetimes (segments are immutable). The Video API returns a manifest URL with a short-lived signed token, which the CDN validates at the edge. The origin (object storage) only sees edge cache misses.",
      newRisks: [
        { risk: "A newly viral video misses at thousands of edges at once, and every miss goes to object storage.", mitigation: "Origin shield with request coalescing (v6)." },
        { risk: "Long-tail videos have low hit ratios and cost origin egress.", mitigation: "Regional mid-tier caches; accept that the long tail is served from further away." },
        { risk: "Hot-linking and token sharing.", mitigation: "Short token lifetime, bound to the video path (and optionally IP range or session)." },
      ],
      sayIt:
        "Segments are immutable static files, so they belong on a CDN with year-long cache headers. The API hands out a signed, short-lived manifest URL, and from then on the player only talks to the edge. Our origin should only ever see cache misses.",
      delta: {
        addNodes: [{ id: "cdn", label: "CDN edge", sub: "thousands of PoPs · signed URLs", kind: "edge", x: 330, y: 0 }],
        addEdges: [
          { id: "client-cdn", from: "client", to: "cdn", label: "GET manifest / segments" },
          { id: "cdn-obj", from: "cdn", to: "obj", label: "miss → origin" },
        ],
      },
    },
    {
      version: "v6",
      title: "Origin shield with request coalescing",
      problem: "When a video goes viral, it misses at every edge at the same moment, and every edge goes to object storage independently. The origin gets a stampede for the same few segments.",
      evidence: "A trailer released at 17:00: 2,000 PoPs × first segments of 8 renditions ≈ 16K origin reads in the first second for the same handful of objects, plus every concurrent viewer at a PoP missing before the first fill completes. Origin egress spiked to 3 Tbps for ~2 minutes.",
      options: [
        {
          name: "Pre-warm the CDN for big releases",
          pros: ["Zero misses for planned launches"],
          cons: ["Only works when you know in advance", "Viral videos aren't scheduled"],
          verdict: "Worth doing for premieres, but not a general answer.",
        },
        {
          name: "Scale up origin storage throughput",
          pros: ["Simple"],
          cons: ["Pays for peak capacity that's idle 99% of the time", "Origin egress is the expensive part"],
          verdict: "Lost: it treats the symptom.",
        },
        {
          name: "A regional origin shield (mid-tier cache) between edges and storage, with request coalescing at both layers",
          pros: ["Thousands of edge misses become ~one shield miss per region", "Coalescing turns concurrent misses for the same object into one upstream fetch", "Raises effective hit ratio for the long tail"],
          cons: ["Extra hop on a miss (~10–30 ms)", "Another tier to run (or configure)"],
          verdict: "Chosen: it caps origin load by the number of shields, not the number of viewers.",
          chosen: true,
        },
      ],
      decision:
        "Edges fetch misses from a regional shield, never from storage directly. Both edge and shield coalesce concurrent requests for the same object: the first miss fetches, the rest wait on it. The player also prefetches the next segment, which smooths miss timing.",
      newRisks: [
        { risk: "The shield is now a regional dependency for all misses.", mitigation: "Multiple shield nodes per region; edges fail over to another region's shield, then to origin." },
        { risk: "Coalescing waits behind a slow upstream fetch.", mitigation: "Short coalescing timeout; after it, waiters fetch independently." },
      ],
      sayIt:
        "A viral video misses everywhere at once, so I put a regional shield between the edges and storage and coalesce concurrent misses. A million viewers asking for the same segment becomes one fetch per edge, one per shield, and one read from storage.",
      delta: {
        addNodes: [{ id: "shield", label: "Origin shield", sub: "regional mid-tier · coalesces misses", kind: "cache", x: 660, y: 0 }],
        removeEdges: ["cdn-obj"],
        addEdges: [
          { id: "cdn-shield", from: "cdn", to: "shield", label: "miss" },
          { id: "shield-obj", from: "shield", to: "obj", label: "miss → origin" },
        ],
      },
    },
    {
      version: "v7",
      title: "Metadata cache and view counting through an event stream",
      problem: "Two problems on the API side. Every video start reads the metadata DB, and every view increments the video row, so a viral video becomes a single hot row on the playback path.",
      evidence: "Peak 30K video starts/s, mostly for a few thousand videos. A video getting 5M views in an hour plus 30 s heartbeats = ~50K writes/s to one row. Row-lock contention pushed metadata p99 from 15 ms to 900 ms, which delayed playback start.",
      options: [
        {
          name: "UPDATE videos SET views = views + 1 per view",
          pros: ["Exact", "Simple"],
          cons: ["A hot row under row locks", "Couples playback latency to write contention"],
          verdict: "Lost: this is the problem.",
        },
        {
          name: "Redis INCR per view",
          pros: ["Fast", "Much higher write rate than a DB row"],
          cons: ["One hot key is still one shard", "Counts lost if a non-persistent node dies", "Doesn't help watch-time or quality analytics"],
          verdict: "Better, but still a hot key and still synchronous.",
        },
        {
          name: "Publish watch events to a stream; aggregators count in time windows and write batched increments; metadata reads served from a cache",
          pros: ["Playback never waits on a counter", "50K events/s for one video becomes one write every few seconds", "The same stream feeds analytics, quality and anti-fraud"],
          cons: ["Counts lag by seconds", "Need dedupe of retried events (session + sequence)"],
          verdict: "Chosen: view counts are analytics, so they get an analytics pipeline.",
          chosen: true,
        },
      ],
      decision:
        "A metadata cache (Redis) in front of the DB, cache-aside, with a short TTL and explicit invalidation on status change. Players post heartbeats to the API, which publishes them to a Kafka topic partitioned by video_id. Aggregators keep per-video counts in 10 s windows (deduping by session) and apply one batched increment per video per window to the metadata DB.",
      newRisks: [
        { risk: "A cache entry says PROCESSING after the video became READY.", mitigation: "The orchestrator invalidates the key on status change; the TTL is a safety net." },
        { risk: "View-count fraud (bots replaying heartbeats).", mitigation: "The same stream feeds a fraud filter; public counts are only updated from validated windows." },
        { risk: "Aggregator crash loses an in-memory window.", mitigation: "Commit Kafka offsets only after the batched write; on restart, re-aggregate from the last committed offset (dedupe by session+seq)." },
      ],
      sayIt:
        "Counting views is analytics, not playback. Heartbeats go onto a stream partitioned by video, aggregators sum them in short windows and write one batched increment, and the metadata the player needs is served from a cache. The play button never waits on a counter.",
      delta: {
        addNodes: [
          { id: "cache", label: "Metadata cache", sub: "Redis · cache-aside", kind: "cache", x: 0, y: 440 },
          { id: "events", label: "View events", sub: "Kafka · by video_id", kind: "queue", x: 660, y: 440 },
          { id: "analytics", label: "View aggregators", sub: "10 s windows · dedupe", kind: "worker", x: 660, y: 660 },
        ],
        addEdges: [
          { id: "api-cache", from: "api", to: "cache", label: "get metadata" },
          { id: "api-events", from: "api", to: "events", label: "heartbeats", async: true },
          { id: "events-analytics", from: "events", to: "analytics", label: "consume", async: true },
          { id: "analytics-db", from: "analytics", to: "db", label: "batched count += n" },
        ],
      },
    },
  ],

  // ───────────────────────────── Stage 5 — Flows ─────────────────────────────
  flows: [
    {
      id: "upload",
      name: "Uploading a video",
      kind: "write",
      summary: "From 'pick a file' to an event on the transcode queue, without a single video byte touching our API.",
      hops: [
        { from: "client", to: "api", label: "POST /uploads {size 1.2 GB}", narration: "The app asks to start an upload.", why: "A tiny metadata call. The API validates size, type and quota." },
        { from: "api", to: "db", label: "insert video (UPLOADING)", narration: "A video row is created so the ID exists from the start.", why: "The creator can add a title and thumbnail while the bytes upload." },
        { from: "api", to: "client", label: "videoId + 74 presigned part URLs", narration: "The API returns signed URLs for 16 MB parts.", why: "Signed URLs let the client write to storage without credentials, for this object only, for a limited time." },
        { from: "client", to: "obj", label: "PUT parts 1…74 (4 in parallel)", narration: "The app uploads parts directly to object storage.", why: "Parallel parts use the full uplink, and a failed part is retried alone." },
        { from: "client", to: "api", label: "POST /uploads/{id}/complete", narration: "The app reports all parts done.", why: "The API asks storage to assemble the parts into one object." },
        { from: "api", to: "db", label: "status = PROCESSING", narration: "The video moves to processing.", why: "The creator's dashboard shows progress from here." },
        { from: "api", to: "queue", label: "VideoUploaded{videoId, key}", narration: "An event goes on the transcode queue.", why: "Nobody waits for transcoding, so it's a queue.", async: true },
        { from: "api", to: "client", label: "202 Accepted", narration: "The upload is accepted.", why: "202, not 200: the work continues in the background." },
      ],
      takeaway: "The API handles three small calls. The gigabytes go straight to storage and the CPU work goes through a queue, so neither can slow the other down.",
    },
    {
      id: "transcode",
      name: "Transcoding: from one file to thousands of segments",
      kind: "write",
      summary: "A DAG of small tasks turns a 2-hour film into a playable ladder in minutes.",
      hops: [
        { from: "queue", to: "orch", label: "VideoUploaded", narration: "The orchestrator picks up the event.", why: "It owns the pipeline state for this video.", async: true },
        { from: "orch", to: "workers", label: "split task", narration: "One worker probes the file and cuts it at keyframes into 720 chunks of ~10 s.", why: "Splitting at closed-GOP keyframes means each chunk decodes on its own." },
        { from: "workers", to: "obj", label: "read original · write 720 chunks", narration: "The chunks are written to object storage.", why: "Tasks pass references to objects, never bytes." },
        { from: "orch", to: "workers", label: "720 chunks × 6 renditions = 4,320 tasks", narration: "Tasks are queued; hundreds of workers lease them in parallel.", why: "Low rungs are queued first so the video can go live early.", async: true },
        { from: "workers", to: "obj", label: "write v/{id}/{rendition}/seg_{n}.m4s", narration: "Each task writes its segments to a deterministic key.", why: "Deterministic keys make retries overwrite, never duplicate." },
        { from: "workers", to: "orch", label: "task done", narration: "Completion is reported per task.", why: "The orchestrator ticks off the DAG." },
        { from: "orch", to: "workers", label: "package 144p–480p manifests", narration: "Once the low rungs are complete, packaging tasks write their manifests.", why: "Publishing the lower rungs first gets the video watchable sooner." },
        { from: "orch", to: "db", label: "READY (144p–480p); add 720p+ later", narration: "The video goes live; higher rungs are appended as they finish.", why: "Creators can share in minutes; HD arrives shortly after." },
      ],
      takeaway: "Parallelism comes from chunks × renditions, and every task is small, idempotent and cheap to retry.",
    },
    {
      id: "watch",
      name: "Pressing play",
      kind: "read",
      summary: "One cached API call, then everything comes from the nearest edge.",
      hops: [
        { from: "client", to: "api", label: "GET /videos/v_7Kp", narration: "The player asks for the video's metadata.", why: "The only call to our API on the playback path." },
        { from: "api", to: "cache", label: "get v_7Kp", narration: "Metadata comes from the cache.", why: "Popular videos are always hot. p99 ~2 ms." },
        { from: "api", to: "client", label: "manifestUrl (signed, 6 h)", narration: "The API returns a signed CDN URL.", why: "The token stops hot-linking without any lookup at the edge." },
        { from: "client", to: "cdn", label: "GET master.m3u8", narration: "The player fetches the master manifest from the nearest PoP.", why: "Anycast/DNS routing picks a PoP a few ms away." },
        { from: "cdn", to: "client", label: "8 renditions + bandwidths", narration: "The edge returns the cached manifest.", why: "A popular manifest is always at the edge." },
        { from: "client", label: "start at 360p; buffer target 30 s", narration: "The player starts low to fill the buffer quickly.", why: "A fast first frame matters more than first-frame quality." },
        { from: "client", to: "cdn", label: "GET 360p/seg_00000.m4s …", narration: "Segments stream in; the player climbs to 1080p as throughput allows.", why: "Each segment is a separate decision, so quality tracks the network." },
      ],
      takeaway: "After one small, cached API call, playback is static files from an edge a few milliseconds away. That's how start-up stays under 2 s.",
    },
    {
      id: "abr",
      name: "Network drops mid-video (adaptive bitrate)",
      kind: "read",
      summary: "The player steps down before the buffer runs dry, then climbs back up.",
      hops: [
        { from: "client", to: "cdn", label: "GET 1080p/seg_00120 (5 Mbps)", narration: "The viewer is watching in 1080p.", why: "Measured throughput has been ~12 Mbps." },
        { from: "client", label: "throughput 12 → 1.8 Mbps; buffer 24 s → 14 s", narration: "The train enters a tunnel. Downloads slow and the buffer drains.", why: "The player sees both throughput and buffer level, which the server can't." },
        { from: "client", to: "cdn", label: "GET 480p/seg_00124 (1.2 Mbps)", narration: "The player switches down at the next segment boundary.", why: "Aligned segments mean any rendition's next segment continues seamlessly." },
        { from: "client", label: "buffer recovers to 25 s", narration: "Playback continues without a stall.", why: "Stepping down early is cheaper than a rebuffer." },
        { from: "client", to: "cdn", label: "GET 720p/seg_00140 → 1080p later", narration: "Out of the tunnel, the player climbs back, one rung at a time.", why: "Hysteresis: step down fast, step up slowly to avoid oscillation." },
      ],
      takeaway: "Adaptation lives in the player because the player knows its buffer. The server's only job is to have every rung ready at every segment boundary.",
    },
    {
      id: "views",
      name: "Counting a view",
      kind: "write",
      summary: "Heartbeats flow into a stream and become one batched write per video every few seconds.",
      hops: [
        { from: "client", to: "api", label: "POST /events heartbeat (pos 30 s)", narration: "After 30 s of playback, the player sends a heartbeat.", why: "A 'view' is defined by watch time, not a page load, which makes it harder to fake." },
        { from: "api", to: "events", label: "publish (key: videoId)", narration: "The API publishes and returns 204 immediately.", why: "Partitioning by video sends all of a video's events to one aggregator.", async: true },
        { from: "events", to: "analytics", label: "consume", narration: "An aggregator reads the partition.", why: "Consumers scale with partitions.", async: true },
        { from: "analytics", label: "window 10 s: v_7Kp +48,211 (dedupe session)", narration: "Events are counted in memory per window, dropping retried duplicates.", why: "50K events/s for one video become one number." },
        { from: "analytics", to: "db", label: "UPDATE views += 48,211", narration: "One batched write per video per window, then the offset is committed.", why: "Write after commit order: crash → re-aggregate from the last offset." },
      ],
      takeaway: "The counter is seconds behind, and that's fine. What matters is that a viral video never turns into a hot row on the playback path.",
    },
    {
      id: "viral-stampede",
      name: "Failure: a video goes viral (cache stampede)",
      kind: "failure",
      summary: "Millions of viewers request segments nobody has cached yet. Coalescing keeps the origin calm.",
      hops: [
        { from: "client", to: "cdn", label: "120K viewers/s request seg_00000 at one PoP", narration: "A creator with 50M subscribers publishes; notifications go out.", why: "Requests for the same object arrive within milliseconds of each other.", failure: true },
        { from: "cdn", label: "miss → coalesce: 1 fetch, 119,999 wait", narration: "The edge sends one upstream request and holds the rest.", why: "Without coalescing every waiting request becomes a separate miss." },
        { from: "cdn", to: "shield", label: "GET seg_00000 (from 2,000 PoPs)", narration: "Each PoP sends its single miss to its regional shield.", why: "A shield absorbs all the PoPs in a region.", failure: true },
        { from: "shield", label: "coalesce: 1 fetch per object per region", narration: "The shield also coalesces.", why: "2,000 edge misses become ~10 shield misses worldwide." },
        { from: "shield", to: "obj", label: "GET seg_00000 (×10 regions)", narration: "Storage serves a handful of reads.", why: "Origin load is bounded by the number of shields, not viewers." },
        { from: "shield", to: "cdn", label: "fill + cache (immutable, 1 y)", narration: "Edges fill and serve everyone waiting.", why: "Immutable objects never need revalidation." },
        { from: "cdn", to: "client", label: "seg_00000", narration: "Viewers get the segment after one extra round trip.", why: "The next segments are already being prefetched by early players." },
      ],
      takeaway: "Two layers of coalescing collapse millions of identical misses into a handful of origin reads. Viewer count stops mattering to the origin.",
    },
    {
      id: "worker-dies",
      name: "Failure: a transcode worker is reclaimed mid-task (duplicate processing)",
      kind: "failure",
      summary: "Spot instances disappear all the time. Leases and deterministic keys make that a non-event.",
      hops: [
        { from: "orch", to: "workers", label: "lease task (v_7Kp, chunk 311, 1080p), 5 min", narration: "A worker takes a chunk task.", why: "A lease, not an assignment: it expires on its own." },
        { from: "workers", label: "spot instance reclaimed at 80%", narration: "The cloud provider takes the machine back with 2 minutes' notice.", why: "On spot capacity, this happens many times a day across the fleet.", failure: true },
        { from: "orch", label: "lease expires → task PENDING again", narration: "No completion arrived, so the task is requeued.", why: "Time is the failure detector; no heartbeats needed." },
        { from: "orch", to: "workers", label: "re-lease to another worker", narration: "A healthy worker picks it up and re-runs 10 s of video.", why: "The cost of a crash is one chunk, not one film." },
        { from: "workers", to: "obj", label: "write v_7Kp/1080p/seg_00311 (same key)", narration: "The output overwrites whatever partial object existed.", why: "Deterministic keys make the retry idempotent." },
        { from: "workers", to: "orch", label: "task done (maybe twice)", narration: "If the first worker also finished before dying, two completions arrive.", why: "The orchestrator marks done by task ID, so the second is a no-op.", failure: true },
      ],
      takeaway: "Small tasks, leases and idempotent outputs turn worker death into a few seconds of rework. That's what makes cheap spot capacity usable.",
    },
    {
      id: "resume-upload",
      name: "Failure: upload interrupted on a mobile network",
      kind: "failure",
      summary: "The connection drops at 60%. Resumable multipart uploads mean we don't start again.",
      hops: [
        { from: "client", to: "obj", label: "PUT part 45 of 74 → connection reset", narration: "The uploader's network drops mid-part.", why: "On mobile this is normal, not exceptional.", failure: true },
        { from: "client", label: "backoff 1 s, 2 s, 4 s … network returns", narration: "The app waits with exponential backoff.", why: "Retrying instantly on a dead network wastes battery." },
        { from: "client", to: "obj", label: "list uploaded parts", narration: "The app asks storage which parts already arrived.", why: "Storage is the source of truth for progress, not the app's memory." },
        { from: "obj", to: "client", label: "parts 1–44 complete", narration: "44 parts are safely stored.", why: "Each part is durable as soon as its PUT succeeds." },
        { from: "client", to: "obj", label: "PUT parts 45…74", narration: "The upload resumes from part 45.", why: "We resend 16 MB, not 700 MB." },
        { from: "client", to: "api", label: "POST complete", narration: "Upload finishes normally.", why: "Expired part URLs are simply re-requested from the API." },
      ],
      takeaway: "Splitting a large upload into independently retried parts turns a fragile hour-long transfer into many small ones that each either succeed or retry.",
    },
    {
      id: "pop-down",
      name: "Failure: a CDN PoP goes down mid-playback (region loss)",
      kind: "failure",
      summary: "The edge serving 400K viewers disappears. The player's buffer buys time while traffic moves.",
      hops: [
        { from: "client", to: "cdn", label: "GET seg_00230 → timeout", narration: "The PoP fails (power, fibre cut, bad deploy).", why: "Viewers have 20–30 s of buffer, so nobody sees a stall yet.", failure: true },
        { from: "client", label: "retry with backoff; DNS/anycast withdraws the PoP", narration: "Routing moves users to the next-nearest PoP within seconds.", why: "Anycast route withdrawal or a low-TTL DNS change does the steering." },
        { from: "client", to: "cdn", label: "GET seg_00230 (new PoP)", narration: "The player refetches from a different edge.", why: "Segments are identical everywhere, so any PoP can serve any viewer." },
        { from: "cdn", to: "shield", label: "misses for videos the new PoP didn't have", narration: "The new PoP is colder for these viewers' videos.", why: "The shield absorbs the burst of misses.", failure: true },
        { from: "shield", to: "cdn", label: "fill", narration: "The shield serves the misses from its regional cache.", why: "The origin barely notices." },
      ],
      takeaway: "Statelessness at the edge plus a client buffer turns a PoP loss into a brief bitrate dip. The shield protects the origin from the resulting cold cache.",
    },
  ],

  // ───────────────────────────── Stage 6 — Deep dives ─────────────────────────────
  deepDives: [
    {
      id: "transcoding",
      title: "Designing the transcoding pipeline",
      question: "How do you turn 5M minutes of uploads a day into adaptive streams quickly and at a sane cost?",
      context: [
        "≈ 35K cores of continuous H.264 work, several times more for AV1.",
        "Most uploads are watched a few times; a few are watched millions of times.",
        "Spot capacity is 60–90% cheaper but can vanish at any time.",
      ],
      options: [
        {
          name: "Encode every video to every rung in every codec, up front",
          pros: ["Best quality for every viewer from minute one"],
          cons: ["Spends AV1-level CPU on videos nobody will watch", "Long time-to-publish for long videos"],
          verdict: "Lost: most of that compute is wasted on the long tail.",
        },
        {
          name: "Just-in-time transcoding at request time",
          pros: ["No wasted work"],
          cons: ["Startup latency on first view", "Burst of CPU when something goes viral", "Hard to cache"],
          verdict: "Lost for VOD. It shows up for niche cases like rare device formats.",
        },
        {
          name: "Tiered: chunk-parallel H.264 ladder for everyone on upload; re-encode in VP9/AV1 (per-title tuned) once a video crosses a popularity threshold",
          pros: ["Fast time-to-publish", "Expensive codecs only where the bandwidth savings pay for them", "Chunked tasks fit spot instances"],
          cons: ["Two pipelines (fast path + optimisation path)", "Manifests change over a video's life"],
          verdict: "Chosen: spend CPU where it saves bandwidth.",
          chosen: true,
        },
      ],
      recommendation:
        "Fast path: split at keyframes into ~10 s chunks, H.264 ladder in parallel on spot instances, publish low rungs first. Optimisation path: when views cross a threshold, re-encode with a modern codec and per-title bitrate ladder, then update the manifest. The original is kept (cold tier) so we can re-encode when codecs improve.",
      sayIt:
        "Everyone gets a fast, chunk-parallel H.264 ladder so the video is live in minutes. Only videos that actually get watched earn the expensive AV1 encode, because that's where 30% fewer bits per view pays for the CPU.",
    },
    {
      id: "cdn",
      title: "Delivery: CDN hit ratio is the cost model",
      question: "40 Tbps at peak, a long tail of rarely watched videos. How do you keep the origin load and the bill under control?",
      context: [
        "Each 1% of hit ratio is ~170 Gbps of origin egress.",
        "Popular content fits at the edge; the long tail doesn't.",
        "Segments are immutable, which is the best possible caching property.",
      ],
      options: [
        {
          name: "Single-tier CDN: edges fetch from origin on miss",
          pros: ["Simplest"],
          cons: ["Every PoP misses independently", "Long-tail hit ratio is poor", "Viral stampedes go straight to storage"],
          verdict: "Lost at this scale.",
        },
        {
          name: "Tiered caching: edge → regional shield → origin, with request coalescing and immutable cache headers",
          pros: ["Origin load bounded by shield count", "Long tail served from shields", "No invalidation needed for immutable segments"],
          cons: ["Extra hop on misses"],
          verdict: "Chosen: the standard architecture for any large VOD service.",
          chosen: true,
        },
        {
          name: "Proactive placement: push tomorrow's likely-popular content to ISP-embedded caches overnight (Netflix Open Connect)",
          pros: ["Near-100% hit ratio for the catalogue head", "Fills during off-peak hours when bandwidth is cheap"],
          cons: ["Needs popularity prediction and owned hardware in ISPs", "Works best with a curated catalogue (Netflix), less so with user uploads (YouTube)"],
          verdict: "The end state for a catalogue service. Combine with tiered pull caching for UGC.",
        },
      ],
      recommendation:
        "Edges with long TTLs on immutable segments, a regional shield tier with coalescing, and the player prefetching one segment ahead. At very large scale, add embedded ISP caches filled off-peak for predicted-popular content.",
      sayIt:
        "I treat the CDN hit ratio as the cost model. Immutable segments cache forever, a regional shield with coalescing collapses misses, and the head of the catalogue can be pre-positioned in ISPs overnight. The origin should only ever see the long tail.",
    },
    {
      id: "queue-vs-api",
      title: "Where queues belong in a video platform",
      question: "Uploads, transcoding, playback, view counts. Which of these are synchronous calls and which are queues?",
      context: [
        "The rule: if the caller is blocked on the answer, or the callee isn't ours, it's a sync call with a deadline. If work is handed to a different-speed stage, it's a queue.",
        "Video has both extremes: a 4 s segment that must arrive now, and a 10-minute transcode nobody is waiting for.",
      ],
      options: [
        {
          name: "Everything synchronous (upload → transcode → respond)",
          pros: ["Easy to trace"],
          cons: ["Requests held for minutes", "No buffering for upload bursts", "A transcoder outage fails uploads"],
          verdict: "Lost: this is v1.",
        },
        {
          name: "Everything through queues, including metadata reads and segment delivery",
          pros: ["Uniform"],
          cons: ["A queue on the playback path adds latency and solves nothing", "The player is blocked on each segment anyway"],
          verdict: "Lost: a queue only helps when nobody is waiting.",
        },
        {
          name: "Sync for the playback path and upload handshakes; queues for transcoding and analytics; bytes bypass both (direct to storage, served by CDN)",
          pros: ["Each path uses the tool that fits", "Playback has the fewest possible hops"],
          cons: ["Eventual consistency between upload complete and READY"],
          verdict: "Chosen.",
          chosen: true,
        },
      ],
      recommendation:
        "Sync with deadlines: upload init/complete, metadata reads, segment fetches (CDN → shield → origin). Queues: VideoUploaded → orchestrator, chunk tasks → workers, heartbeats → aggregators. And the bytes never go through either our API or a broker.",
      sayIt:
        "The player is blocked on every segment, so the playback path is synchronous and as short as possible: edge, shield, storage. Transcoding and view counting are work nobody waits for, so they go through queues. And video bytes never pass through the API or a broker.",
    },
  ],

  // ───────────────────────────── Stage 7 — Defend ─────────────────────────────
  tradeOffs: [
    {
      decision: "Presigned direct uploads to object storage",
      alternative: "Upload through the API servers",
      why: "Keeps 50 Gbps of long-lived transfers off the API tier and gives resumability for free.",
      whenToSwitch: "When you must inspect bytes inline (e.g. regulated content scanning before storage). Even then, use a dedicated ingest tier, not the API.",
    },
    {
      decision: "HLS/DASH with ~4 s segments",
      alternative: "Progressive MP4 download",
      why: "Lets the player adapt quality continuously and keeps everything cacheable.",
      whenToSwitch: "Short clips (< 15 s) can be a single small MP4 per rendition.",
    },
    {
      decision: "Chunk-parallel transcoding with an orchestrator",
      alternative: "One job per video",
      why: "Minutes instead of hours, and a crash costs one chunk.",
      whenToSwitch: "When videos are short (under a minute), the split/stitch overhead isn't worth it.",
    },
    {
      decision: "Tiered CDN with an origin shield",
      alternative: "Edges fetch from origin directly",
      why: "Bounds origin load by the number of shields and improves long-tail hit ratio.",
      whenToSwitch: "Small catalogues with a single region of viewers.",
    },
    {
      decision: "Approximate, stream-aggregated view counts",
      alternative: "Exact transactional counters",
      why: "Counts are analytics. Exactness on the playback path costs latency and creates hot rows.",
      whenToSwitch: "If views drive payouts, keep the stream (it's still the right source) but reconcile in a batch job before paying.",
    },
    {
      decision: "Expensive codecs only for popular videos",
      alternative: "AV1 for everything on upload",
      why: "CPU is spent where bandwidth savings repay it.",
      whenToSwitch: "When hardware AV1 encoding becomes cheap enough that the CPU cost no longer matters.",
    },
  ],

  bottlenecks: [
    { item: "Origin egress on viral launches", mitigation: "Shield tier, request coalescing at edge and shield, pre-warming for scheduled premieres." },
    { item: "Transcoding backlog during upload spikes", mitigation: "Autoscale on queue depth, priority lanes (short videos and paying creators first), spot capacity with leases." },
    { item: "Metadata hot keys for viral videos", mitigation: "Cache-aside with a local in-process L1 for the hottest keys; status invalidation from the orchestrator." },
    { item: "Storage cost growth (~1 PB/day)", mitigation: "Lifecycle tiers: originals to archive, cold renditions to infrequent-access; drop unused rungs for never-watched videos." },
    { item: "Small-object overhead (thousands of segments per video)", mitigation: "Byte-range addressing into one file per rendition (single-file CMAF) where the CDN supports it." },
    { item: "Long-tail start-up latency (cold at edge and shield)", mitigation: "Small first segment at low bitrate; fetch the first segments of every rendition in the shield on first play." },
  ],

  followUps: [
    {
      question: "How would you add live streaming?",
      answer: [
        "Ingest via RTMP/SRT to regional ingest servers, transcode in real time (one encoder per stream, all rungs at once), and package segments of 1–2 s as they're produced.",
        "Manifests update continuously; low-latency HLS/DASH use partial segments and chunked transfer to reach ~2–5 s glass-to-glass.",
        "The CDN design stays the same, but manifest TTLs drop to about a segment duration, and coalescing matters even more because every viewer wants the same newest segment.",
      ],
    },
    {
      question: "How do you handle copyright and content moderation?",
      answer: [
        "Add a fingerprinting/moderation stage to the pipeline DAG (audio and video fingerprints against a reference database), running in parallel with transcoding.",
        "The video can stay in PROCESSING (or go live as private) until checks pass, depending on policy.",
        "Takedowns flip the status to BLOCKED, invalidate the metadata cache, and the signed-URL check stops new playback immediately. Already cached segments are unreachable without a valid manifest token.",
      ],
    },
    {
      question: "How would you make start-up faster?",
      answer: [
        "Return the manifest inline in the metadata response, so the player saves a round trip.",
        "Start at a low rung with a short first segment, and prefetch the first segment of the next likely video (autoplay).",
        "Use HTTP/3 (QUIC) to the edge, which saves handshake round trips and handles mobile network changes better.",
      ],
    },
    {
      question: "How would you serve viewers in a region where our CDN is weak?",
      answer: [
        "Multi-CDN: steer each viewer to the CDN with the best measured performance in their network (client-side or DNS-based steering using real user measurements).",
        "The player can switch CDN mid-session on errors, since segments are identical across CDNs.",
      ],
    },
  ],

  mistakes: [
    "Routing upload bytes through the API servers.",
    "Transcoding synchronously inside the upload request.",
    "Serving one MP4 per resolution and calling it 'adaptive'.",
    "Forgetting the CDN, or drawing it without saying what it caches and for how long.",
    "Incrementing a view counter row on every view.",
    "Treating transcoding as one big job per video, so long videos take hours and crashes restart from zero.",
    "Not keeping the original upload, which makes future re-encodes impossible.",
  ],

  redFlags: [
    "Serving video from the application servers.",
    "A synchronous 'upload → transcode → 200 OK' flow.",
    "No answer for what happens when a video goes viral (stampede on origin).",
    "Exact, transactional view counts on the playback path.",
    "Ignoring storage growth (~1 PB/day) and cost tiers.",
  ],
};
