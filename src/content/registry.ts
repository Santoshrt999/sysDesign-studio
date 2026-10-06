import type { Problem, ProblemSummary } from "./types";
import { urlShortener } from "./problems/url-shortener";
import { rateLimiter } from "./problems/rate-limiter";
import { phoneDirectory } from "./problems/phone-directory";
import { webCrawler } from "./problems/web-crawler";

/** Fully written problems. To add one: create problems/<slug>/index.ts and add it here. */
const problems: Problem[] = [urlShortener, rateLimiter, phoneDirectory, webCrawler];

const planned: Array<Omit<ProblemSummary, "status">> = [
  { slug: "rate-limiter", title: "Rate Limiter", tagline: "Token buckets, distributed counters, and fairness under contention", difficulty: "Medium" },
  { slug: "phone-directory", title: "Phone Directory", tagline: "Lookup by phone number at massive scale", difficulty: "Medium" },
  { slug: "video-streaming", title: "Video Streaming", tagline: "YouTube/Netflix — upload pipeline, transcoding, adaptive delivery", difficulty: "Hard" },
  { slug: "chat-app", title: "Chat App", tagline: "WhatsApp — delivery guarantees, presence, fan-out", difficulty: "Hard" },
  { slug: "news-feed", title: "News Feed", tagline: "Push vs pull, celebrity fan-out", difficulty: "Hard" },
  { slug: "notification-system", title: "Notification System", tagline: "Multi-channel delivery, retries, user preferences", difficulty: "Medium" },
  { slug: "unique-id-generator", title: "Unique ID Generator", tagline: "Snowflake, ranges, clocks", difficulty: "Easy" },
  { slug: "kv-store", title: "Distributed Key-Value Store", tagline: "Dynamo-style partitioning, quorum, repair", difficulty: "Hard" },
  { slug: "search-autocomplete", title: "Search Autocomplete", tagline: "Tries, top-K, freshness", difficulty: "Medium" },
  { slug: "web-crawler", title: "Web Crawler", tagline: "Politeness, dedupe, frontier at scale", difficulty: "Hard" },
  { slug: "ride-sharing", title: "Ride Sharing", tagline: "Geo-indexing, matching, location streams", difficulty: "Hard" },
  { slug: "file-sync", title: "File Storage & Sync", tagline: "Chunking, dedupe, conflict resolution", difficulty: "Hard" },
  { slug: "payment-system", title: "Payment System", tagline: "Idempotency, ledgers, reconciliation", difficulty: "Hard" },
  { slug: "ticket-booking", title: "Ticket Booking", tagline: "Contention, holds, inventory consistency", difficulty: "Hard" },
  { slug: "leaderboard", title: "Leaderboard", tagline: "Sorted sets, sharded rankings", difficulty: "Medium" },
  { slug: "message-queue", title: "Distributed Message Queue", tagline: "Partitions, offsets, delivery semantics", difficulty: "Hard" },
  { slug: "stock-exchange", title: "Stock Exchange", tagline: "Order matching, sequencing, determinism", difficulty: "Hard" },
  { slug: "proximity-service", title: "Proximity Service", tagline: "Geohash, quadtrees, nearby search", difficulty: "Medium" },
];

export function getProblem(slug: string): Problem | undefined {
  return problems.find((p) => p.slug === slug);
}

export function listProblems(): ProblemSummary[] {
  return [
    ...problems.map((p) => ({ slug: p.slug, title: p.title, tagline: p.tagline, difficulty: p.difficulty, status: "ready" as const })),
    ...planned.filter((p) => !problems.some((r) => r.slug === p.slug)).map((p) => ({ ...p, status: "planned" as const })),
  ];
}

export function readySlugs(): string[] {
  return problems.map((p) => p.slug);
}
