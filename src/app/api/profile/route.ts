// Local, single-user profile store: reads/writes data/profile.json (gitignored).
// Only works under `next dev` / `next start` (needs a Node runtime with file access).
import { promises as fs } from "fs";
import path from "path";
import type { ProfileFile } from "@/lib/progress/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "profile.json");

function isProfileFile(x: unknown): x is ProfileFile {
  const f = x as ProfileFile;
  return (
    !!f &&
    f.version === 1 &&
    typeof f.profile?.name === "string" &&
    f.profile.name.trim().length > 0 &&
    Array.isArray(f.activityDays) &&
    typeof f.problems === "object" &&
    f.problems !== null
  );
}

export async function GET() {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Response.json({ file: isProfileFile(parsed) ? parsed : null });
  } catch {
    // Missing or malformed file: behave as "no profile yet".
    return Response.json({ file: null });
  }
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!isProfileFile(body)) return new Response("Invalid profile file", { status: 400 });
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(body, null, 2), "utf8");
  await fs.rename(tmp, FILE); // atomic replace: a crash mid-write never leaves a half-written file
  return new Response(null, { status: 204 });
}
