import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { IngestSchema, picoToRow } from "@/lib/telemetry";

// POST /api/ingest — single easy link for ALL Rovers
// Accepts: full Pico /status { t,h,gas,soil,soilPct,ultra,tilt,rover2:{soil,dist,pwm} } OR flat {soil,dist,pwm} OR Rover1-only {soil}
// Use from: bridge.ts, curl, Pico POST (if internet), or manual fetch. One endpoint, one shape.
// Rate limited: 60/min per IP. Validated with Zod server-side.

const RATE = new Map<string, number[]>();
function rateOk(ip: string): boolean {
  const now = Date.now();
  const arr = RATE.get(ip) ?? [];
  const fresh = arr.filter((t) => now - t < 60_000);
  if (fresh.length >= 60) { RATE.set(ip, fresh); return false; }
  fresh.push(now); RATE.set(ip, fresh);
  return true;
}

export async function POST(req: NextRequest) {
  // CORS allowlist (same as middleware) — reflect only our domains
  const origin = req.headers.get("origin") ?? "";
  const allowed = ["http://localhost:3000", "http://192.168.4.1", "https://demeter.vercel.app"];
  const corsOrigin = allowed.includes(origin) || origin.endsWith(".vercel.app") ? origin : allowed[0];

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateOk(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Access-Control-Allow-Origin": corsOrigin } });
  }

  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Wrap single or batch
  const batch = Array.isArray(body) ? body : [body];
  if (batch.length > 50) return NextResponse.json({ error: "Batch too large (max 50)" }, { status: 400 });

  const rows: ReturnType<typeof picoToRow>[] = [];
  for (const item of batch) {
    const parsed = IngestSchema.safeParse(item);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 400 });
    }
    rows.push(picoToRow(parsed.data, (parsed.data.session_id as string) ?? "field-a"));
  }

  const { error, data } = await supabase.from("demeter_telemetry").insert(rows).select("id").limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, inserted: rows.length, ids: data }, {
    headers: { "Access-Control-Allow-Origin": corsOrigin },
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST /api/ingest with Pico /status JSON. Example:",
    example: {
      t: 28.3, h: 62, gas: 410, soil: 680, soilPct: 20, soilDry: 1, ultra: 1180, tilt: 1.2,
      rover2: { soil: 680, dist: 120, pwm: 255, state: "RUNNING" },
      session_id: "field-a",
    },
    fields: "t,h,gas,soil(R1 GP27),soilPct,soilDry,ultra,tilt,ax,ay,az,gx,gz,mpu,dht + rover2:{soil,dist,pwm,state,ir,plant}",
    batch: "send [] array up to 50",
  });
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
