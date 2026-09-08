# DEMETER — AgriSwarm (Pico WH Scout 4WD + ESP32 Doser 4WD Direct-Wired)

Precision agriculture swarm: Rover1 Pico WH scouts & hosts AP/dashboard (HC-SR04 + dividers), Rover2 ESP32-Only 4WD doser follows lines and micro-doses via vibrator (NO Uno, NO shield).

## Structure

- `rover1-pi/` — **Rover 1 Scout 4WD** — MicroPython Pico WH (`main.py` + `config.py`). Hosts AP `DEMETER-AP` 192.168.4.1, dashboard, DHT11 GP16, MQ GP26 via 1k/2k 5V->3.3V, MPU GP4/GP5, HC-SR04 TRIG GP14 ECHO GP15 via 1k/2k, ultra + gas + tilt.
- `rover2-esp32/` — **Rover 2 Doser ESP32-Only 4WD** — Unified ESP32 Dev Module sketch `rover2-esp32.ino` + `config.h` + `sensors.*` + `dosing.*` + `motors.*` + `line_follow.*`. Direct L298N 4WD (ENA 13/IN1 12 IN2 4, ENB 14/IN3 15 IN4 16), VL53 21/22, Soil 33 ADC1, IR 25/26/27, Vibrator 5 ledc -> IRLZ44N. STA to `DEMETER-AP`, hosts `GET /deploy?token=DEMETER2026` `GET /status`, POSTs logs to `http://192.168.4.1/log`. Token + CSP headers.
- `rover2-uno/` — **Legacy Uno hybrid archived** (kept for backup, not used in build).
- `docs/pin-map.md` — both rovers wiring with divider details + 4WD parallel
- `rover1-esp-at-config/` — legacy ESP-01S docs (unused)

## Hardware (per AGENTS.md - no secrets hardcoded, token DEMETER2026 demo)

- Rover1: 4WD Bluetooth chassis (Pico payload only) + Pico WH + DHT11 3.3V + MQ-135 5V via divider + MPU-6050 3.3V + HC-SR04 5V TRIG GP14 ECHO GP15 via divider + 2S LiPo buck 5V
- Rover2: 4WD chassis + ESP32 DevKit direct + L298N (OUT1/2 left pair OUT3/4 right pair, ENA/ENB jumpers removed) + VL53L0X + capacitive Soil 33 + vibrator + IRLZ44N + 1N4007 + 3× IR 25/26/27 + 1000µF cap
- Common tools: Thonny (Pico), Arduino IDE 2.x (ESP32)

## Quick Start

### Rover1 Pico WH

1. Flash MicroPython `RPI_PICO_W-*.uf2` (hold BOOTSEL).
2. Thonny -> copy `rover1-pi/main.py` as `main.py`, `config.py` to Pico, reset. **Must solder 2 dividers first: MQ AO->GP26 and Echo->GP15 (1k/2k), verify ≤3.3V.**
3. Serial shows `AP active: ('192.168.4.1', ...)`. Phone -> WiFi `DEMETER-AP`.

### Rover2 ESP32 4WD (Unified)

1. IDE -> Board `ESP32 Dev Module` -> open `rover2-esp32/rover2-esp32.ino` -> Install `Adafruit VL53L0X` + `Adafruit Unified Sensor`.
2. Solder direct L298N: VM 7.4V, GND star, ENA 13 ENB 14, IN 12/4/15/16, buck 5V->ESP VIN, vibrator 5->IRLZ44N.
3. Upload, Serial 115200 -> `WiFi connected IP 192.168.4.2`. Bench `g` deploy / `s` stop. Ensure Rover1 AP on first.

## Swarm Demo (Jury Wow) — 3-Hour Review Ready

- Phone on `DEMETER-AP` -> `http://192.168.4.1/` dashboard -> **Deploy Rover 2** (`?token=DEMETER2026`) -> Pico forwards `GET http://192.168.4.2/deploy?token=...` -> ESP32 RUNNING 4WD.
- **Zone A dry paper + stick 120mm:** `soil 680 dist 120` -> `pwm 255` high vibrator, heavy dose.
- **Zone B wet sponge no stick:** `soil 300 dist 9999` -> `pwm 0` silent stop in 100ms.
- Dashboard chart: Gas + Ultra (scout) vs Soil/PWM (doser) inverse, 4WD.
- Stop: `http://192.168.4.1/stop?token=...` or `http://192.168.4.2/stop?token=...` or Serial `s`.

## Serial Logs

Pico REPL + ESP32 115200 show JSON/CSV. ESP32 POSTs `latestLog` to Rover1 every 500ms -> dashboard `rover2` + `ultra` live.

## Troubleshooting

- No AP -> Pico not flashing main.py, check thonny files.
- ESP32 not connecting -> Rover1 not on, check SSID `DEMETER-AP` open.
- VL53 8190 -> out of range, check 3.3V 21/22.
- Ultra 9999 -> ECHO divider wrong or TRIG not pulsing, check 1k/2k GP15.
- Gas stuck high -> divider ratio wrong, threshold now 400 (was 600).
- Motors not turning -> check L298N jumpers removed, 7.4V VM, DIR 12/4/15/16, ENA 13 ENB 14 ledc, GND star.
- Vibrator always on -> check D5 MOSFET wiring, active HIGH ledc.
- 401 Unauthorized -> add `?token=DEMETER2026` to deploy/stop.
