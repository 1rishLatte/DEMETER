# Rover 1 - Pico WH Scout

MicroPython for Raspberry Pi Pico WH.

## Flash

1. Hold BOOTSEL, plug USB, copy MicroPython `RPI_PICO_W-*.uf2` (python.org).
2. Thonny -> Interpreter -> MicroPython (Raspberry Pi Pico).
3. Copy `main.py` + `config.py` to Pico root (save as `main.py`).
4. Reset Pico.

## Wiring

- DHT11 data -> GP16, VCC 3.3V, 10k pullup
- MQ-135 AO -> GP26 (ADC0), VCC 5V (needs 5V), GND common
- MPU-6050 VCC 3.3V, GND, SDA GP4, SCL GP5
- Power: 5V 1A via VBUS or LiPo buck 5V -> VSYS

## Test

Serial (Thonny REPL) shows `AP active: ('192.168.4.1', ...)`.
Phone -> WiFi `DEMETER-AP` -> `http://192.168.4.1/` dashboard.
`http://192.168.4.1/status` JSON includes `rover2` logs after Rover2 POSTs.

## API

- `GET /` dashboard with Deploy/Stop buttons
- `GET /status` JSON {t,h,gas,tilt,rover2:{soil,dist,pwm,state}}
- `GET /deploy` -> Pico forwards GET http://192.168.4.2/deploy to Rover2
- `POST /log` <- Rover2 JSON logs
