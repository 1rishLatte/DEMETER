#pragma once
// DEMETER Rover 1 - Pico W Arduino Config
// Target: Raspberry Pi Pico W (RP2040 + CYW43439) via Earle Philhower core 3.9.x
// FQBN: rp2040:rp2040:rpipicow  | PlatformIO: board = rpipicow

// ---- Network ----
#define AP_SSID       "DEMETER-AP"
#define AP_PASS       "16042008"   // open demo; set "" for truly open (MicroPython used open)
#define AP_CHANNEL    1
#define ROVER2_IP     "192.168.4.2"
#define HTTP_PORT     80
#define DEPLOY_TOKEN  "DEMETER2026"

// ---- Pins (must match docs/pin-map.md) ----
constexpr int PIN_DHT       = 16;  // DHT11 data, 10k pullup to 3.3V, VCC 3.3V
constexpr int PIN_GAS_ADC   = 26;  // MQ-135 AO via 1k/2k divider 5V->3.3V, ADC0
constexpr int PIN_SOIL_HYGRO= 27;  // Resistive probe: 3.3V -> probe -> GP27 -> 10k -> GND (10k pulldown mandatory)
constexpr int PIN_SDA       = 4;   // MPU-6050 SDA I2C0
constexpr int PIN_SCL       = 5;   // MPU-6050 SCL
constexpr int PIN_TRIG      = 14;  // HC-SR04 TRIG, 3.3V OK (VIH 2V)
constexpr int PIN_ECHO      = 15;  // HC-SR04 ECHO via 1k/2k divider 5V->3.3V
constexpr int PIN_LED       = LED_BUILTIN; // 25 on Pico, "LED" alias

// ---- Soil calibration for 10k pulldown: 12-bit 0-4095 (MicroPython 0-1023 = /4) ----
// Dry high R -> low V -> low raw, Wet low R -> high V -> high raw (inverted vs cap)
constexpr int SOIL_DRY      = 1200; // ~300*4 raw in air (dry low)
constexpr int SOIL_WET      = 3200; // ~800*4 raw in water (wet high)
constexpr int SOIL_THRESHOLD= 2000; // ~500*4 below this = dry

// ---- MQ threshold (12-bit scaled: 400*4) ----
constexpr int GAS_THRESHOLD = 1600;

// ---- Timing (non-blocking) ----
constexpr unsigned long DHT_INTERVAL_MS   = 2000;
constexpr unsigned long ULTRA_TIMEOUT_US  = 30000; // 30ms ~5m
constexpr unsigned long AP_BEACON_MS      = 600;
