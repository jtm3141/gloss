import { NextRequest, NextResponse } from "next/server";
import { suggest } from "@/lib/dict";

const CACHE = "public, s-maxage=3600, stale-while-revalidate=3600";

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
