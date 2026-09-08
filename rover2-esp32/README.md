# Rover 2 — Vibrator Manual (ESP32)

Manual vibrator only. No sensors, no motors.

## Wiring
- ESP32 GPIO5 → 1k → IRLZ44N gate, 10k pulldown, 1N4007 flyback, vibrator → 5V
- Power: buck 5V → ESP VIN, common GND, 1000µF
- WiFi STA to DEMETER-AP 192.168.4.1 → gets 192.168.4.2

## Manual control
- HTTP: `http://192.168.4.2/vibrate?pwm=0..255` `http://192.168.4.2/stop` `http://192.168.4.2/status`
- Serial 115200: `0`→0, `9`→255, `v200`→200, `s`→stop
- Pico dashboard slider → fetch 192.168.4.2/vibrate
- Site: use manual slider (future)
- Logs POST `{"pwm":..,"state":..}` to `http://192.168.4.1/log` every 500ms

## Upload
Board ESP32 Dev Module, open `rover2-esp32.ino` → Upload → Serial shows WiFi IP.
