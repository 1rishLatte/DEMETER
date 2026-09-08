# DEMETER Continuity — If Owner Unavailable

## What This Project Is
- **Mother Rover (Pico WH)** `rover1-pi/main.py:27` — AP `DEMETER-AP` 192.168.4.1 open, sensors DHT11 GP16, MQ135 GP26→1k/2k, MPU6050 GP4/5, HC-SR04 GP14/15→1k/2k, `GET /status` JSON, `POST /log`
- **Doser Rover (ESP32)** `rover2-esp32/rover2-esp32.ino:1` — vibrator GPIO5 manual `GET /vibrate?pwm=0..255`, `GET /status`, posts `{"pwm":..}` to Pico
- **Cloud** Supabase `fpyjcpqudwvdhkfmyrzf` tables `demeter_telemetry`/`demeter_events` RLS anon allow, **Web** `DEMETER/web` Next.js on Vercel `hope-0079/web` alias `https://web-nine-orpin-62.vercel.app` env `NEXT_PUBLIC_SUPABASE_URL` + `ANON_KEY` + `DATA_SOURCE supabase` live-only `page.tsx:118`

## How to Run (No Secrets)
1. Power Pico via VSYS 5V or USB VBUS,  bread  `AP active: ('192.168.4.1', ...)` in Thonny Shell
2. Phone → WiFi `DEMETER-AP` → `http://192.168.4.1/` → dashboard, slider `vib 0-255` → `http://192.168.4.2/vibrate?pwm=`
3. Laptop on `DEMETER-AP` + internet → `https://web-nine-orpin-62.vercel.app` → **BRIDGE ON** `src/lib/bridge.ts:1` → polls Pico `192.168.4.1/status` every 2s → `POST /api/ingest` → Supabase → chart `Gas/Ultra/PWM`

## Where Secrets Live
- `.env.local` `web/.env.local:1` + Vercel env `production` — **never commit** `.env` (`web/.gitignore:34`), use `.env.example` placeholder. Pico `config.py:4` has no hard-coded WiFi pass (open).

## Failsafe
- Pico `LINE_LOST 2000ms` `config.h:49` stops motors, vibrator `0` on `wet/noPlant` `dosing.cpp:12`, Rover2 manual `pwm` persists until `stop` — add timeout if needed.
- If no owner, data persists in Supabase (region `ap-southeast-2`), deployed Vercel stays live until team deletes. Repo `DEMETER/web` git `master` contains all code.

## Handover
- Git: `C:\Users\aadar\DEMETER` + `web` — commit/push to GitHub before leaving
- Supabase dashboard: `https://supabase.com/dashboard/project/fpyjcpqudwvdhkfmyrzf` → Tables → `demeter_telemetry`
- Vercel: `https://vercel.com/hope-0079/web` → Settings → Env

Last updated: 2026-09-08 — build mode, web `web-a4wf5nue8` live
