#include "dosing.h"
#include "config.h"

void dosingInit(){
  pinMode(PIN_VIBRATOR, OUTPUT);
  analogWrite(PIN_VIBRATOR, 0);
}

void setVibrator(int pwm){
  pwm = constrain(pwm, 0, 255);
  analogWrite(PIN_VIBRATOR, pwm);
}

// Jury wow inverse scaling:
// Zone A dry+plant -> MAX, Zone B wet or no plant -> 0, else linear
int computeVibratorPwm(const DoserData &d){
  // No plant gated: pause dosing if plant not detected and dist > PLANT_LOST
  bool noPlant = d.distMm > PLANT_LOST_MM || d.distMm < 0;
  bool wet = d.soilRaw < SOIL_WET_THRESHOLD;
  bool dry = d.soilRaw > SOIL_DRY_THRESHOLD;

  if (wet || noPlant) return VIBRATOR_IDLE_PWM; // immediate stop - visible
  if (d.plantPresent && dry) return VIBRATOR_MAX_PWM; // high speed
  // interpolate in deficient band
  if (d.plantPresent) {
    // 350->650 maps 40->180, adds hysteresis
    int pwm = map(d.soilRaw, SOIL_WET_THRESHOLD, SOIL_DRY_THRESHOLD, VIBRATOR_MIN_PWM, 180);
    return constrain(pwm, VIBRATOR_MIN_PWM, 180);
  }
  return VIBRATOR_IDLE_PWM;
}
