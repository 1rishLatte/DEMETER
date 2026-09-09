# Rover1 Arduino — Remote Move (Pico stays scout)

Pico WH on same chassis runs `rover1-pi/main.py` sensors/AP `192.168.4.1` on battery #1. This Arduino on battery #2 drives the 4WD via L298N and phone remote — no UART between boards needed.

## Wiring

| L298N | Arduino Uno | Power |
|-------|-------------|-------|
| ENA | D5 PWM | jumper **removed** |
| IN1 IN2 | D7 D8 | L side motors parallel OUT1/2 |
| ENB | D6 PWM | jumper removed |
| IN3 IN4 | D9 D10 | R side OUT3/4 |
| 12V | 7.4V LiPo + | |
| GND | LiPo - **and** Arduino GND star | |
| 5V | **DO NOT** use to power Arduino (keep jumper, power Arduino via its own battery `VIN 5V via buck` or USB) |

| HC-05 Bluetooth | Arduino | Note |
|-----------------|---------|------|
| VCC | 5V | HC-05 has 3.3V LDO |
| GND | GND | |
| TX | D2 (Arduino RX) | direct |
| RX | D3 (Arduino TX) **via 1k top /2k bottom → HC-05 RX** if 3.3V RX | |
| Baud | 9600 default | |

Optional IR VS1838B: `OUT→D4, VCC 5V, GND`. Uncomment IR block in `.ino` + install `IRremote 4.4`.

## Upload

IDE → Board `Arduino Uno` → Port → open `rover1-arduino.ino` → Upload. Open Serial Monitor `9600` → type `F` → motors spin. Then pair phone to `HC-05` (pin `1234`/`0000`) → app `Bluetooth RC Controller` → connect → slide.

## Commands

`F` forward `B` back `L` spin left `R` right `G` fwd-left `I` fwd-right `H` back-left `J` back-right `S` stop `V` faster `v` slower `q` max. Auto-stop 800ms after last char (safety).

## Coexistence with Pico

Separate batteries = no ground loop. If single battery, tie `Pico GND` to `L298N GND/Arduino GND` star. Motors draw peaks → Pico `3.3V` dips — separate batteries as you have is ideal. Pico still reports `soil GP27 (3.3V→probe→GP27→10k→GND)` `gas` etc via `http://192.168.4.1/status` while Arduino drives.

## Troubleshoot

Motors one side reversed → swap that side's `OUT1↔OUT2` or `OUT3↔OUT4`. No BT → check `9600` (AT mode `38400`), `D2/D3` swapped. L298N hot → lower `PWM_SPEED 200→160`. Runaway → `CMD_TIMEOUT_MS 800` stops.
