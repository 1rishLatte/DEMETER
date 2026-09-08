#include "motors.h"
#include "config.h"
void motorsInit(){
  pinMode(PIN_MOTOR_L_PWM, OUTPUT);
  pinMode(PIN_MOTOR_L_DIR, OUTPUT);
  pinMode(PIN_MOTOR_R_PWM, OUTPUT);
  pinMode(PIN_MOTOR_R_DIR, OUTPUT);
  stopMotors();
}
void setMotors(int l, int r){
  l=constrain(l,-255,255); r=constrain(r,-255,255);
  digitalWrite(PIN_MOTOR_L_DIR, l>=0?HIGH:LOW);
  analogWrite(PIN_MOTOR_L_PWM, abs(l));
  digitalWrite(PIN_MOTOR_R_DIR, r>=0?HIGH:LOW);
  analogWrite(PIN_MOTOR_R_PWM, abs(r));
}
void stopMotors(){
  analogWrite(PIN_MOTOR_L_PWM,0);
  analogWrite(PIN_MOTOR_R_PWM,0);
}
