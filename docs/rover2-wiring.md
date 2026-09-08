# Rover 2 Doser — Wiring & Demo

## Rover 2 Pin Map (Uno R3 + ESP-01S + VL53L0X + Soil + Vibrator)

```
7.4V LiPo → Uno VIN ─┬─→ 5V → AMS1117 3.3V → ESP-01S VCC+CH_PD + VL53L0X VIN
                     │   Common GND + 1000µF on 3.3V
ESP: D2 (<-TX via divider) D6 (->RX)
Soil: A0 (capacitive v1.2)
VL53L0X: A4 SDA, A5 SCL, VIN 3.3V, GND
Vibrator: D5 → MOSFET gate (IRFZ44N) → motor → 5V, flyback diode 1N4007
IR: D4 L, D8 C, D9 R
Motors: D3 PWM L + D13 DIR L, D11 PWM R + D12 DIR R (L298P)
```

## Vibrator Chute Build (30 min)

- Gravity chute (bottle) → vibrator taped to side → D5 PWM drives via MOSFET.
- Soill test: dry sand ~700 raw → expect PWM 255 loud buzz; wet sponge ~250 → PWM 0 silent.

## Calibration for Jury Wow

1. Upload, open Serial 115200, place rover on Zone A (dry paper, stick 120mm): `soil 680 dist 120 pwm 255`
2. Move to Zone B (wet, no stick): `soil 300 dist 9999 pwm 0` — vibrator stops within 100ms.
3. Tune `SOIL_WET_THRESHOLD 350 / DRY 650` in `rover2-doser/config.h:17` until contrast visible.

## Swarm Handshake

- Rover1 AP `DEMETER-AP` 192.168.4.1 hosts dashboard.
- Rover2 connects as station `AT+CWJAP`, then polls `+IPD,GET /deploy`.
- Trigger: browser/phone `http://192.168.4.2/deploy` or Rover1 `GET http://192.168.4.2/deploy`.
- Logs: Rover2 `POST http://192.168.4.1/log` every 500ms → Rover1 Serial.

## Power Note

ESP + VL53 + Motors peak ~800mA. Use 2S 1500mAh minimum, star GND.

## Troubleshooting

- VL53 reads 8190 → out of range (no plant), check 3.3V, I2C.
- Soil stuck 1023 → resistive sensor corroding, use capacitive.
- Vibrator always on → check D5 MOSFET wiring, active HIGH.
- WiFi not joining → check `WIFI_AP_SSID DEMETER-AP` matches Rover1, run `AT+CWJAP?`.
