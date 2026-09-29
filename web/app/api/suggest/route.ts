import { NextRequest, NextResponse } from "next/server";
import { suggest } from "@/lib/dict";

// No caching: the site stays simple with no stale-data surprises.
const CACHE = "no-store";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  try {
    const words = await suggest(q);
    return NextResponse.json(words, { headers: { "Cache-Control": CACHE } });
  } catch (e) {
    console.error("api/suggest failed:", e);
    return NextResponse.json({ error: "dictionary unavailable" }, { status: 500 });
  }
}
