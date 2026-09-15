import { NextRequest, NextResponse } from "next/server";
import { defineWord } from "@/lib/dict";

// Dictionary data is immutable per OEWN edition, so responses are
// edge-cacheable for a long time.
const CACHE = "public, s-maxage=86400, stale-while-revalidate=86400";

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
