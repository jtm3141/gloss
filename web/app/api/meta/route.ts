import { NextResponse } from "next/server";
import { dbMeta } from "@/lib/dict";

// No caching: the site stays simple with no stale-data surprises.
const CACHE = "no-store";

export async function GET() {
  try {
    const meta = await dbMeta();
    return NextResponse.json(meta, { headers: { "Cache-Control": CACHE } });
  } catch (e) {
    console.error("api/meta failed:", e);
    return NextResponse.json({ error: "dictionary unavailable" }, { status: 500 });
  }
}
