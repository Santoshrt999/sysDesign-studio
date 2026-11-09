// Local, single-user profile store: reads/writes data/profile.json (gitignored).
// Only active in "file" storage mode (local development). In "browser" mode (any hosted deployment) it returns 404,
// so a public site can never share one profile between visitors.
import { promises as fs } from "fs";
import path from "path";
import { STORAGE_MODE, isProfileFile } from "@/lib/progress/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "profile.json");

const disabled = () => new Response("Not found", { status: 404 });

export async function GET() {
  if (STORAGE_MODE !== "file") return disabled();
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Response.json({ file: isProfileFile(parsed) ? parsed : null });
  } catch {
    // Missing or malformed file: behave as "no profile yet".
    return Response.json({ file: null });
  }
}

export async function PUT(req: Request) {
  if (STORAGE_MODE !== "file") return disabled();
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
