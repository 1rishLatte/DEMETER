#ifndef CONFIG_H
#define CONFIG_H
// DEMETER Rover 2 — Vibrator-only manual (ESP32)
// Board: ESP32 Dev Module, 115200 baud
// MANUAL: no sensors, no motors — only vibrator PWM on GPIO5 -> IRLZ44N

#define WIFI_AP_SSID        "DEMETER-AP"
#define WIFI_AP_PASSWORD    ""              // open, matches Pico main.py AP_PASS ""

#define ROVER1_IP           "192.168.4.1"

#define PIN_VIBRATOR        5               // ledc PWM -> IRLZ44N gate, 1N4007 flyback
#define PIN_STATUS_LED      2               // onboard

#define PWM_FREQ            5000
#define PWM_RES             8               // 0-255

#define LOG_INTERVAL_MS     500
#endif
