#include "dosing.h"
#include "config.h"
void dosingInit(){
  pinMode(PIN_VIBRATOR, OUTPUT);
  ledcAttach(PIN_VIBRATOR, PWM_FREQ, PWM_RES);
  ledcWrite(PIN_VIBRATOR, 0);
}
void setVibrator(int pwm){
  pwm = constrain(pwm, 0, 255);
  ledcWrite(PIN_VIBRATOR, pwm);
}
