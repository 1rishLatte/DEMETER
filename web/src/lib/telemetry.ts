// Single source of truth for DEMETER telemetry — easy linking between Pico, ESP32, and web.
// All API routes + bridge + page import from here — change once, link everywhere.

import { z } from "zod";

// --- Pico /status JSON (Rover 1) + nested Rover 2 ---
function normalizeAdc(v: number): number {
  // Accept both MicroPython 0-1023 and Arduino 0-4095, normalize to 0-1023 for DB/frontend
  if (v > 4095) return 4095 >> 2;
  if (v > 1023) return Math.round(v / 4);
  return v;
}

export const PicoStatusSchema = z.object({
  t: z.number().nullable().optional(),
  h: z.number().nullable().optional(),
  dht: z.number().int().nullable().optional(),
  gas: z.number().int().min(0).max(4095).nullable().optional(),
  gasAlert: z.number().int().min(0).max(1).nullable().optional(),
  // Rover1 soil hygrometer GP27 — NEW (3.3V capacitive) accept 0-1023 or 0-4095
  soil: z.number().int().min(0).max(4095).nullable().optional(), // R1 raw
  soilPct: z.number().int().min(0).max(100).nullable().optional(),
  soilDry: z.number().int().min(0).max(1).nullable().optional(),
  ultra: z.number().int().min(0).max(9999).nullable().optional(),
  tilt: z.number().nullable().optional(),
  ax: z.number().nullable().optional(),
  ay: z.number().nullable().optional(),
  az: z.number().nullable().optional(),
  gx: z.number().nullable().optional(),
  gz: z.number().nullable().optional(),
  mpu: z.number().int().nullable().optional(),
  ts: z.number().int().nullable().optional(),
  // nested Rover2 log (POST /log)
  rover2: z
    .object({
      soil: z.number().int().min(0).max(4095).nullable().optional(),
      soilPct: z.number().int().min(0).max(100).nullable().optional(),
      dist: z.number().int().min(0).max(9999).nullable().optional(),
      pwm: z.number().int().min(0).max(255).nullable().optional(),
      state: z.string().max(16).nullable().optional(),
      plant: z.number().int().min(0).max(1).nullable().optional(),
      ir: z.string().max(8).nullable().optional(),
      ts: z.number().int().nullable().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  // flat Rover2 fallback (bare ESP32 POST)
  dist: z.number().int().nullable().optional(),
  pwm: z.number().int().nullable().optional(),
  state: z.string().max(16).nullable().optional(),
  // session tag (ingest groups field runs)
  session_id: z.string().max(64).nullable().optional(),
}).passthrough();

export type PicoStatus = z.infer<typeof PicoStatusSchema>;

// Flat ingestion payload accepted by POST /api/ingest
export const IngestSchema = PicoStatusSchema;
export type IngestPayload = PicoStatus;

// Row as stored in Supabase (demeter_telemetry)
export type TelemetryRow = {
  id: string;
  created_at: string;
  session_id: string;
  t: number | null;
  h: number | null;
  gas: number | null;
  gas_alert: number | null;
  ultra: number | null;
  tilt: number | null;
  ax: number | null;
  ay: number | null;
  az: number | null;
  gx: number | null;
  gz: number | null;
  mpu_ok: number | null;
  dht_ok: number | null;
  // Rover1 hygrometer (new) — dedicated columns so R1 vs R2 don't collide
  soil_r1: number | null;
  soil_pct_r1: number | null;
  soil_dry_r1: number | null;
  // Rover2 soil/doser
  soil: number | null;
  soil_pct: number | null;
  dist: number | null;
  plant: number | null;
  ir: string | null;
  pwm: number | null;
  rover_state: string | null;
  ts: number | null;
};

// Unified frontend shape — easy to link to API or Pico direct
export type Telem = {
  t: number;
  h: number;
  gas: number;
  gasAlert: number;
  ultra: number;
  tilt: number;
  ax: number;
  ay: number;
  az: number;
  // Rover1 hygrometer
  soilR1: number;
  soilPctR1: number;
  soilDryR1: number;
  mpu: number;
  dht: number;
  rover2: {
    soil: number;
    soilPct: number;
    dist: number;
    plant: number;
    ir: string;
    pwm: number;
    state: string;
    ts: number;
  };
  ts: number;
  sessionId: string;
};

// Mapping helpers — one place to change, every link updates
export function picoToRow(p: PicoStatus, sessionId = "field-a"): Omit<TelemetryRow, "id" | "created_at"> {
  const r2 = (p.rover2 ?? {}) as Record<string, unknown>;
  const hasRover2 = !!p.rover2;
  return {
    session_id: String(p.session_id ?? sessionId).slice(0, 64),
    t: typeof p.t === "number" ? p.t : null,
    h: typeof p.h === "number" ? p.h : null,
    gas: typeof p.gas === "number" ? normalizeAdc(Math.round(p.gas)) : null,
    gas_alert: typeof p.gasAlert === "number" ? p.gasAlert : null,
    ultra: typeof p.ultra === "number" ? Math.round(p.ultra) : null,
    tilt: typeof p.tilt === "number" ? p.tilt : null,
    ax: typeof p.ax === "number" ? p.ax : null,
    ay: typeof p.ay === "number" ? p.ay : null,
    az: typeof p.az === "number" ? p.az : null,
    gx: typeof p.gx === "number" ? p.gx : null,
    gz: typeof p.gz === "number" ? p.gz : null,
    mpu_ok: typeof p.mpu === "number" ? p.mpu : null,
    dht_ok: typeof p.dht === "number" ? p.dht : null,
    // R1 hygrometer — top-level soil fields (normalize 4095->1023)
    soil_r1: typeof p.soil === "number" && hasRover2 ? normalizeAdc(Math.round(p.soil)) : null,
    soil_pct_r1: typeof p.soilPct === "number" && hasRover2 ? Math.round(p.soilPct) : null,
    soil_dry_r1: typeof p.soilDry === "number" && hasRover2 ? p.soilDry : null,
    // R2 — from nested, or legacy flat soil when no rover2 key
    soil: typeof r2.soil === "number" ? normalizeAdc(Math.round(r2.soil as number)) : !hasRover2 && typeof p.soil === "number" ? normalizeAdc(Math.round(p.soil)) : null,
    soil_pct: typeof (r2 as Record<string, unknown>).soilPct === "number" ? Math.round(Number((r2 as Record<string, unknown>).soilPct)) : null,
    dist: typeof (r2 as Record<string, unknown>).dist === "number" ? Math.round(Number((r2 as Record<string, unknown>).dist)) : null,
    plant: typeof (r2 as Record<string, unknown>).plant === "number" ? Number((r2 as Record<string, unknown>).plant) : null,
    ir: typeof (r2 as Record<string, unknown>).ir === "string" ? String((r2 as Record<string, unknown>).ir).slice(0, 8) : null,
    pwm: typeof (r2 as Record<string, unknown>).pwm === "number" ? Math.round(Number((r2 as Record<string, unknown>).pwm)) : null,
    rover_state: typeof (r2 as Record<string, unknown>).state === "string" ? String((r2 as Record<string, unknown>).state).slice(0, 16) : null,
    ts: typeof (r2 as Record<string, unknown>).ts === "number" ? Number((r2 as Record<string, unknown>).ts) : typeof p.ts === "number" ? p.ts : null,
  };
}

export function rowToTelem(row: TelemetryRow): Telem {
  return {
    t: Number(row.t ?? 0),
    h: Number(row.h ?? 0),
    gas: Number(row.gas ?? 0),
    gasAlert: Number(row.gas_alert ?? 0),
    ultra: Number(row.ultra ?? 9999),
    tilt: Number(row.tilt ?? 0),
    ax: Number(row.ax ?? 0),
    ay: Number(row.ay ?? 0),
    az: Number(row.az ?? 0),
    soilR1: Number(row.soil_r1 ?? 0),
    soilPctR1: Number(row.soil_pct_r1 ?? 0),
    soilDryR1: Number(row.soil_dry_r1 ?? 0),
    mpu: Number(row.mpu_ok ?? 0),
    dht: Number(row.dht_ok ?? 0),
    rover2: {
      soil: Number(row.soil ?? 0),
      soilPct: Number(row.soil_pct ?? 0),
      dist: Number(row.dist ?? 9999),
      plant: Number(row.plant ?? 0),
      ir: String(row.ir ?? "000"),
      pwm: Number(row.pwm ?? 0),
      state: String(row.rover_state ?? "IDLE"),
      ts: Number(row.ts ?? 0),
    },
    ts: Number(row.ts ?? 0),
    sessionId: String(row.session_id ?? "field-a"),
  };
}

// For Pico direct poll — same shape, no DB roundtrip
export function picoToTelem(j: PicoStatus): Telem {
  const r2 = (j.rover2 ?? {}) as Record<string, unknown>;
  const norm = (v: unknown) => typeof v === "number" ? normalizeAdc(v) : 0;
  return {
    t: Number(j.t ?? 0),
    h: Number(j.h ?? 0),
    gas: norm(j.gas),
    gasAlert: Number(j.gasAlert ?? 0),
    ultra: Number(j.ultra ?? 9999),
    tilt: Number(j.tilt ?? 0),
    ax: Number(j.ax ?? 0),
    ay: Number(j.ay ?? 0),
    az: Number(j.az ?? 0),
    soilR1: norm(j.soil),
    soilPctR1: Number(j.soilPct ?? 0),
    soilDryR1: Number(j.soilDry ?? 0),
    mpu: Number(j.mpu ?? 0),
    dht: Number(j.dht ?? 0),
    rover2: {
      soil: norm((r2.soil as number) ?? 0),
      soilPct: Number(((r2 as Record<string, unknown>).soilPct as number) ?? 0),
      dist: Number((r2.dist as number) ?? 9999),
      plant: Number(((r2 as Record<string, unknown>).plant as number) ?? 0),
      ir: String((r2.ir as string) ?? "000"),
      pwm: Number((r2.pwm as number) ?? 0),
      state: String((r2.state as string) ?? "IDLE"),
      ts: Number((r2.ts as number) ?? 0),
    },
    ts: Number(j.ts ?? 0),
    sessionId: String(j.session_id ?? "field-a"),
  };
}
