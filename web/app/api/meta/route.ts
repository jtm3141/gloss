import { NextResponse } from "next/server";
import { dbMeta } from "@/lib/dict";

const CACHE = "public, s-maxage=86400, stale-while-revalidate=86400";

export async function GET() {
  try {
    const meta = await dbMeta();
    return NextResponse.json(meta, { headers: { "Cache-Control": CACHE } });
  } catch (e) {
    console.error("api/meta failed:", e);
    return NextResponse.json({ error: "dictionary unavailable" }, { status: 500 });
  }
}
