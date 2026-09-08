#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

struct DoserData {
  int soilRaw;
  float soilPct;        // 0-100 dry
  int distMm;           // VL53L0X, -1 if timeout
  bool plantPresent;
  int irLeft, irCenter, irRight;
  String irPattern;     // "010"
  bool lineLost;
  unsigned long ts;
};

void sensorsInit();
DoserData sensorsRead();
String doserToJson(const DoserData &d, int pwm, const char *state);
String doserToCsv(const DoserData &d, int pwm);

#endif
