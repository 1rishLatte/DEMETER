# DEMETER Rover1 4WD Scout - Pico WH config
# OPEN AP for review (no password) - matches image PASS: ''
AP_SSID = "DEMETER-AP"
AP_PASS = "16042008"
ROVER2_IP = "192.168.4.2"
HTTP_PORT = 80
# Sensor pins
PIN_DHT = 16        # DHT11 3.3V
PIN_GAS_ADC = 26    # MQ135 AO via 1k/2k divider 5V->3.3V
PIN_SOIL_HYGRO = 27 # Resistive probe: 3.3V -> probe -> GP27 node -> 10k -> GND (divider, 10k pulldown mandatory)
PIN_SDA = 4         # MPU SDA
PIN_SCL = 5         # MPU SCL
PIN_TRIG = 14       # HC-SR04 TRIG 3.3V->5V OK
PIN_ECHO = 15       # HC-SR04 ECHO via 1k/2k divider 5V->3.3V
# Soil calibration for 10k pulldown wiring: 0-1023 scale via >>6
# Dry = high R -> low V -> low raw (~200-400), Wet = low R -> high V -> high raw (~700-900)
# Measure: in air = SOIL_DRY, in water/wet soil = SOIL_WET, recalibrate!
SOIL_DRY = 300      # raw in air (dry, low)
SOIL_WET = 800      # raw in water (wet, high)
SOIL_DRY_THRESHOLD = 500  # below this = dry (inverted vs cap sensor)
