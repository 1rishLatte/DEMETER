#include "line_follow.h"
#include "config.h"
#include "motors.h"

void lineFollow(const DoserData &d, bool running){
  if (!running) { stopMotors(); return; }
  String p = d.irPattern;
  // 3-sensor bang-bang. Black line = 0, white =1 (TCRT5000)
  // Adjust if inverted: if line is white on black, invert reads
  if (p == "010") setMotors(BASE_SPEED, BASE_SPEED);
  else if (p == "100" || p == "110") setMotors(SLOW_SPEED, TURN_SPEED); // left -> steer right
  else if (p == "001" || p == "011") setMotors(TURN_SPEED, SLOW_SPEED);
  else if (p == "000") { // lost - last was center, go slow forward
    setMotors(100, 100);
  } else if (p == "111") { // all white - junction, go straight
    setMotors(BASE_SPEED, BASE_SPEED);
  } else {
    setMotors(BASE_SPEED, BASE_SPEED);
  }
}
