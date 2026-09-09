# DEMETER Rover 1 — Arduino (Pico W) — Soil Hygro GP27

MicroPython `rover1-pi/main.py` ported to Arduino C++ so the backend links identically. Same pins, same endpoints, same JSON — `web/src/lib/telemetry.ts` `picoToRow` works unchanged.

## Board & Toolchain (exact, per Arduino contract)

* Board: **Raspberry Pi Pico W** RP2040 + CYW43439, 3.3V logic, 2.4GHz WiFi
* Core: **Earle Philhower rp2040 3.9.x** (`rp2040:rp2040:rpipicow` FQBN, `board = rpipicow` in PlatformIO)
* Host: Arduino IDE 2.x OR PlatformIO `pio run`
* Libs (pinned): `DHT sensor library@1.4.6`, `Adafruit Unified Sensor@1.1.14`, `Adafruit MPU6050@2.2.6`, `Adafruit BusIO@1.17.0`, `WiFi` (bundled)
* Upload baud 115200, `analogReadResolution(12)` = 0-4095

## Wiring (must match `docs/pin-map.md`)

| Sensor | Pico Pin | Wiring |
|--------|----------|--------|
| DHT11 | GP16 | 10k→3.3V, VCC 3.3V |
| MQ-135 AO | GP26 ADC0 | VCC 5V → **1k/2k → GP26** |
| **Soil Hygro cap v1.2** | **GP27 ADC1** | **SIG→GP27, VCC 3.3V, GND star** (if 5V SIG → 1k/2k→GP27) |
| MPU SDA/SCL | GP4/GP5 | I2C0 400kHz 3.3V |
| HC-SR04 TRIG/ECHO | GP14 / GP15 | TRIG 3.3V→5V OK, **ECHO 1k/2k→GP15** |
| LED | LED_BUILTIN (25) | blink 600ms |

## Build

Arduino IDE: Board Manager → `Raspberry Pi Pico/RP2040` by Earle Philhower 3.9.x → Board `Raspberry Pi Pico W` → open `rover1-pico-arduino.ino` → Upload (hold BOOTSEL, mass-storage, or auto).

PlatformIO: `pio run -e rpipicow --target upload` → `pio device monitor -b 115200`

Serial expect: `AP active: 192.168.4.1 SSID DEMETER-AP` → phone WiFi `DEMETER-AP` → `http://192.168.4.1/` dashboard.

## API (same as MicroPython, backend links without change)

* `GET /status` → `{t,h,gas,soil,soilPct,soilDry,ultra,tilt,ax,ay,az,gx,gz,mpu,dht,rover2:{soil,dist,pwm,state}}` — `soil` is GP27 raw 0-4095 (MicroPython used 0-1023, scaled x4). Bridge `POST /api/ingest` still uses `picoToRow()` scaling.
* `GET /deploy?token=DEMETER2026` → forwards `GET http://192.168.4.2/deploy?token=...`
* `POST /log` ← Rover2 JSON every 500ms

## Soil calibration (GP27)

1. Power at 3.3V, `http://192.168.4.1/status` → note `soil` in air = `SOIL_DRY` (~3000).
2. In water/wet soil = `SOIL_WET` (~1320). Edit `config.h` `SOIL_DRY/SOIL_WET/SOIL_THRESHOLD` and re-upload.
3. `soilPct` 0 dry→100 wet, `soilDry` = `raw > THRESHOLD`.

## Quality notes (Arduino skill contract)

* Non-blocking: `millis()` for DHT (2s), `pulseIn` timeout 30ms, WiFiServer no `delay()`.
* Rate limit 5/10s per IP, `token` check → 401/429, SSRF allowlist only `192.168.4.2`.
* Memory: RP2040 264KB SRAM, no `String` bloat beyond per-request JSON (~600B).
* Recovery: BOOTSEL mass-storage, reflash MicroPython UF2 to roll back to `rover1-pi/main.py`.

## Integration

Backend `web/src/lib/telemetry.ts` + `web/src/app/api/ingest` needs no change. To log consistently with DB `soil_r1` 0-1023, either scale in `config.h` to 0-1023 or keep 0-4095 and let `web` rescale (`raw>>2`). Current DB column `soil_r1` accepts 0-4095.
