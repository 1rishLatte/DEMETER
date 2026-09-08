#ifndef DOSING_H
#define DOSING_H
#include <Arduino.h>
#include "sensors.h"
int computeVibratorPwm(const DoserData &d);
void dosingInit();
void setVibrator(int pwm);
#endif
