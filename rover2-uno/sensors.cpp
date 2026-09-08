#include "sensors.h"
#include "config.h"
#include <Wire.h>
#include <Adafruit_VL53L0X.h>

static Adafruit_VL53L0X vl53 = Adafruit_VL53L0X();
static bool vl53Found = false;

void sensorsInit() {
  pinMode(PIN_SOIL, INPUT);
  pinMode(PIN_IR_LEFT, INPUT);
  pinMode(PIN_IR_CENTER, INPUT);
  pinMode(PIN_IR_RIGHT, INPUT);
  Wire.begin();
  vl53Found = vl53.begin(0x29);
  if (vl53Found) {
    vl53.startRangeContinuous(50);
  }
}

DoserData sensorsRead() {
  DoserData d;
  d.ts = millis();
  d.soilRaw = analogRead(PIN_SOIL);
  // map raw: wet ~250-350, dry ~650-850. Invert to pct dry 0-100
  d.soilPct = constrain(map(d.soilRaw, SOIL_WET_THRESHOLD, SOIL_DRY_THRESHOLD, 0, 100), 0, 100);

  if (vl53Found && vl53.isRangeComplete()) {
    d.distMm = vl53.readRange();
    // filter 8190 = out of range, 0 = error
    if (d.distMm >= 8190 || d.distMm == 0) d.distMm = 9999;
    d.plantPresent = d.distMm < PLANT_DETECT_MM;
  } else if (vl53Found) {
    d.distMm = 9999;
    d.plantPresent = false;
  } else {
    d.distMm = -1;
    d.plantPresent = false;
  }

  d.irLeft = digitalRead(PIN_IR_LEFT);
  d.irCenter = digitalRead(PIN_IR_CENTER);
  d.irRight = digitalRead(PIN_IR_RIGHT);
  d.irPattern = String(d.irLeft) + String(d.irCenter) + String(d.irRight);
  d.lineLost = (d.irPattern == "000" || d.irPattern == "111");
  return d;
}

String doserToJson(const DoserData &d, int pwm, const char *state) {
  String s = "{";
  s += "\"soil\":" + String(d.soilRaw) + ",";
  s += "\"soilPct\":" + String((int)d.soilPct) + ",";
  s += "\"dist\":" + String(d.distMm) + ",";
  s += "\"plant\":" + String(d.plantPresent?1:0) + ",";
  s += "\"ir\":\"" + d.irPattern + "\",";
  s += "\"pwm\":" + String(pwm) + ",";
  s += "\"state\":\"" + String(state) + "\",";
  s += "\"ts\":" + String(d.ts);
  s += "}";
  return s;
}

String doserToCsv(const DoserData &d, int pwm) {
  return String(d.ts) + "," + String(d.soilRaw) + "," + String(d.distMm) + "," + String(pwm) + "," + d.irPattern;
}
