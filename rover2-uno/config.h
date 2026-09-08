#ifndef CONFIG_H
#define CONFIG_H

// DEMETER - Rover 2 Doser: Uno R3 + ESP32 (UART bridge)
// ESP32 is WiFi co-processor, Uno does real-time control

#define WIFI_AP_SSID        "DEMETER-AP"
#define WIFI_AP_PASSWORD    ""              // open

// UART to ESP32 - use D2/D6 (SWSerial) keeps D0/D1 free, D3/D11 free for motors
#define ESP_SERIAL_RX       2               // Uno D2 <- ESP32 TX2 (GPIO17)
#define ESP_SERIAL_TX       6               // Uno D6 -> ESP32 RX2 (GPIO16)
#define ESP_BAUD            115200

// Sensors - Rover 2 doser
#define PIN_SOIL            A0              // capacitive soil 0-1023
#define PIN_VL53_SDA        A4
#define PIN_VL53_SCL        A5
#define PIN_IR_LEFT         4
#define PIN_IR_CENTER       8
#define PIN_IR_RIGHT        9

// Motors - L298P / Auton Shield
#define PIN_MOTOR_L_PWM     3
#define PIN_MOTOR_L_DIR     13
#define PIN_MOTOR_R_PWM     11
#define PIN_MOTOR_R_DIR     12

// Actuation
#define PIN_VIBRATOR        5               // MOSFET PWM 0-255
#define PIN_STATUS_LED      13              // shared

// Thresholds - tune on Zone A/B
#define SOIL_WET_THRESHOLD      350
#define SOIL_DRY_THRESHOLD      650
#define PLANT_DETECT_MM         200
#define PLANT_LOST_MM           400
#define VIBRATOR_MAX_PWM        255
#define VIBRATOR_MIN_PWM        40
#define VIBRATOR_IDLE_PWM       0

// Navigation
#define BASE_SPEED              180
#define TURN_SPEED              200
#define SLOW_SPEED              120
#define LINE_LOST_TIMEOUT_MS    2000

// Timing
#define SENSOR_INTERVAL_MS      100
#define LOG_INTERVAL_MS         500

#endif
