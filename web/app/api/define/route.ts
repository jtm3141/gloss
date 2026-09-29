import { NextRequest, NextResponse } from "next/server";
import { defineWord } from "@/lib/dict";

// No caching: the site stays simple with no stale-data surprises.
const CACHE = "no-store";

export async function GET(req: NextRequest) {
  const word = req.nextUrl.searchParams.get("word")?.trim() ?? "";
  if (!word) {
    return NextResponse.json({ error: "missing ?word=" }, { status: 400 });
  }
  try {
    const def = await defineWord(word);
    if (!def) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(def, { headers: { "Cache-Control": CACHE } });
  } catch (e) {
    console.error("api/define failed:", e);
    return NextResponse.json({ error: "dictionary unavailable" }, { status: 500 });
  }
}
