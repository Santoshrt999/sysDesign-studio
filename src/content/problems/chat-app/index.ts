import type { Problem } from "../../types";

/**
 * Chat App (WhatsApp / Messenger-style)
 *
 * Narrative spine: chat is a ROUTING problem on top of a STORAGE problem.
 *  - 200M phones hold open connections to stateful gateways -> someone must know which gateway holds Bob
 *  - "sent ✓" must mean "durably stored"                     -> persist first, assign a per-conversation sequence, then deliver
 *  - delivery is a hint, the store is the truth              -> at-least-once push, client dedupes by (conversation, seq), sync on reconnect
 *  - recipients are often offline or slow                     -> a queue between "accepted" and "delivered", plus mobile push
 *  - groups multiply every message                            -> store once, fan out deliveries
 *  - presence and typing are ephemeral                        -> separate, lossy path that never touches the message store
 * The send path is synchronous up to "stored" (the sender is waiting for ✓). Everything after that is asynchronous.
 */
export const chatApp: Problem = {
  slug: "chat-app",
  title: "Chat App",
  tagline: "Persistent connections, per-conversation ordering, offline delivery and group fan-out",
  difficulty: "Hard",

  overview: {
    whatItIs:
      "A chat app lets people send messages to each other, one-to-one or in groups, and have them arrive within a second if the other person is online, or as soon as they come back if not. Behind it are millions of open connections, a store that keeps every conversation in order, and a delivery system that keeps retrying until each phone has the message.",
    whatItDoes: [
      "Keeps a live connection to every online device so messages arrive instantly.",
      "Stores each message durably, in order, before saying 'sent'.",
      "Delivers to every device of every recipient, including ones that are offline right now.",
      "Shows delivery and read receipts (✓, ✓✓, blue ticks).",
      "Shows who's online and who's typing.",
    ],
    whereUsed: [
      "WhatsApp, Messenger, Signal, Telegram, iMessage",
      "Workplace chat: Slack, Teams, Discord",
      "In-app chat: ride-hailing driver ↔ rider, marketplaces, customer support",
      "Multiplayer game lobbies and live-stream chat",
    ],
    coreIdea:
      "A message is only 'sent' once it is stored in its conversation's ordered log. Delivery to devices is a best-effort push on top, and every device can always catch up by asking for 'everything after the last sequence number I saw'. That one idea makes crashes, reconnects and duplicates all recoverable.",
    notToBeConfusedWith: [
      { term: "Email", difference: "Email is store-and-forward between independent servers with minutes of latency. Chat holds a live connection and targets sub-second delivery." },
      { term: "Notification system", difference: "Push notifications (APNs/FCM) are a delivery channel chat uses to wake a phone. They're lossy and unordered, so they can't be the chat itself." },
      { term: "Pub/sub broker", difference: "Chat uses queues internally, but it needs per-conversation ordering, history, receipts and multi-device sync, none of which a broker provides." },
    ],
  },

  // ───────────────────────────── Stage 1 — Understand ─────────────────────────────
  interviewQuestion:
    "Design a chat application like WhatsApp. It should support one-to-one and group messaging, show delivery and read receipts, handle users who are offline, and scale to hundreds of millions of daily users.",

  clarifyingQuestions: [
    {
      question: "One-to-one only, or groups too? How large can a group be?",
      whyItMatters: "Group size sets the fan-out multiplier and decides whether we copy messages per recipient or store once.",
      answer: "Both. Groups up to 1,024 members. Broadcast channels with millions of followers are out of scope.",
      designImpact: "Store each message once per conversation and fan out deliveries. 1,024 is small enough to fan out on write; channels would need fan-out on read.",
    },
    {
      question: "How many users and messages?",
      whyItMatters: "It sets connection count, message throughput and storage.",
      answer: "500M daily active users, about 40 messages each per day. Peak concurrency around 200M connected devices.",
      designImpact: "≈ 230K messages/s average, ~700K/s at peak, and 200M persistent connections, so a fleet of stateful gateways.",
    },
    {
      question: "Do we keep message history on the server? Multiple devices per user?",
      whyItMatters:
        "WhatsApp historically deleted messages once delivered. Messenger and Slack keep history so new devices can sync. That changes storage by orders of magnitude.",
      answer: "Yes: phone plus up to 4 linked devices (web, desktop). Keep history server-side so a new device can sync recent conversations.",
      designImpact: "A durable, ordered message store per conversation, and a per-device cursor (last seen sequence).",
    },
    {
      question: "What ordering and delivery guarantees do we need?",
      whyItMatters: "'Exactly once, in order' sounds obvious but is expensive. We need to know what users actually notice.",
      answer: "Every message is delivered (no loss). Within a conversation, everyone sees the same order. Duplicates must never be shown.",
      designImpact:
        "At-least-once delivery with client-side dedupe, plus a per-conversation sequence number. No global ordering across conversations.",
    },
    {
      question: "What latency target?",
      whyItMatters: "It decides whether we can poll or need persistent connections.",
      answer: "Under 500 ms from send to delivered when both users are online in the same region.",
      designImpact: "Persistent connections (WebSocket or MQTT-style over TCP/TLS); polling can't meet it at this scale.",
    },
    {
      question: "Are messages end-to-end encrypted?",
      whyItMatters: "If the server can't read messages, it can't search them, scan them or rank them, and group key management becomes the client's job.",
      answer: "Yes, E2E encrypted. The server routes and stores ciphertext.",
      designImpact: "Server-side features operate on metadata only. Media is encrypted on the device before upload.",
    },
    {
      question: "Do we need online/last-seen and typing indicators?",
      whyItMatters: "They look small but generate more events than messages do.",
      answer: "Yes, both, best-effort.",
      designImpact: "A separate ephemeral presence path; losing a typing event is fine, losing a message isn't.",
    },
  ],

  requirements: {
    functional: [
      "Send and receive one-to-one and group messages (text, plus media by reference).",
      "Delivery and read receipts.",
      "Offline delivery: messages wait and are pushed when the recipient returns; mobile push wakes the app.",
      "Multi-device: all of a user's devices receive and sync the same history.",
      "Presence (online / last seen) and typing indicators.",
    ],
    nonFunctional: [
      { name: "Latency", target: "< 500 ms send → delivered (both online, same region)", why: "Chat feels broken above about a second." },
      { name: "Durability", target: "No acknowledged message is ever lost", why: "'Sent ✓' is a promise." },
      { name: "Ordering", target: "Same order for every participant within a conversation", why: "Out-of-order replies make conversations unreadable." },
      { name: "No duplicates", target: "A message is shown at most once per device", why: "Retries are inevitable on mobile; users must not see them." },
      { name: "Scale", target: "200M concurrent connections, ~700K msgs/s peak", why: "500M DAU with evening and New Year peaks." },
      { name: "Availability", target: "99.99% for send/receive", why: "It's a primary communication channel for many people." },
    ],
    outOfScope: [
      "Voice and video calls",
      "Broadcast channels with millions of members",
      "Search over message content (E2E-encrypted)",
      "Spam and abuse detection (mentioned in follow-ups)",
    ],
  },

  // ───────────────────────────── Stage 2 — Size ─────────────────────────────
  estimates: [
    {
      title: "Message throughput",
      reasoning: [
        "500M DAU × 40 messages/day = 20B messages/day",
        "20B ÷ 86,400 s ≈ 230K messages/s average",
        "Evening peak ~3× ≈ 700K/s; New Year's Eve spikes to 5–10× for a few minutes",
      ],
      result: "≈ 230K msgs/s average, ~700K/s peak, short spikes beyond 1M/s",
      soWhat:
        "Sequence assignment and persistence must be partitioned (by conversation). No single leader or table can sequence 700K writes/s.",
    },
    {
      title: "Persistent connections",
      reasoning: [
        "Peak ~200M connected devices",
        "A tuned gateway (epoll/Netty or Erlang) holds ~500K idle TLS connections at ~10 KB each ≈ 5 GB RAM",
        "200M ÷ 500K = 400 gateways; ×2 headroom for failover and deploys ≈ 800",
      ],
      result: "≈ 800 stateful gateway servers",
      soWhat:
        "Gateways are stateful (they hold sockets), so we need a registry of who is connected where, and a plan for when a gateway with 500K users dies.",
    },
    {
      title: "Delivery fan-out",
      reasoning: [
        "70% of messages are 1:1 (1 recipient); 30% are group messages with ~30 members (29 recipients)",
        "Recipients per message ≈ 0.7 × 1 + 0.3 × 29 ≈ 9.4",
        "~1.5 devices per user → ≈ 14 device deliveries per message",
        "230K × 14 ≈ 3.2M device deliveries/s average",
      ],
      result: "≈ 3M deliveries/s, ~14× the send rate",
      soWhat:
        "Fan-out, not sending, is the real load. Store a message once per conversation and fan out lightweight deliveries; never copy the message body per recipient.",
    },
    {
      title: "Storage",
      reasoning: [
        "Average message ≈ 300 B (ciphertext + IDs + timestamps)",
        "20B × 300 B = 6 TB/day ≈ 2.2 PB/year, ×3 replication ≈ 6.6 PB/year",
      ],
      result: "≈ 6 TB/day, a few PB/year",
      soWhat:
        "Write-heavy, append-only, read by recent range: a wide-column store (Cassandra/ScyllaDB/HBase) partitioned by conversation, clustered by sequence. Media lives elsewhere.",
    },
    {
      title: "Presence events",
      reasoning: [
        "Naive: every device heartbeats every 30 s and writes last_seen → 200M ÷ 30 ≈ 6.7M writes/s",
        "Naive broadcast: each online/offline change sent to ~200 contacts × ~5 changes/day/user → 500B events/day",
      ],
      result: "Naive presence costs more than messaging itself",
      soWhat:
        "Presence comes from connection open/close at the gateway (not heartbeats to a DB), lives in an in-memory TTL store, and is only pushed to people who currently have that chat open.",
    },
    {
      title: "Media",
      reasoning: [
        "~10% of messages carry media: 23K/s; average ~500 KB (photos ~200 KB, videos MBs)",
        "23K × 500 KB ≈ 11.5 GB/s ≈ 92 Gbps",
      ],
      result: "≈ 90 Gbps of media vs ~0.5 Gbps of text",
      soWhat:
        "Media is 99% of bytes. It must go out-of-band to blob storage + CDN, with the chat message carrying only a reference and decryption key.",
    },
  ],

  // ───────────────────────────── Stage 3 — Start simple ─────────────────────────────
  api: [
    {
      method: "WS",
      path: "wss://chat.example.com/connect (auth token, deviceId, lastSeq per conversation)",
      response: "Connection established; server pushes any missed messages",
      notes: "One long-lived connection per device. All real-time traffic (messages, receipts, typing) is framed messages on it.",
    },
    {
      method: "frame",
      path: "→ send { clientMsgId, conversationId, ciphertext, mediaRef? }",
      response: "← ack { clientMsgId, seq, serverTs }   (sent ✓)",
      notes: "clientMsgId is a UUID generated on the device: retries reuse it so the server can dedupe. The ack means 'durably stored with this sequence number'.",
    },
    {
      method: "frame",
      path: "← message { conversationId, seq, senderId, ciphertext }  /  → delivered { conversationId, seq }",
      response: "(no reply)",
      notes: "Pushed to every recipient device. The device acks delivery, which becomes ✓✓ for the sender. Devices dedupe on (conversationId, seq).",
    },
    {
      method: "GET",
      path: "/v1/conversations/{id}/messages?afterSeq=8790&limit=200",
      response: '{ "messages": [...], "nextAfterSeq": 8990 }',
      notes: "Sync / catch-up. Used on reconnect and by new devices. The store is the source of truth; pushes are just a fast path.",
    },
    {
      method: "POST",
      path: "/v1/media",
      response: '{ "mediaId": "m_31", "uploadUrl": "https://blob…?sig=…" }',
      notes: "The device encrypts the file, uploads it directly to blob storage, then sends a normal message containing mediaId and the key.",
    },
    {
      method: "frame",
      path: "→ typing { conversationId } · ← presence { userId, online, lastSeen }",
      response: "(no reply, best effort)",
      notes: "Ephemeral. Never persisted, never retried.",
    },
  ],

  communication: {
    rule:
      "The sender is blocked until its message is durably stored, so the send path is synchronous up to 'stored + sequence assigned'. After that nobody is waiting, so delivery goes through a queue and is retried until each device acks. Calls to things we don't own (APNs/FCM) are made by a separate worker with deadlines. Presence and typing are fire-and-forget.",
    choices: [
      {
        interaction: "Device ↔ gateway",
        style: "hybrid",
        why: "A persistent, bidirectional connection (WebSocket/MQTT over TLS). Sends are request/ack over it; incoming messages are server pushes. It's neither a REST call nor a queue.",
        ifWrong: "HTTP polling at 200M devices means millions of empty requests per second and seconds of latency. Long-polling helps but still reconnects per message.",
      },
      {
        interaction: "Gateway → message service: 'store this message'",
        style: "sync-api",
        why: "The sender is waiting for ✓. The gateway calls the conversation's partition leader synchronously (with a deadline), which assigns a sequence and persists.",
        ifWrong: "Putting the send on a queue and acking immediately means ✓ before the message is stored. A broker crash then loses a message the user saw as sent.",
      },
      {
        interaction: "Message service → delivery (to recipients)",
        style: "async-queue",
        why: "Nobody is blocked on delivery, recipients are often offline or slow, and group messages fan out ×30. A queue partitioned by conversation buffers bursts and retries until delivered.",
        ifWrong: "Synchronous delivery inside the send call makes the sender's ✓ wait on the slowest recipient's gateway, and a single offline member stalls a group send.",
      },
      {
        interaction: "Delivery worker → recipient's gateway",
        style: "sync-api",
        why: "A direct RPC to the gateway holding the socket (found via the session registry), with a short deadline. On failure, the delivery isn't acked and is retried from the queue.",
        ifWrong: "Broadcasting every message to all 800 gateways (pub/sub) multiplies traffic by 800 to find the one that holds Bob.",
      },
      {
        interaction: "Delivery worker → APNs / FCM (offline devices)",
        style: "async-queue",
        why: "Third-party, rate-limited and slow (100 ms to seconds). A separate push worker consumes notification jobs and calls them with timeouts and backoff.",
        ifWrong: "Calling APNs inline from the delivery path couples our latency to Apple's and stalls online deliveries behind offline ones.",
      },
      {
        interaction: "Presence and typing",
        style: "async-queue",
        why: "Fire-and-forget events from gateways to an in-memory presence service, pushed only to subscribers. Loss is acceptable.",
        ifWrong: "Treating typing events like messages (durable, ordered, acked) costs more than all the real messages combined.",
      },
    ],
  },

  dataModel: [
    {
      entity: "message (message store, e.g. Cassandra)",
      fields: [
        { name: "conversation_id", type: "UUID", note: "partition key (plus a time bucket for very long conversations)" },
        { name: "seq", type: "BIGINT", note: "clustering key; assigned by the conversation's partition leader" },
        { name: "sender_id / sender_device", type: "BIGINT / STRING" },
        { name: "client_msg_id", type: "UUID", note: "dedupe key for sender retries" },
        { name: "ciphertext", type: "BLOB", note: "E2E encrypted payload" },
        { name: "media_ref", type: "STRING?", note: "blob ID; key travels inside the ciphertext" },
        { name: "server_ts", type: "TIMESTAMP" },
      ],
      accessPatterns: [
        "Append (~700K/s at peak)",
        "Range read: conversation_id, seq > N, LIMIT 200 (sync / scroll back)",
        "Lookup by (conversation_id, client_msg_id) for dedupe (small recent window, cached)",
      ],
      insight:
        "Partitioning by conversation keeps a conversation's messages together and makes 'everything after seq N' a single sequential read. Ordering only has to hold within a partition, so no global sequencer exists.",
    },
    {
      entity: "device_cursor / receipts",
      fields: [
        { name: "user_id + device_id + conversation_id", type: "KEY" },
        { name: "delivered_seq", type: "BIGINT", note: "highest contiguous seq delivered to this device" },
        { name: "read_seq", type: "BIGINT", note: "highest seq the user has read (drives blue ticks)" },
      ],
      accessPatterns: ["Update on each delivery/read ack (batched)", "Read on reconnect: 'what am I missing?'"],
      insight:
        "Receipts are a cursor per device, not a flag per message. One number replaces thousands of per-message rows.",
    },
    {
      entity: "session registry (Redis, in-memory)",
      fields: [
        { name: "user_id", type: "KEY" },
        { name: "devices", type: "MAP device_id → (gateway_id, conn_epoch)", note: "TTL refreshed by the gateway" },
      ],
      accessPatterns: ["Set on connect, delete on disconnect", "Batch lookup by delivery workers (millions/s)"],
      insight:
        "This is the routing table for 200M sockets. It's soft state: if it's lost, gateways re-register their connections within seconds.",
    },
    {
      entity: "conversation / group membership",
      fields: [
        { name: "conversation_id", type: "UUID" },
        { name: "type", type: "ENUM(DIRECT, GROUP)" },
        { name: "members", type: "SET user_id", note: "≤ 1,024; cached by the group service" },
        { name: "member_version", type: "INT", note: "bumped on join/leave; clients use it to rotate group keys" },
      ],
      accessPatterns: ["Read members per group message (cached)", "Update on join/leave (rare)"],
      insight: "Membership is read on every group message and changes rarely, so it's a perfect cache candidate.",
    },
  ],

  v1: {
    title: "v1: one chat server holding every socket",
    description: [
      "A single server accepts WebSocket connections and keeps a map userId → socket in memory.",
      "When Alice sends, the server writes the message to a database table and, if Bob's socket is in the map, writes it to Bob's socket.",
      "When Bob connects later, the server reads his unread messages from the table.",
      "It works for a few thousand users and is exactly how most chat tutorials start.",
    ],
    diagram: {
      nodes: [
        { id: "clientA", label: "Sender (Alice)", sub: "phone", kind: "client", x: 0, y: 0 },
        { id: "clientB", label: "Recipient (Bob)", sub: "phone + web", kind: "client", x: 0, y: 440 },
        { id: "gw", label: "Chat server", sub: "sockets map in RAM", kind: "service", x: 330, y: 220 },
        { id: "store", label: "Messages DB", sub: "single SQL table", kind: "db", x: 990, y: 0 },
      ],
      edges: [
        { id: "clientA-gw", from: "clientA", to: "gw", label: "WebSocket" },
        { id: "clientB-gw", from: "clientB", to: "gw", label: "WebSocket" },
        { id: "gw-store", from: "gw", to: "store", label: "insert / unread" },
      ],
    },
    whatBreaksFirst: [
      "Connections: one box holds ~500K sockets at most. We need 200M.",
      "The socket map lives in one process: a restart drops every user and the routing table with it.",
      "No ordering guarantee: two group members sending at the same moment can be written in one order and delivered in another.",
      "The SQL table takes ~700K inserts/s at peak, which one database can't do.",
    ],
  },

  // ───────────────────────────── Stage 4 — Evolve ─────────────────────────────
  evolution: [
    {
      version: "v2",
      title: "A fleet of gateways and a session registry",
      problem: "We need ~800 gateways to hold 200M sockets. Alice's socket is on gateway 17 and Bob's on gateway 342. How does a message find Bob?",
      evidence: "200M peak connections ÷ 500K per box = 400 boxes minimum. With random load balancing, the chance that sender and recipient share a gateway is ~1/400.",
      options: [
        {
          name: "Broadcast every message to all gateways (pub/sub); the one holding Bob delivers",
          pros: ["No registry", "Simple"],
          cons: ["Every gateway receives every message: 700K/s × 800 gateways = 560M msgs/s of internal traffic", "Grows quadratically with the fleet"],
          verdict: "Lost: it scales with the number of gateways, which is the thing growing.",
        },
        {
          name: "Sticky routing: hash(userId) decides the gateway; the load balancer routes by user",
          pros: ["No lookup: the gateway is computable"],
          cons: ["Adding or losing a gateway reshuffles users, forcing mass reconnects", "Multi-device users still need all devices on one box", "Hot users can't be moved"],
          verdict: "Lost: it ties routing to fleet membership, which changes with every deploy.",
        },
        {
          name: "Any gateway accepts any connection; a session registry maps user → device → gateway",
          pros: ["Gateways can be added, drained and replaced freely", "One lookup finds all of a user's devices", "Soft state: rebuilt from reconnects if lost"],
          cons: ["An extra lookup per delivery (cached, batched)", "Registry can briefly be stale after a gateway dies"],
          verdict: "Chosen: it separates 'who holds the socket' from 'how sockets are spread'.",
          chosen: true,
        },
      ],
      decision:
        "An L4 load balancer spreads connections across stateless-to-route, stateful-to-run gateways. On connect, a gateway writes userId/deviceId → (gatewayId, connEpoch) to a Redis-based session registry with a TTL it refreshes. To deliver, the sending side looks up the recipient's devices and forwards to their gateways over internal RPC.",
      newRisks: [
        { risk: "The gateway holding Bob dies; the registry still points at it for up to a TTL.", mitigation: "Deliveries to a dead gateway fail fast and are retried; Bob's reconnect overwrites the entry with a higher epoch." },
        { risk: "Messages are still only in memory between gateways, so a crash mid-forward loses them.", mitigation: "Persist before delivering: that's v3." },
      ],
      sayIt:
        "Gateways are stateful because they hold sockets, so I keep routing separate: any gateway accepts any device, and a session registry maps user and device to gateway. Delivery is one lookup plus an RPC to the right gateway, and the fleet can grow or roll without moving anyone.",
      delta: {
        addNodes: [{ id: "sessions", label: "Session registry", sub: "user → device → gateway · Redis", kind: "infra", x: 660, y: 220 }],
        updateNodes: [{ id: "gw", label: "Chat gateways", sub: "WebSocket · ~500K conns each × 800" }],
        addEdges: [{ id: "gw-sessions", from: "gw", to: "sessions", label: "register / lookup" }],
      },
    },
    {
      version: "v3",
      title: "Persist first: a message service with per-conversation sequence numbers",
      problem: "Gateways forward messages in memory, so ✓ means nothing. A crash loses messages, retries create duplicates, and group members see messages in different orders.",
      evidence: "In a test group of 50 members, two people sending within 20 ms of each other produced different orderings on 14% of devices. Killing a gateway during a load test lost ~0.3% of in-flight messages while senders saw them as sent.",
      options: [
        {
          name: "Order by client timestamp",
          pros: ["No coordination"],
          cons: ["Device clocks are wrong by seconds or minutes", "Two devices can produce the same timestamp", "Ordering differs per recipient depending on arrival"],
          verdict: "Lost: client clocks can't be trusted for ordering.",
        },
        {
          name: "One global sequencer for all messages",
          pros: ["Total order everywhere"],
          cons: ["700K/s through one leader", "Single point of failure", "Global order is stronger than anyone needs"],
          verdict: "Lost: nobody needs to know whether a message in one chat came before a message in another.",
        },
        {
          name: "Partition by conversation; the partition leader assigns a monotonic seq, persists, then acks",
          pros: ["Ordering where it matters, scale everywhere else", "✓ means durably stored", "Sync becomes 'give me seq > N'", "clientMsgId makes retries idempotent"],
          cons: ["A very hot conversation is bounded by one partition leader", "Leader failover needs fencing to avoid duplicate sequence numbers"],
          verdict: "Chosen: per-conversation order is the guarantee users actually perceive.",
          chosen: true,
        },
      ],
      decision:
        "Gateways forward sends to a message service partitioned by conversation_id. The partition leader checks clientMsgId for duplicates, assigns the next seq, writes to a wide-column store (partition = conversation, clustering = seq) at quorum, and only then returns ack {seq} to the sender's gateway (✓). Delivery starts after the write.",
      newRisks: [
        { risk: "Synchronous delivery after persist still makes the message service wait on slow or offline recipients.", mitigation: "Hand delivery to a queue (v4)." },
        { risk: "Leader failover could reuse a sequence number.", mitigation: "Leaders hold a lease with an epoch; writes are conditional on the epoch (fencing), so a deposed leader's writes are rejected." },
        { risk: "A huge group conversation saturates its partition.", mitigation: "Groups are capped at 1,024; channels (millions) are a different, fan-out-on-read design." },
      ],
      sayIt:
        "'Sent' has to mean 'stored'. Sends go to a message service partitioned by conversation: the leader dedupes on the client message ID, assigns the next sequence number, writes it, and only then sends ✓. Ordering is per conversation, which is the only order users can see.",
      delta: {
        addNodes: [{ id: "msgsvc", label: "Message service", sub: "partitioned by conversation · assigns seq", kind: "service", x: 660, y: 0 }],
        updateNodes: [{ id: "store", label: "Message store", sub: "Cassandra · conv_id, seq" }],
        removeEdges: ["gw-store"],
        addEdges: [
          { id: "gw-msgsvc", from: "gw", to: "msgsvc", label: "send / sync" },
          { id: "msgsvc-store", from: "msgsvc", to: "store", label: "append (quorum)" },
        ],
      },
    },
    {
      version: "v4",
      title: "Asynchronous delivery through a queue, with push for offline devices",
      problem: "After persisting, the message service delivers synchronously. Slow gateways and offline recipients hold up the send path, and offline users only get messages when they happen to open the app.",
      evidence: "At any moment ~40% of recipients' devices are offline. APNs/FCM calls take 100 ms to several seconds. With inline delivery, send p99 went from 120 ms to 2.4 s during an APNs slowdown.",
      options: [
        {
          name: "Deliver inline, but in parallel with timeouts",
          pros: ["Fewer components"],
          cons: ["The send path still waits for the slowest recipient (or a timeout)", "Retries for failed deliveries have nowhere durable to live"],
          verdict: "Lost: delivery and acceptance are different jobs with different speeds.",
        },
        {
          name: "Copy the message into a per-recipient inbox table, and let devices poll their inbox",
          pros: ["Simple offline semantics"],
          cons: ["Copies the body per recipient (×14 writes)", "Polling adds latency and load"],
          verdict: "Lost: duplicates storage, and the store per conversation already gives catch-up.",
        },
        {
          name: "Publish 'MessageStored' to a delivery queue (partitioned by conversation); delivery workers look up sessions, push to gateways, and hand offline devices to a push-notification worker",
          pros: ["Send path ends at 'stored'", "Queue absorbs spikes and retries until delivered", "Offline devices get a wake-up push, then sync from the store", "Partitioning by conversation keeps deliveries in order"],
          cons: ["At-least-once delivery means duplicates (clients dedupe by seq)", "Another system to run"],
          verdict: "Chosen: acceptance is synchronous, delivery is asynchronous, and the store is the truth.",
          chosen: true,
        },
      ],
      decision:
        "After a successful write, the message service publishes MessageStored{conv, seq} to a Kafka topic partitioned by conversation_id. Delivery workers consume, look up each recipient device in the session registry, and push to the device's gateway. Offline devices get a job for the push worker, which calls APNs/FCM with a 'you have new messages' notification (no plaintext). On reconnect, every device syncs 'seq > my cursor' from the store.",
      newRisks: [
        { risk: "Duplicate deliveries after retries.", mitigation: "Devices dedupe on (conversation_id, seq) and only advance their cursor contiguously." },
        { risk: "Publish fails after the write succeeded, so a stored message is never delivered.", mitigation: "Transactional outbox (or a change stream from the store). Even if delivery is missed, the next sync picks it up." },
        { risk: "APNs/FCM throttle us during spikes.", mitigation: "Collapse notifications per conversation ('5 new messages') and respect provider rate limits with backoff." },
      ],
      sayIt:
        "The sender waits only for 'stored'. After that a MessageStored event goes onto a queue, delivery workers find the recipient's gateways and push, and offline devices get a mobile push that just says 'come and sync'. Delivery is a fast path, and the store is the truth, so a missed push is never a lost message.",
      delta: {
        addNodes: [
          { id: "deliveryq", label: "Delivery queue", sub: "Kafka · by conversation", kind: "queue", x: 990, y: 220 },
          { id: "workers", label: "Delivery workers", sub: "lookup + push to gateway", kind: "worker", x: 660, y: 440 },
          { id: "push", label: "Push worker", sub: "rate-limited · collapses", kind: "worker", x: 330, y: 660 },
          { id: "apns", label: "APNs / FCM", sub: "third-party push", kind: "edge", x: 0, y: 660 },
        ],
        addEdges: [
          { id: "msgsvc-deliveryq", from: "msgsvc", to: "deliveryq", label: "MessageStored", async: true },
          { id: "deliveryq-workers", from: "deliveryq", to: "workers", label: "consume", async: true },
          { id: "workers-sessions", from: "workers", to: "sessions", label: "where are devices?" },
          { id: "workers-gw", from: "workers", to: "gw", label: "deliver" },
          { id: "workers-push", from: "workers", to: "push", label: "offline devices", async: true },
          { id: "push-apns", from: "push", to: "apns", label: "notify" },
          { id: "apns-clientB", from: "apns", to: "clientB", label: "wake app" },
        ],
      },
    },
    {
      version: "v5",
      title: "Group messaging: store once, fan out deliveries",
      problem: "A group message must reach up to 1,024 members on all their devices. Fan-out is ~14× the send rate and dominates the system's load.",
      evidence: "≈ 3M device deliveries/s on average. A single 1,024-member group message is ~1,500 device deliveries. Copying the message body per recipient would be 14× the storage (≈ 84 TB/day instead of 6).",
      options: [
        {
          name: "Fan-out on write: copy the message into each member's inbox",
          pros: ["Each user's inbox is one simple read", "Natural per-user ordering"],
          cons: ["Storage × group size", "A 1,024-member message is 1,024 writes before anyone sees it", "Edits/deletes must touch every copy"],
          verdict: "Lost: it multiplies the most expensive thing (writes of message bodies).",
        },
        {
          name: "Fan-out on read: members pull new messages from each of their groups",
          pros: ["One write per message"],
          cons: ["Every device must poll every group it's in", "No real-time push"],
          verdict: "Lost for chat. Right for million-member broadcast channels.",
        },
        {
          name: "Store once per conversation; delivery workers expand membership and push a lightweight delivery to each online device",
          pros: ["One write of the body", "Fan-out is cheap pushes, not storage writes", "Offline members catch up from the same conversation log"],
          cons: ["Delivery workers do group lookups (cached)", "Very large groups produce bursts of pushes"],
          verdict: "Chosen: fan-out the notification, not the data.",
          chosen: true,
        },
      ],
      decision:
        "A group service owns membership (cached in memory by delivery workers, versioned). For each MessageStored on a group conversation, a delivery worker fetches members, batch-looks-up their devices in the session registry, groups devices by gateway, and sends one batched RPC per gateway. Offline devices go to the push worker, collapsed per conversation.",
      newRisks: [
        { risk: "Membership changes race with sends (someone added during a message).", mitigation: "Each message records the member_version it was sent under; E2E sender keys are rotated on membership change." },
        { risk: "Bursty fan-out from big, active groups.", mitigation: "Batch per gateway, and rate-limit large groups so one busy group can't starve the delivery fleet." },
      ],
      sayIt:
        "For groups I store the message once in the conversation log and fan out deliveries, not copies. Workers expand the member list, batch-look-up devices, and send one RPC per gateway. Offline members read the same log when they reconnect.",
      delta: {
        addNodes: [{ id: "groups", label: "Group service", sub: "membership · versioned · cached", kind: "service", x: 990, y: 440 }],
        addEdges: [{ id: "workers-groups", from: "workers", to: "groups", label: "members(G)" }],
      },
    },
    {
      version: "v6",
      title: "Presence and typing on a separate, ephemeral path",
      problem: "Online status, last-seen and typing indicators generate more events than messages, and naive implementations write them to databases and broadcast them to every contact.",
      evidence: "Heartbeat writes: 200M devices ÷ 30 s ≈ 6.7M writes/s. Broadcasting every online/offline change to ~200 contacts ≈ 500B events/day, most to people who aren't looking.",
      options: [
        {
          name: "Write last_seen to the user table on each heartbeat; contacts poll it",
          pros: ["Simple"],
          cons: ["6.7M writes/s of data nobody needs durably", "Polling load from every open chat"],
          verdict: "Lost: durable storage for data that's stale in 30 seconds.",
        },
        {
          name: "Broadcast presence changes to all contacts",
          pros: ["Always up to date"],
          cons: ["Most contacts aren't looking", "Flapping mobile connections create storms of on/off events"],
          verdict: "Lost: cost scales with contact count, not with what's on screen.",
        },
        {
          name: "Presence derived from gateway connect/disconnect into an in-memory TTL store; push changes only to subscribers (people with that chat open); debounce flapping",
          pros: ["No heartbeat writes: the gateway already knows who's connected", "Traffic proportional to open chat screens", "Loss is harmless"],
          cons: ["Last-seen is approximate", "Subscriptions must be cleaned up when chats close or devices drop"],
          verdict: "Chosen: presence is a view of what's on screen, so compute it for what's on screen.",
          chosen: true,
        },
      ],
      decision:
        "Gateways emit connect/disconnect (debounced ~10 s to absorb flapping) to a presence service that keeps userId → {online, lastSeen} in memory with TTLs. When a device opens a chat, its gateway subscribes to the other user's presence and gets an initial value plus changes until the chat closes. Typing indicators ride the same path and are never stored.",
      newRisks: [
        { risk: "Presence service node loss forgets online state.", mitigation: "It's soft state: gateways re-report their connected users, and clients show 'last seen recently' meanwhile." },
        { risk: "Privacy settings (hide last seen) must be enforced.", mitigation: "Applied in the presence service before any value leaves it." },
      ],
      sayIt:
        "Presence is ephemeral, so it never touches the message store. The gateway already knows who's connected, presence lives in memory with TTLs, and changes are only pushed to people who have that chat open. Typing indicators ride the same lossy path.",
      delta: {
        addNodes: [{ id: "presence", label: "Presence service", sub: "in-memory · TTL · subscriptions", kind: "cache", x: 330, y: 0 }],
        addEdges: [{ id: "gw-presence", from: "gw", to: "presence", label: "connect/disconnect · subscribe", async: true }],
      },
    },
    {
      version: "v7",
      title: "Media goes out of band",
      problem: "Photos and videos sent through the chat pipeline turn small, latency-sensitive frames into multi-MB transfers that block the connection and bloat the store.",
      evidence: "Media is ~10% of messages but ~99% of bytes: ≈ 90 Gbps vs ~0.5 Gbps of text. A 20 MB video on a WebSocket holds up every message queued behind it on that connection.",
      options: [
        {
          name: "Send media inline over the chat connection and store it in the message store",
          pros: ["One path for everything"],
          cons: ["Head-of-line blocking on the socket", "The message store becomes a blob store", "Fan-out copies megabytes"],
          verdict: "Lost: mixes a latency path with a bandwidth path.",
        },
        {
          name: "Upload to our media servers, which forward to recipients",
          pros: ["Media off the socket"],
          cons: ["We proxy ~90 Gbps through our own servers", "No edge caching for group media"],
          verdict: "Lost: still routes bytes through our tier.",
        },
        {
          name: "Encrypt on device, upload directly to blob storage, send a normal message with mediaId + key; recipients download via CDN",
          pros: ["The chat path carries a few hundred bytes", "Group media is uploaded once and downloaded per member from the edge", "Server never sees plaintext"],
          cons: ["Two-step send", "Lifecycle: media must expire or be garbage-collected"],
          verdict: "Chosen: the same pattern as uploads in any large system: bytes direct to storage, references through the pipeline.",
          chosen: true,
        },
      ],
      decision:
        "The sender requests an upload URL, encrypts the file with a random key, uploads directly to blob storage (resumable for large files), then sends a regular message containing mediaId, key and a thumbnail. Recipients fetch the ciphertext via a CDN and decrypt locally. Media expires after a retention window unless re-referenced.",
      newRisks: [
        { risk: "Message delivered before media upload finished.", mitigation: "Send the message only after upload completes; show a local placeholder to the sender meanwhile." },
        { risk: "Storage cost of media nobody downloads.", mitigation: "Retention policy (e.g. 30 days after all recipients downloaded) and dedupe by ciphertext hash for forwards." },
      ],
      sayIt:
        "Media goes out of band: the device encrypts and uploads straight to blob storage, then sends an ordinary chat message carrying the reference and key. The chat pipeline only ever carries a few hundred bytes, and recipients download from a CDN.",
      delta: {
        addNodes: [{ id: "media", label: "Media store", sub: "encrypted blobs + CDN", kind: "db", x: 0, y: 220 }],
        addEdges: [
          { id: "clientA-media", from: "clientA", to: "media", label: "upload (encrypted)" },
          { id: "clientB-media", from: "clientB", to: "media", label: "download" },
        ],
      },
    },
  ],

  // ───────────────────────────── Stage 5 — Flows ─────────────────────────────
  flows: [
    {
      id: "send-online",
      name: "Alice sends Bob a message (Bob online)",
      kind: "write",
      summary: "Synchronous until stored (✓), asynchronous after (✓✓).",
      hops: [
        { from: "clientA", to: "gw", label: "send{clientMsgId c-77, conv, ciphertext}", narration: "Alice's phone sends the message on its open connection.", why: "clientMsgId is generated on the phone so retries can be recognised." },
        { from: "gw", to: "msgsvc", label: "store(conv, c-77) → partition leader", narration: "The gateway forwards to the leader for this conversation's partition.", why: "Only one place assigns sequence numbers for a conversation." },
        { from: "msgsvc", label: "c-77 new? → seq = 8812", narration: "The leader checks for a duplicate and assigns the next sequence.", why: "Per-conversation sequence = the order every participant will see." },
        { from: "msgsvc", to: "store", label: "append (conv, 8812) at quorum", narration: "The message is written to the store.", why: "Quorum write: survives the loss of one replica." },
        { from: "msgsvc", to: "gw", label: "ack {c-77, seq 8812}", narration: "Only after the write does the leader acknowledge.", why: "This is the line between 'trying' and 'sent'." },
        { from: "gw", to: "clientA", label: "✓ sent", narration: "Alice sees one tick.", why: "~100 ms so far." },
        { from: "msgsvc", to: "deliveryq", label: "MessageStored(conv, 8812)", narration: "A delivery event is queued.", why: "Nobody waits on delivery; it can retry independently.", async: true },
        { from: "deliveryq", to: "workers", label: "consume", narration: "A delivery worker picks it up.", why: "Partitioned by conversation, so this conversation's deliveries stay in order.", async: true },
        { from: "workers", to: "sessions", label: "devices(Bob)?", narration: "The worker looks up Bob's connected devices.", why: "One lookup returns every device and its gateway." },
        { from: "sessions", to: "workers", label: "phone@gw-342, web@gw-17", narration: "Bob has two devices online.", why: "Each gets its own delivery." },
        { from: "workers", to: "gw", label: "deliver (conv, 8812) → gw-342, gw-17", narration: "One RPC per gateway.", why: "A short deadline. On failure, the event is not acked and is retried." },
        { from: "gw", to: "clientB", label: "message seq 8812", narration: "Bob's devices receive and display it.", why: "Devices dedupe on (conv, seq)." },
        { from: "clientB", to: "gw", label: "delivered(conv, 8812)", narration: "Bob's phone acks delivery; this flows back as a receipt to Alice (✓✓).", why: "Receipts reuse the same pipeline as messages, as a cursor update." },
      ],
      takeaway: "The sender waits only for durability. Everything after the ✓ is asynchronous and retried, and that split is what keeps sends fast when recipients are slow.",
    },
    {
      id: "send-offline",
      name: "Bob is offline, then comes back",
      kind: "write",
      summary: "A push wakes the phone. The store, not the push, delivers the messages.",
      hops: [
        { from: "deliveryq", to: "workers", label: "MessageStored(conv, 8812)", narration: "A delivery worker handles the event.", why: "Same path as online delivery.", async: true },
        { from: "workers", to: "sessions", label: "devices(Bob)?", narration: "No devices are connected.", why: "Bob's phone is in his pocket with the app suspended." },
        { from: "workers", to: "push", label: "notify(Bob, conv)", narration: "A notification job is queued.", why: "APNs/FCM are slow and third-party, so they're isolated in their own worker.", async: true },
        { from: "push", to: "apns", label: "'New message from Alice' (collapsed)", narration: "The push worker calls APNs.", why: "Notifications for the same conversation are collapsed: one buzz, not twenty." },
        { from: "apns", to: "clientB", label: "notification", narration: "Bob's phone shows a notification and wakes the app.", why: "The push carries no message content, just a nudge." },
        { from: "clientB", to: "gw", label: "connect (cursor conv = 8790)", narration: "The app connects and reports its cursor.", why: "The device knows exactly what it has." },
        { from: "gw", to: "sessions", label: "register Bob/phone @ gw-88 (epoch 41)", narration: "The new connection is registered.", why: "Future deliveries go straight to gw-88." },
        { from: "gw", to: "msgsvc", label: "sync(conv, after 8790)", narration: "The gateway requests what Bob missed.", why: "Catch-up is a range read, not a replay of pushes." },
        { from: "msgsvc", to: "store", label: "range seq 8791…", narration: "One sequential read of the conversation partition.", why: "Clustering by seq makes this cheap." },
        { from: "msgsvc", to: "gw", label: "22 messages", narration: "The missed messages are returned in order.", why: "Same order everyone else saw." },
        { from: "gw", to: "clientB", label: "messages 8791…8812", narration: "Bob's phone is up to date.", why: "If a push was lost, nothing was lost." },
      ],
      takeaway: "Mobile push is a doorbell, not a delivery. Durability comes from the conversation log and the device's cursor.",
    },
    {
      id: "group-send",
      name: "Sending to a group of 180",
      kind: "write",
      summary: "One write, then fan-out of lightweight deliveries.",
      hops: [
        { from: "clientA", to: "gw", label: "send to group G", narration: "Alice posts in a 180-member group.", why: "Same send path as 1:1." },
        { from: "gw", to: "msgsvc", label: "store(G, c-91)", narration: "Forwarded to G's partition leader.", why: "One leader orders all of G's messages." },
        { from: "msgsvc", to: "store", label: "append (G, seq 40212)", narration: "Stored once.", why: "Not 180 times." },
        { from: "msgsvc", to: "deliveryq", label: "MessageStored(G, 40212)", narration: "One event for the whole group.", why: "Fan-out happens downstream, off the send path.", async: true },
        { from: "deliveryq", to: "workers", label: "consume", narration: "A delivery worker takes the event.", why: "Workers scale with fan-out load.", async: true },
        { from: "workers", to: "groups", label: "members(G) v=17", narration: "Membership comes from the group service (usually a local cache hit).", why: "Versioned, so the worker knows if its cache is current." },
        { from: "workers", to: "sessions", label: "batch devices(179 users)", narration: "One batched lookup.", why: "Batching turns 179 round trips into one." },
        { from: "workers", to: "gw", label: "1 RPC per gateway (≈ 150 devices on 96 gateways)", narration: "Deliveries are grouped by gateway.", why: "Fewer, larger RPCs." },
        { from: "workers", to: "push", label: "notify 70 offline users (collapsed)", narration: "Offline members get a notification job.", why: "They'll sync from the log when they open the app.", async: true },
      ],
      takeaway: "Groups multiply deliveries, not data. Store once, expand membership in the delivery tier, batch by gateway.",
    },
    {
      id: "open-chat",
      name: "Opening a chat: history, presence and typing",
      kind: "read",
      summary: "Durable history from the store; ephemeral presence from memory.",
      hops: [
        { from: "clientB", to: "gw", label: "open chat with Alice", narration: "Bob opens the conversation.", why: "The device already has history up to its cursor." },
        { from: "gw", to: "msgsvc", label: "sync(conv, after 8812)", narration: "Anything new since the cursor?", why: "Usually nothing, since pushes kept it current." },
        { from: "msgsvc", to: "store", label: "range read", narration: "An empty or tiny range read.", why: "Cheap: one partition, one sequential slice." },
        { from: "gw", to: "presence", label: "subscribe(Alice)", narration: "The gateway subscribes Bob's device to Alice's presence.", why: "Presence is only computed for chats on screen.", async: true },
        { from: "presence", to: "gw", label: "Alice: online", narration: "The current value comes back, followed by any changes.", why: "In-memory, sub-millisecond." },
        { from: "clientA", to: "gw", label: "typing(conv)", narration: "Alice starts typing.", why: "Fire-and-forget. If it's lost, nobody notices." },
        { from: "gw", to: "presence", label: "typing(Alice, conv)", narration: "Forwarded to the presence service.", why: "Same lossy path as presence.", async: true },
        { from: "presence", to: "gw", label: "→ subscribers: Alice typing…", narration: "Only Bob's open chat receives it.", why: "Cost scales with screens showing this chat." },
        { from: "gw", to: "clientB", label: "'Alice is typing…'", narration: "Bob sees the indicator.", why: "Expires on its own after a few seconds." },
      ],
      takeaway: "Two paths with opposite guarantees: messages are durable, ordered and acked; presence and typing are in-memory, lossy and scoped to what's on screen.",
    },
    {
      id: "media",
      name: "Sending a photo",
      kind: "write",
      summary: "The bytes go to blob storage; the chat carries a reference and a key.",
      hops: [
        { from: "clientA", label: "encrypt photo with random key K", narration: "The phone encrypts the image locally.", why: "The server stores only ciphertext." },
        { from: "clientA", to: "media", label: "upload ciphertext (presigned URL)", narration: "The phone uploads directly to blob storage.", why: "200 KB–20 MB never touches the chat connection." },
        { from: "clientA", to: "gw", label: "send{mediaId, K, thumbnail} (inside ciphertext)", narration: "A normal chat message carries the reference and key.", why: "A few hundred bytes on the latency-sensitive path." },
        { from: "gw", to: "msgsvc", label: "store", narration: "Stored and sequenced like any message.", why: "Ordering and receipts work the same for media." },
        { from: "msgsvc", to: "deliveryq", label: "MessageStored", narration: "Delivered like any message.", why: "Nothing special downstream.", async: true },
        { from: "deliveryq", to: "workers", label: "consume", narration: "A worker routes it.", why: "Same fan-out logic as text.", async: true },
        { from: "workers", to: "gw", label: "deliver", narration: "The reference reaches Bob's gateway.", why: "Fast, small." },
        { from: "gw", to: "clientB", label: "message {mediaId, K}", narration: "Bob's phone gets the reference.", why: "It shows the thumbnail immediately." },
        { from: "clientB", to: "media", label: "download via CDN → decrypt with K", narration: "The full image is fetched from the nearest edge and decrypted.", why: "Group media is uploaded once and served from the edge to each member." },
      ],
      takeaway: "Separate the bandwidth path from the latency path: bytes direct to storage, references through the chat pipeline.",
    },
    {
      id: "gateway-dies",
      name: "Failure: a gateway with 500K connections dies (node death)",
      kind: "failure",
      summary: "Half a million devices lose their socket at once. The log makes sure no message is lost.",
      hops: [
        { from: "gw", label: "gw-342 crashes (OOM / kernel panic)", narration: "500K devices, including Bob's phone, are disconnected.", why: "Gateways are stateful, so their death is visible to users.", failure: true },
        { from: "workers", to: "gw", label: "deliver (conv, 8813) → gw-342: refused", narration: "A delivery in flight to the dead gateway fails.", why: "The registry still points at gw-342 until Bob reconnects or the TTL expires.", failure: true },
        { from: "workers", label: "no ack → event retried with backoff", narration: "The delivery worker doesn't commit the event.", why: "At-least-once: the event will be tried again." },
        { from: "clientB", to: "gw", label: "reconnect after jittered backoff (→ gw-88)", narration: "Bob's phone reconnects to another gateway.", why: "Jitter spreads 500K reconnects over ~30 s instead of one second." },
        { from: "gw", to: "sessions", label: "register Bob/phone @ gw-88 (epoch 42 > 41)", narration: "The registry entry is replaced.", why: "Epochs stop a late write from the dead gateway overwriting the new one." },
        { from: "gw", to: "msgsvc", label: "sync(conv, after 8812)", narration: "Bob's phone asks for anything it missed.", why: "This alone would recover 8813, even if the retry never happened." },
        { from: "workers", to: "sessions", label: "retry: devices(Bob)? → gw-88", narration: "The retried delivery finds the new gateway.", why: "Possibly delivering 8813 twice (sync + retry)." },
        { from: "workers", to: "gw", label: "deliver 8813 → gw-88 (device dedupes)", narration: "The device ignores the duplicate.", why: "Dedupe on (conv, seq) makes double delivery invisible." },
      ],
      takeaway: "Losing a gateway costs reconnects, not messages. Every device can rebuild its state from the log with one cursor.",
    },
    {
      id: "duplicate-send",
      name: "Failure: the ✓ is lost and the phone retries (duplicate processing)",
      kind: "failure",
      summary: "Alice's network flips from 4G to Wi-Fi just after the server stored her message.",
      hops: [
        { from: "clientA", to: "gw", label: "send{c-77}", narration: "Alice sends.", why: "Normal path." },
        { from: "gw", to: "msgsvc", label: "store(c-77)", narration: "Forwarded to the leader.", why: "—" },
        { from: "msgsvc", to: "store", label: "append seq 8812", narration: "The message is stored.", why: "It's now durable." },
        { from: "msgsvc", to: "gw", label: "ack seq 8812", narration: "The ack goes back to the gateway.", why: "—" },
        { from: "gw", to: "clientA", label: "✓ (connection already dead)", narration: "Alice's phone switched networks; the ack never arrives.", why: "Mobile connections die constantly.", failure: true },
        { from: "clientA", to: "gw", label: "reconnect; resend{c-77} (same id)", narration: "The phone retries with the same clientMsgId.", why: "Retrying is the only safe thing a client can do without an ack.", failure: true },
        { from: "gw", to: "msgsvc", label: "store(c-77)", narration: "The duplicate reaches the leader.", why: "—" },
        { from: "msgsvc", label: "(conv, c-77) already = seq 8812", narration: "The leader finds the clientMsgId in its recent-ID cache.", why: "Dedupe by client ID makes the send idempotent." },
        { from: "msgsvc", to: "gw", label: "ack seq 8812 (no new write)", narration: "The original sequence is returned.", why: "Bob sees the message once; Alice gets her ✓." },
      ],
      takeaway: "Exactly-once is the illusion you build from at-least-once plus a client-generated idempotency key, and devices deduping on (conversation, seq).",
    },
    {
      id: "reconnect-storm",
      name: "Failure: a whole zone drops, 40M devices reconnect (stampede)",
      kind: "failure",
      summary: "A network blip disconnects a zone's gateways. Everyone comes back at the same moment.",
      hops: [
        { from: "clientB", to: "gw", label: "40M devices reconnect within 5 s", narration: "A zone's network flaps; every device it held reconnects immediately.", why: "Synchronised retries: the textbook thundering herd.", failure: true },
        { from: "gw", label: "TLS handshakes saturate CPU on surviving gateways", narration: "Each new TLS connection costs ~1–2 ms of CPU. Gateways fall over, causing more reconnects.", why: "A positive feedback loop: overload → disconnects → more reconnects.", failure: true },
        { from: "gw", label: "admission control: accept N/s, reply 'retry in 20–60 s' to the rest", narration: "Gateways cap new connections per second and shed the excess cheaply.", why: "Rejecting fast keeps the gateway alive for those already connected." },
        { from: "clientB", label: "exponential backoff + full jitter; honour retry-after", narration: "Clients spread their retries randomly.", why: "Jitter breaks the synchronisation." },
        { from: "gw", to: "sessions", label: "registration rate smoothed", narration: "Registrations arrive over a minute, not a second.", why: "The registry survives the wave." },
        { from: "gw", to: "msgsvc", label: "lazy sync: unread counts first, history on open", narration: "Reconnected devices fetch summaries, then history when a chat is opened.", why: "Avoids 40M full-history range reads at once." },
      ],
      takeaway: "Reconnect storms are a client-design problem as much as a server one: jittered backoff, server-driven retry-after and lazy sync keep recovery from becoming a second outage.",
    },
    {
      id: "leader-failover",
      name: "Failure: a conversation partition leader fails over (ordering)",
      kind: "failure",
      summary: "The node assigning sequence numbers dies. Fencing makes sure no number is used twice.",
      hops: [
        { from: "msgsvc", label: "leader of partition 512 stalls (long GC pause)", narration: "The leader stops renewing its lease.", why: "A paused process may still think it's the leader when it wakes up.", failure: true },
        { from: "msgsvc", label: "new leader elected, epoch 7 → 8", narration: "A replica takes the lease with a higher epoch.", why: "Leases are granted by a coordination service (e.g. etcd)." },
        { from: "msgsvc", to: "store", label: "read max seq for each active conversation", narration: "The new leader recovers the last assigned sequence numbers.", why: "The store is authoritative; in-memory counters were lost." },
        { from: "msgsvc", to: "store", label: "old leader wakes, writes seq 9001 with epoch 7", narration: "The zombie leader tries to write.", why: "Without fencing, two messages could get seq 9001.", failure: true },
        { from: "store", to: "msgsvc", label: "rejected: epoch 7 < 8", narration: "The conditional write fails.", why: "Fencing token: the store only accepts writes from the current epoch." },
        { from: "msgsvc", to: "gw", label: "old leader's senders retry → new leader", narration: "Clients retry with the same clientMsgId and land on the new leader.", why: "Idempotency keys make the retry safe." },
      ],
      takeaway: "Per-conversation ordering needs exactly one sequencer at a time. Leases decide who it is; fencing tokens stop the one that doesn't know it's been replaced.",
    },
  ],

  // ───────────────────────────── Stage 6 — Deep dives ─────────────────────────────
  deepDives: [
    {
      id: "guarantees",
      title: "Delivery guarantees: 'exactly once, in order' without paying for it",
      question: "Users expect every message exactly once and in the right order. What do we actually guarantee, and how?",
      context: [
        "Networks drop acks, so senders must retry, so the server will see duplicates.",
        "Pushes can be lost or reordered across gateways and devices.",
        "Global ordering across all conversations is useless to users and very expensive.",
      ],
      options: [
        {
          name: "Exactly-once delivery through distributed transactions",
          pros: ["Conceptually clean"],
          cons: ["Requires coordination with the device, which is offline half the time", "Not achievable end-to-end over unreliable networks"],
          verdict: "Lost: there's no exactly-once over a lossy network, only at-least-once plus idempotence.",
        },
        {
          name: "At-most-once (fire and forget)",
          pros: ["Cheapest"],
          cons: ["Silent message loss"],
          verdict: "Lost: fine for typing indicators, unacceptable for messages.",
        },
        {
          name: "At-least-once everywhere + idempotency (clientMsgId on send, (conv, seq) on receive) + per-conversation sequence + cursor-based sync",
          pros: ["Effectively exactly-once as seen by users", "Recovers from any crash by re-syncing", "Ordering is cheap because it's partitioned"],
          cons: ["Every component must tolerate duplicates", "Clients must handle gaps (wait briefly or sync)"],
          verdict: "Chosen.",
          chosen: true,
        },
      ],
      recommendation:
        "Make 'stored with a seq' the only commit point. Senders retry with the same clientMsgId; the leader dedupes. Deliveries are retried until acked; devices dedupe by seq and only advance their cursor contiguously, filling gaps with a sync. Anything lost in transit is recovered by 'give me seq > cursor'.",
      sayIt:
        "There's no exactly-once over a mobile network, so I build it from at-least-once plus idempotency: a client-generated message ID dedupes sends, a per-conversation sequence dedupes and orders deliveries, and a cursor lets any device repair itself with one sync call.",
    },
    {
      id: "fanout",
      title: "Group fan-out: copies, pushes or pulls",
      question: "How should a message reach 1,024 group members, and what changes for a channel with 10M followers?",
      context: [
        "Average deliveries ≈ 14 per message. Group messages dominate fan-out.",
        "Members are spread across hundreds of gateways, and many are offline.",
      ],
      options: [
        {
          name: "Copy into each member's inbox (fan-out on write)",
          pros: ["Simple per-user reads"],
          cons: ["Storage × members", "Edits and deletes touch every copy"],
          verdict: "Lost for groups.",
        },
        {
          name: "Store once; push a delivery to each online device; offline devices sync from the log",
          pros: ["One body write", "Pushes are batched per gateway"],
          cons: ["Delivery work proportional to members"],
          verdict: "Chosen for groups up to ~1K.",
          chosen: true,
        },
        {
          name: "Store once; members pull when they open the channel (fan-out on read), with only a badge pushed",
          pros: ["Cost independent of follower count"],
          cons: ["Not real-time for every reader"],
          verdict: "Chosen for broadcast channels (10K+), where real-time per reader matters less.",
        },
      ],
      recommendation:
        "Store once per conversation in every case. For groups (≤ 1,024), fan out pushes in the delivery tier, batched by gateway. For huge channels, push only a lightweight 'new posts' signal (or nothing) and let clients pull from the channel log.",
      sayIt:
        "I never copy the message per member. Groups store once and fan out lightweight pushes batched by gateway; giant channels flip to pull, because pushing to 10M devices for every post is the celebrity problem from news feeds.",
    },
    {
      id: "connections",
      title: "Holding 200M connections",
      question: "WebSocket, long-polling, MQTT? And how do you operate a fleet of stateful gateways?",
      context: [
        "Every online device needs a path for server-initiated messages.",
        "Gateways must be deployed, drained and scaled without dropping the world.",
      ],
      options: [
        {
          name: "HTTP short polling",
          pros: ["Works everywhere", "Stateless servers"],
          cons: ["Latency = poll interval", "Millions of empty requests/s", "Battery drain"],
          verdict: "Lost.",
        },
        {
          name: "Long-polling",
          pros: ["Real-time-ish over plain HTTP"],
          cons: ["Reconnect per message", "Header overhead", "Awkward bidirectional traffic"],
          verdict: "Fallback only, for networks that block WebSockets.",
        },
        {
          name: "Persistent WebSocket (or MQTT over TLS) to stateful gateways with a session registry",
          pros: ["Bidirectional, low overhead per message", "One connection per device", "Gateways are thin: auth, framing, routing"],
          cons: ["Stateful fleet: deploys must drain connections gradually", "Reconnect storms must be designed for"],
          verdict: "Chosen.",
          chosen: true,
        },
      ],
      recommendation:
        "Thin gateways that only terminate connections, authenticate and forward. Deploy by draining: stop accepting new connections, then close existing ones gradually with a 'reconnect elsewhere' hint over minutes. Clients reconnect with jittered backoff; the session registry is soft state that rebuilds itself.",
      sayIt:
        "Each device holds one WebSocket to a thin gateway that does auth, framing and routing and nothing else. The registry maps users to gateways, deploys drain connections slowly, and clients reconnect with jitter so a lost gateway is a blip rather than a stampede.",
    },
  ],

  // ───────────────────────────── Stage 7 — Defend ─────────────────────────────
  tradeOffs: [
    {
      decision: "Per-conversation sequence numbers",
      alternative: "Global ordering or client timestamps",
      why: "Users only perceive order within a conversation; partitioning makes it scale.",
      whenToSwitch: "Never global. If cross-conversation order mattered (an audit trail), use a separate log.",
    },
    {
      decision: "Ack after durable write, deliver asynchronously",
      alternative: "Ack after delivery, or ack before write",
      why: "✓ means 'stored', and delivery speed can't slow the sender.",
      whenToSwitch: "For ephemeral chat (live-stream comments) acking before write is acceptable.",
    },
    {
      decision: "At-least-once + idempotency keys",
      alternative: "Exactly-once infrastructure",
      why: "Exactly-once end-to-end over mobile networks doesn't exist; idempotency gives the same user experience.",
      whenToSwitch: "Never for messages.",
    },
    {
      decision: "Session registry",
      alternative: "Consistent-hash users to gateways",
      why: "Fleet changes don't force users to move.",
      whenToSwitch: "Small fleets where a lookup costs more than occasional reshuffles.",
    },
    {
      decision: "Store once, fan out deliveries",
      alternative: "Copy per recipient inbox",
      why: "Storage and write cost don't multiply with group size.",
      whenToSwitch: "If messages must be independently deletable per recipient with different retention, per-recipient copies become reasonable.",
    },
    {
      decision: "Ephemeral presence",
      alternative: "Durable last-seen writes",
      why: "Presence goes stale in seconds; durable writes would cost millions/s for nothing.",
      whenToSwitch: "Compliance products may need a durable activity log, but as a separate sampled stream.",
    },
  ],

  bottlenecks: [
    { item: "Reconnect storms after a gateway or zone failure", mitigation: "Jittered client backoff, admission control with retry-after, lazy sync." },
    { item: "Hot conversations (huge active groups) on one partition leader", mitigation: "Cap group size; channels move to fan-out on read; batch sequence assignment." },
    { item: "Delivery fan-out bursts", mitigation: "Batch per gateway, per-group rate limits, autoscale workers on queue lag." },
    { item: "APNs/FCM throttling during spikes", mitigation: "Collapse notifications per conversation, separate push worker with backoff." },
    { item: "Session registry hot shards", mitigation: "Shard by user ID; it's soft state, so a lost shard is rebuilt by gateway re-registration." },
    { item: "Message store write volume (~700K/s peak)", mitigation: "Wide-column store partitioned by conversation, time-bucketed partitions for long-lived chats, TTL for retention." },
  ],

  followUps: [
    {
      question: "How does end-to-end encryption work for groups and multiple devices?",
      answer: [
        "Each device has its own identity key. 1:1 messages are encrypted per recipient device (Signal protocol, double ratchet).",
        "Groups use sender keys: each sender distributes a symmetric key to every member device once (pairwise-encrypted), then encrypts each group message once.",
        "On membership change, senders rotate their sender keys. The server only routes ciphertext and never holds keys.",
      ],
    },
    {
      question: "How would you go multi-region?",
      answer: [
        "Users connect to the nearest region's gateways. Each conversation has a home region where its partition leader lives (e.g. the region of its creator or most members).",
        "Sends from other regions are forwarded to the home region to be sequenced; deliveries are routed to whichever region each recipient is connected to.",
        "If a home region fails, conversation leadership moves to a replica region (asynchronous replication means a few seconds of messages may need resending; idempotency keys make that safe).",
      ],
    },
    {
      question: "How do you implement 'delete for everyone' and edits?",
      answer: [
        "As new messages in the same conversation log (type = DELETE/EDIT, referencing the original seq), delivered and ordered like anything else.",
        "Clients apply them on receipt. The original ciphertext is removed from the store asynchronously.",
      ],
    },
    {
      question: "How would you detect spam if messages are encrypted?",
      answer: [
        "Use metadata: sending rate, fan-out to non-contacts, account age, report signals, and forwarding counts.",
        "Rate-limit new accounts and messages to strangers; let users report a message (the reporting client uploads the plaintext it already has).",
      ],
    },
  ],

  mistakes: [
    "Acking the sender before the message is durably stored.",
    "Ordering by client timestamps.",
    "Broadcasting every message to every gateway to find the recipient.",
    "Treating mobile push as the delivery mechanism instead of a wake-up signal.",
    "Copying the message body into every group member's inbox.",
    "Writing presence heartbeats to a database.",
    "Sending media through the chat connection.",
    "No plan for a reconnect storm after a gateway or zone failure.",
  ],

  redFlags: [
    "'We'll use Kafka for chat', with no answer for ordering, dedupe or offline sync.",
    "A single global sequencer.",
    "No idempotency key on send.",
    "Stateless gateways that somehow know where every user is without a registry.",
    "Exactly-once delivery promised without explaining how retries are deduplicated.",
  ],
};
