# DEMETER Rover1 4WD Scout - Pico WH config
# OPEN AP for review (no password) - matches image PASS: ''
AP_SSID = "DEMETER-AP"
AP_PASS = "16042008"
ROVER2_IP = "192.168.4.2"
HTTP_PORT = 80
# Sensor pins
PIN_DHT = 16        # DHT11 3.3V
PIN_GAS_ADC = 26    # MQ135 AO via 1k/2k divider 5V->3.3V
PIN_SDA = 4         # MPU SDA
PIN_SCL = 5         # MPU SCL
PIN_TRIG = 14       # HC-SR04 TRIG 3.3V->5V OK
PIN_ECHO = 15       # HC-SR04 ECHO via 1k/2k divider 5V->3.3V
