import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { recommend, CROPS, type Crop } from "@/lib/fertilizerAI";
import { rowToTelem } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/recommend?crop=paddy&session_id=field-a  — uses real latest telemetry, stores history
// POST /api/recommend { soil_moisture_percent, mq135_gas_reading, ultrasonic_distance_cm, humidity_percent, temperature_C, crop }
// Advice only, fake demo ranges but real sensor inputs

function toCrop(v: string | null): Crop {
  return v === "tomato" ? "tomato" : "paddy";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const crop = toCrop(searchParams.get("crop"));
  const sessionId = (searchParams.get("session_id") ?? "field-a").slice(0, 64);
  const limit = Math.min(1, parseInt(searchParams.get("history") ?? "1", 10) || 1);

  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  // Get latest real telemetry
  const { data, error } = await supabase.from("demeter_telemetry").select("*").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "No telemetry yet — bridge not posting. Try /api/telemetry first." }, { status: 404 });

  const telem = rowToTelem(data[0] as never);
  // telem has soilR1 etc 0-1023, soilPctR1 0-100, gas 0-1023, ultra mm, h/t
  // ultra mm -> cm, soil pct is already percent, gas raw
  const inputs = {
    soil_moisture_percent: Number(telem.soilPctR1 ?? 0),
    mq135_gas_reading: Number(telem.gas ?? 0),
    ultrasonic_distance_cm: Math.round(Number(telem.ultra ?? 9999) / 10),
    humidity_percent: Number(telem.h ?? 0),
    temperature_C: Number(telem.t ?? 0),
    crop,
  };

  const rec = await recommend(inputs as never);

  // Store history (advice only, demo)
  const { error: insErr } = await supabase.from("demeter_recommendations").insert({
    session_id: sessionId,
    crop,
    soil_moisture_percent: inputs.soil_moisture_percent,
    mq135_gas_reading: inputs.mq135_gas_reading,
    ultrasonic_distance_cm: inputs.ultrasonic_distance_cm,
    humidity_percent: inputs.humidity_percent,
    temperature_c: inputs.temperature_C,
    input: inputs,
    output: rec,
  } as never);
  if (insErr) console.warn("recommend store failed", insErr.message);

  // Also optionally return history
  let history: unknown[] = [];
  if (limit > 1 || searchParams.get("history")) {
    const { data: hist } = await supabase.from("demeter_recommendations").select("*").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(10);
    history = hist ?? [];
  }

  return NextResponse.json({ inputs, recommendation: rec, crop, crops: CROPS.map(c=> c.id), history: history.length? history: undefined }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const b = body as Record<string, unknown>;
  const crop = toCrop(String(b.crop ?? "paddy"));
  const inputs = {
    soil_moisture_percent: Number(b.soil_moisture_percent ?? b.soilPct ?? 0),
    mq135_gas_reading: Number(b.mq135_gas_reading ?? b.gas ?? 0),
    ultrasonic_distance_cm: Number(b.ultrasonic_distance_cm ?? b.ultra_cm ?? b.ultra ?? 20),
    humidity_percent: Number(b.humidity_percent ?? b.h ?? 60),
    temperature_C: Number(b.temperature_C ?? b.t ?? 25),
    crop,
  };
  // validate ranges loosely
  const rec = await recommend(inputs as never);
  const sessionId = String(b.session_id ?? "field-a").slice(0,64);
  await supabase.from("demeter_recommendations").insert({
    session_id: sessionId, crop,
    soil_moisture_percent: inputs.soil_moisture_percent,
    mq135_gas_reading: inputs.mq135_gas_reading,
    ultrasonic_distance_cm: inputs.ultrasonic_distance_cm,
    humidity_percent: inputs.humidity_percent,
    temperature_c: inputs.temperature_C,
    input: inputs, output: rec,
  } as never);
  return NextResponse.json({ inputs, recommendation: rec, crop });
}
