# DEMETER — Swarm Pin Maps (ESP32-Only 4WD + Pico WH + Dividers)

## Rover 1 — Raspberry Pi Pico WH 4WD Scout & AP 192.168.4.1

| Sensor | Pico Pin | Wiring | Divider |
|--------|----------|--------|---------|
| DHT11 data | GP16 | 10k pullup to 3.3V, VCC 3.3V | — |
| MQ-135 AO | GP26 ADC0 | VCC 5V (heater 150mA), **AO -> 1k top / 2k bottom -> GP26** 5V->3.3V | **1k/2k mandatory, test ≤3.3V** |
| Soil Hygrometer (resistive probe) | GP27 ADC1 | **3.3V → probe → GP27 node → 10k → GND** (voltage divider). Probe top, 10k pulldown. Wet=low R → high V. Dry=high R → low V. | **10k pulldown mandatory** |
| MPU-6050 SDA/SCL | GP4 / GP5 | I2C0 400kHz, VIN 3.3V | — |
| HC-SR04 TRIG | GP14 | 3.3V -> TRIG (VIH 2V OK) | — |
| HC-SR04 ECHO | GP15 | **ECHO -> 1k/2k -> GP15** 5V->3.3V | **1k/2k mandatory** |
| Status LED | onboard LED | blink 600ms IDLE / 150ms active | — |
| Power | VSYS 5V via buck or USB | GND star to L298N/MQ/HC-SR04 | 1000µF on 5V rail |

Network: AP `DEMETER-AP` open + token `DEMETER2026` `?token=`, `192.168.4.1:80` `GET /` `GET /status` JSON, `GET /deploy?token=...` -> forwards `GET http://192.168.4.2/deploy?token=...`, `POST /log` from Rover2. Security headers set.

## Rover 2 — ESP32-Only 4WD Direct-Wired Doser (NO Uno, NO shield)

| Function | ESP32 GPIO | Wiring |
|----------|------------|--------|
| Soil cap SIG | 33 ADC1_CH5 | wet 250-350 dry 650-850, ADC_11db, input 0-3.3V |
| VL53L0X SDA/SCL | 21 / 22 | VIN 3.3V, I2C |
| IR Left/Center/Right | 25 / 26 / 27 | TCRT5000 VCC 3.3-5V, OUT -> GPIO |
| Vibrator PWM | 5 | ledc 5kHz 8-bit -> IRLZ44N gate (1k + 10k pulldown), 1N4007 flyback, motor ->5V |
| L298N ENA (L PWM) | 13 | jumper removed, ledc |
| L298N IN1/IN2 (L DIR) | 12 / 4 | OUT1/2 -> Left Front+Rear parallel |
| L298N ENB (R PWM) | 14 | jumper removed, ledc |
| L298N IN3/IN4 (R DIR) | 15 / 16 | OUT3/4 -> Right Front+Rear parallel |
| Status LED | 2 | onboard |
| Baud | 115200 | USB only |

Power: 7.4V LiPo -> L298N 12V input (jumper kept) + buck 5V 2A -> ESP VIN, common GND star, 1000µF on 3.3V. Do not power ESP from L298N 5V out.

4WD: L298N drives 2 channels, each side 2 motors parallel (check one reversed, swap pair if spins opposite).

UART Protocol: DELETED — no `D2/D6` SoftwareSerial, no divider. ESP32 handles WiFi directly. Legacy `rover2-uno/` archived.

Security: ESP32 `/deploy|/stop` check `?token=DEMETER2026` -> 401 else, `CSP default-src 'self'` header, rate-limit on Pico 5/10s.
