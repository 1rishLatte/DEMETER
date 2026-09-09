/*
 * DEMETER Rover1 — Arduino Remote Drive (Pico stays scout on same chassis)
 * Board: Arduino Uno R3 @ 16MHz, 5V — L298N 4WD + HC-05 Bluetooth (9600) + optional IR
 * Pico WH on same rover runs MicroPython main.py sensors/AP 192.168.4.1 on its own battery — no wire needed between boards except common GND if single LiPo
 * Wiring: see config.h + README
 * Phone: Bluetooth Serial app (e.g., "Bluetooth RC Controller" or Serial Bluetooth Terminal) → connect HC-05 → slide stick → sends F/B/L/R/S + speed
 * Serial USB also works: type F B L R S V v in Serial Monitor 9600
 * Libraries: SoftwareSerial (bundled), IRremote 4.4+ if IR used (optional)
 */

#include "config.h"
#include <SoftwareSerial.h>

SoftwareSerial bt(PIN_BT_RX, PIN_BT_TX); // RX, TX

// optional IR — comment out if not wired
// #include <IRremote.h>
// IRrecv irrecv(PIN_IR); decode_results irResults;

int curSpeed = PWM_SPEED;
unsigned long lastCmdMs = 0;
char lastCmd = 'S';

void motors(char c, int spd = -1){
  if(spd < 0) spd = curSpeed;
  spd = constrain(spd, 0, 255);
  // helper
  auto drive = [&](int ena, int in1, int in2, int p, bool fwd){
    analogWrite(ena, p);
    digitalWrite(in1, fwd ? HIGH : LOW);
    digitalWrite(in2, fwd ? LOW : HIGH);
  };
  auto stop = [&](){
    analogWrite(PIN_ENA, 0); analogWrite(PIN_ENB, 0);
    digitalWrite(PIN_IN1, LOW); digitalWrite(PIN_IN2, LOW);
    digitalWrite(PIN_IN3, LOW); digitalWrite(PIN_IN4, LOW);
  };
  switch(c){
    case 'F': drive(PIN_ENA,PIN_IN1,PIN_IN2,spd,true);  drive(PIN_ENB,PIN_IN3,PIN_IN4,spd,true);  break;
    case 'B': drive(PIN_ENA,PIN_IN1,PIN_IN2,spd,false); drive(PIN_ENB,PIN_IN3,PIN_IN4,spd,false); break;
    case 'L': // spin left
      drive(PIN_ENA,PIN_IN1,PIN_IN2,PWM_TURN,false); drive(PIN_ENB,PIN_IN3,PIN_IN4,PWM_TURN,true); break;
    case 'R':
      drive(PIN_ENA,PIN_IN1,PIN_IN2,PWM_TURN,true); drive(PIN_ENB,PIN_IN3,PIN_IN4,PWM_TURN,false); break;
    case 'G': // forward left (diagonal) — left slower
      analogWrite(PIN_ENA, spd*0.6); digitalWrite(PIN_IN1, HIGH); digitalWrite(PIN_IN2, LOW);
      analogWrite(PIN_ENB, spd); digitalWrite(PIN_IN3, HIGH); digitalWrite(PIN_IN4, LOW); break;
    case 'I': // forward right
      analogWrite(PIN_ENA, spd); digitalWrite(PIN_IN1, HIGH); digitalWrite(PIN_IN2, LOW);
      analogWrite(PIN_ENB, spd*0.6); digitalWrite(PIN_IN3, HIGH); digitalWrite(PIN_IN4, LOW); break;
    case 'H': // back left
      analogWrite(PIN_ENA, spd*0.6); digitalWrite(PIN_IN1, LOW); digitalWrite(PIN_IN2, HIGH);
      analogWrite(PIN_ENB, spd); digitalWrite(PIN_IN3, LOW); digitalWrite(PIN_IN4, HIGH); break;
    case 'J': // back right
      analogWrite(PIN_ENA, spd); digitalWrite(PIN_IN1, LOW); digitalWrite(PIN_IN2, HIGH);
      analogWrite(PIN_ENB, spd*0.6); digitalWrite(PIN_IN3, LOW); digitalWrite(PIN_IN4, HIGH); break;
    case 'S': default: stop(); break;
  }
  lastCmd = c; lastCmdMs = millis();
}

void setup(){
  Serial.begin(9600);
  bt.begin(BT_BAUD);
  // irrecv.enableIRIn(); // uncomment if IR wired
  pinMode(PIN_ENA, OUTPUT); pinMode(PIN_ENB, OUTPUT);
  pinMode(PIN_IN1, OUTPUT); pinMode(PIN_IN2, OUTPUT);
  pinMode(PIN_IN3, OUTPUT); pinMode(PIN_IN4, OUTPUT);
  motors('S');
  Serial.println(F("DEMETER Rover1 Arduino Remote — F/B/L/R/G/I/H/J/S  V faster v slower  q max"));
  Serial.println(F("BT 9600 on D2/D3, L298N ENA5 IN1 7 IN2 8 ENB6 IN3 9 IN4 10, VM 7.4V, 5V->Uno VIN, GND star"));
}

void loop(){
  // 1) Bluetooth
  if(bt.available()){
    char c = bt.read();
    if(c>='a' && c<='z') c = c - 32; // lower→upper
    if(c=='F'||c=='B'||c=='L'||c=='R'||c=='S'||c=='G'||c=='I'||c=='H'||c=='J'){
      motors(c); Serial.print(F("BT ")); Serial.println(c);
    } else if(c=='V'){ curSpeed = min(255, curSpeed+20); Serial.println(curSpeed); }
    else if(c=='v'){ curSpeed = max(80, curSpeed-20); Serial.println(curSpeed); }
    else if(c=='q'){ curSpeed=255; Serial.println(F("max")); }
  }
  // 2) USB Serial (also remote via cable)
  if(Serial.available()){
    char c = Serial.read();
    if(c=='F'||c=='B'||c=='L'||c=='R'||c=='S'||c=='G'||c=='I'||c=='H'||c=='J') motors(c);
    if(c=='V') curSpeed = min(255, curSpeed+20);
    if(c=='v') curSpeed = max(80, curSpeed-20);
  }
  // 3) IR (optional)
  // if(irrecv.decode(&irResults)){
  //   unsigned long v = irResults.value;
  //   if(v==IR_F) motors('F'); else if(v==IR_B) motors('B'); else if(v==IR_L) motors('L'); else if(v==IR_R) motors('R'); else if(v==IR_S) motors('S');
  //   irrecv.resume();
  // }
  // 4) Timeout stop — prevents runaway if BT disconnects mid-F
  if(lastCmd!='S' && millis() - lastCmdMs > CMD_TIMEOUT_MS){
    motors('S'); Serial.println(F("timeout stop"));
  }
}
