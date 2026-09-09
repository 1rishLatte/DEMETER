#pragma once
// DEMETER Rover1 Arduino — Remote Move
// Board: Arduino Uno R3 (ATmega328P) @ 16MHz, 5V logic
// Remote: Bluetooth HC-05/HC-06 via SoftwareSerial (phone app) + optional IR VS1838B
// Motors: L298N 4WD parallel — 7.4V LiPo VM, ENA/ENB jumpers REMOVED

// ---- Motors L298N ----
constexpr int PIN_ENA = 5;   // L PWM (left side front+rear parallel)
constexpr int PIN_IN1 = 7;   // L DIR
constexpr int PIN_IN2 = 8;   // L DIR
constexpr int PIN_ENB = 6;   // R PWM (right side)
constexpr int PIN_IN3 = 9;   // R DIR
constexpr int PIN_IN4 = 10;  // R DIR
constexpr int PWM_SPEED = 200; // 0-255 default cruising, use V/v to change
constexpr int PWM_TURN  = 180; // turning speed

// ---- Remote — Bluetooth HC-05 ----
// HC-05 VCC 5V (has onboard 3.3V LDO), GND common, TX->Arduino D2 via divider not needed if 5V-tolerant? Uno 5V so direct. RX Arduino D3 -> HC-05 RX via 1k/2k if HC-05 is 3.3V RX (safe to add)
constexpr int PIN_BT_RX = 2; // Arduino RX <- HC-05 TX
constexpr int PIN_BT_TX = 3; // Arduino TX -> HC-05 RX (use 1k top /2k bottom if HC-05 3.3V)
constexpr long BT_BAUD = 9600; // HC-05 default 9600 (AT mode 38400)

// ---- Optional IR remote VS1838B (if you have IR) ----
constexpr int PIN_IR = 4; // VS1838B OUT -> D4, VCC 3.3-5V, GND
// NEC codes (common car remote) — change to your remote values via Serial print
constexpr unsigned long IR_F = 0xFF629D; // CH+ / F
constexpr unsigned long IR_B = 0xFFA857; // CH- / B
constexpr unsigned long IR_L = 0xFFE21D; // <<
constexpr unsigned long IR_R = 0xFF02FD; // >>
constexpr unsigned long IR_S = 0xFF22DD; // EQ stop

// ---- Safety ----
constexpr unsigned long CMD_TIMEOUT_MS = 800; // stop if no BT char for 800ms (prevents runaway)
