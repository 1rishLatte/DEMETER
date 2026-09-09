import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

export async function GET() {
  const supabase = getSupabaseServer();
  let dbOk = false, rows: number | null = null;
  if (supabase) {
    const { count, error } = await supabase.from("demeter_telemetry").select("id", { count: "exact", head: true });
    if (!error) { dbOk = true; rows = count ?? 0; }
  }
  return NextResponse.json({
    ok: true,
    service: "DEMETER backend",
    db: dbOk ? "connected" : "not configured",
    telemetry_rows: rows,
    endpoints: {
      ingest: "POST /api/ingest — { t,h,gas,soil(R1),soilPct,ultra,tilt,rover2:{soil,dist,pwm} }",
      telemetry: "GET /api/telemetry?limit=60&session_id=field-a&raw=1",
      health: "GET /api/health",
    },
    pico: { status: "GET http://192.168.4.1/status", via: "bridge POSTs to /api/ingest" },
  }, { headers: { "Cache-Control": "no-store" } });
}
