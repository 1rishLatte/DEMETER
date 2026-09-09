// Easy linking: one factory for server routes, one singleton for client components.
// Never put SERVICE_ROLE in NEXT_PUBLIC_ — anon is safe for RLS (insert/select allowed), server uses anon too.
// If you add SERVICE_ROLE later, use SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC prefix) and only in server code.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string | null {
  const v = process.env[name];
  if (!v) return null;
  return v;
}

// Server factory — call inside API routes (ensures env read at request time, not build time)
export function getSupabaseServer(): SupabaseClient | null {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL") ?? requireEnv("SUPABASE_URL");
  const anon = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? requireEnv("SUPABASE_ANON_KEY");
  if (!url || !anon) return null;
  return createClient(url, anon, { auth: { persistSession: false } });
}

// Client singleton — for use in "use client" components (page.tsx reads via /api/telemetry, not direct)
const urlClient = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonClient = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const supabase: SupabaseClient | null =
  urlClient && anonClient ? createClient(urlClient, anonClient) : null;

if (!urlClient || !anonClient) {
  console.warn("Supabase env missing — NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export type DemeterTelemetryRow = {
  id: string;
  created_at: string;
  session_id: string;
  t: number | null; h: number | null; gas: number | null; gas_alert: number | null;
  ultra: number | null; tilt: number | null; ax: number | null; ay: number | null; az: number | null;
  gx: number | null; gz: number | null; mpu_ok: number | null; dht_ok: number | null;
  soil_r1: number | null; soil_pct_r1: number | null; soil_dry_r1: number | null;
  soil: number | null; soil_pct: number | null; dist: number | null; plant: number | null; ir: string | null; pwm: number | null; rover_state: string | null; ts: number | null;
};
