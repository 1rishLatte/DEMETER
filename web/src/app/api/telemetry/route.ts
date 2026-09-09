import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { rowToTelem } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/telemetry?limit=60&session_id=field-a&since=2026-09-08T00:00:00Z
// Easy linking: one endpoint returns unified Telem[] — works for page, curl, or external dashboards.
// Always returns { data: Telem[], raw: Row[] } so you can link either shape.

export async function GET(req: NextRequest) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "60", 10) || 60));
  const sessionId = (searchParams.get("session_id") ?? "field-a").slice(0, 64);
  const since = searchParams.get("since"); // ISO date filter
  const raw = searchParams.get("raw") === "1"; // if ?raw=1 also return raw rows

  let q = supabase
    .from("demeter_telemetry")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (since) {
    const d = new Date(since);
    if (!isNaN(d.getTime())) q = q.gte("created_at", d.toISOString());
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).reverse(); // oldest first for charts
  const telem = rows.map((r) => rowToTelem(r as never));

  if (raw) return NextResponse.json({ data: telem, raw: rows, count: rows.length });
  return NextResponse.json({ data: telem, count: rows.length }, {
    headers: { "Cache-Control": "no-store" },
  });
}
