# Rover 1 - Pico WH Scout

MicroPython for Raspberry Pi Pico WH.

## Flash

1. Hold BOOTSEL, plug USB, copy MicroPython `RPI_PICO_W-*.uf2` (python.org).
2. Thonny -> Interpreter -> MicroPython (Raspberry Pi Pico).
3. Copy `main.py` + `config.py` to Pico root (save as `main.py`).
4. Reset Pico.

## Wiring (actual as wired)

- DHT11 data -> GP16, VCC 3.3V, 10k pullup
- MQ-135 AO -> GP26 (ADC0), VCC 5V (needs 5V), GND common — via 1k/2k divider
- Soil probe (resistive) -> **3.3V → probe → GP27 node → 10k → GND** (10k pulldown mandatory). GP27 ADC1 reads divider: dry high R → low V → low raw, wet low R → high V → high raw. No extra divider.
- MPU-6050 VCC 3.3V, GND, SDA GP4, SCL GP5
- HC-SR04 TRIG GP14 / ECHO GP15 via 1k/2k divider, VCC 5V
- Power: 5V 1A via VBUS or LiPo buck 5V -> VSYS, 1000µF on 5V rail

## Test

Serial (Thonny REPL) shows `AP active: ('192.168.4.1', ...)`.
Phone -> WiFi `DEMETER-AP` -> `http://192.168.4.1/` dashboard.
`http://192.168.4.1/status` JSON includes `rover2` logs after Rover2 POSTs.

## API

- `GET /` dashboard with Deploy/Stop + soil hygro (GP27) chart
- `GET /status` JSON {t,h,gas,soil,soilPct,soilDry,ultra,tilt,rover2:{soil,dist,pwm,state}} — `soil` is Rover1 hygrometer raw 0-1023 GP27
- `GET /deploy` -> Pico forwards GET http://192.168.4.2/deploy to Rover2
- `POST /log` <- Rover2 JSON logs

## Calibration (inverted for 10k pulldown)

1. Power 3.3V → probe → GP27 → 10k → GND, read `http://192.168.4.1/status` -> `soil` in air = SOIL_DRY low (~300), in water/wet soil = SOIL_WET high (~800). Update `config.py` SOIL_DRY/SOIL_WET.
2. `soilPct` = 0% at SOIL_DRY, 100% at SOIL_WET. Threshold `SOIL_DRY_THRESHOLD=500` below = dry (inverted vs cap sensor).
