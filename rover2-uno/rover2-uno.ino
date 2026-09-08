/*
  DEMETER - Rover 2 Precision Doser
  Hybrid: Arduino Uno R3 (real-time) + ESP32 (WiFi STA) via UART D2/D6 115200
  Sensors: VL53L0X A4/A5, Soil A0, IR D4/D8/D9, Vibrator D5, Motors D3/D11/D13/D12
  ESP32 handles WiFi: connects to Pico WH AP DEMETER-AP (192.168.4.1), HTTP /deploy, POST /log
  Uno <-> ESP32 UART JSON lines: ESP32->Uno {"cmd":"deploy"}, Uno->ESP32 {"soil":..., "pwm":..., "state":...}
  Demo: Soil dry+plant -> PWM 255, wet/no plant -> 0 stop
*/

#include <SoftwareSerial.h>
#include "config.h"
#include "sensors.h"
#include "motors.h"
#include "dosing.h"
#include "line_follow.h"
#include "esp32_bridge.h"

SoftwareSerial espSerial(ESP_SERIAL_RX, ESP_SERIAL_TX);

enum State { IDLE, RUNNING };
State state = IDLE;
unsigned long lastSensorMs=0, lastLogMs=0, lineLostSince=0;
int currentPwm=0;
String latestJson="{}";

void setup(){
  Serial.begin(115200);
  espSerial.begin(ESP_BAUD);
  pinMode(PIN_STATUS_LED, OUTPUT);
  Serial.println(F("DEMETER Rover2 Hybrid starting (Uno+ESP32)..."));
  Serial.println(F("Pins: Soil A0 VL53 A4/A5 IR D4/D8/D9 Vib D5 Motors D3/D11 ESP D2/D6"));
  Serial.println(F("Rover1 Pico WH AP: DEMETER-AP 192.168.4.1, Rover2 ESP32 192.168.4.2"));
  sensorsInit();
  motorsInit();
  dosingInit();
  esp32BridgeInit(espSerial);
  Serial.println(F("Ready. Rover1 dashboard Deploy button will send {deploy}. Bench: press 'g' to deploy, 's' to stop"));
  Serial.println(F("CSV: ts,soil,dist,pwm,ir,state"));
}

void loop(){
  unsigned long now=millis();

  // 0) Manual bench trigger
  if(Serial.available()){
    char c=Serial.read();
    if(c=='g' || c=='G'){ state=RUNNING; Serial.println(F("MANUAL DEPLOY")); }
    if(c=='s' || c=='S'){ state=IDLE; Serial.println(F("MANUAL STOP")); stopMotors(); setVibrator(0); }
  }

  // 1) ESP32 poll for deploy/stop (JSON lines)
  bool deployed = (state==RUNNING);
  if(esp32PollDeploy(espSerial, deployed)){
    state = deployed ? RUNNING : IDLE;
    Serial.print(F("ESP32 state -> "));
    Serial.println(state==RUNNING?"RUNNING":"IDLE");
    if(state==IDLE){ stopMotors(); setVibrator(0); currentPwm=0; }
  }

  // 2) Sensors + dosing @10Hz
  if(now - lastSensorMs >= SENSOR_INTERVAL_MS){
    lastSensorMs=now;
    DoserData d = sensorsRead();
    currentPwm = computeVibratorPwm(d);
    int outPwm = (state==RUNNING) ? currentPwm : 0;
    setVibrator(outPwm);

    bool lineLost = d.lineLost;
    if(lineLost && lineLostSince==0) lineLostSince=now;
    if(!lineLost) lineLostSince=0;
    if(lineLostSince && now - lineLostSince > LINE_LOST_TIMEOUT_MS){
      stopMotors();
    } else {
      lineFollow(d, state==RUNNING);
    }

    latestJson = doserToJson(d, outPwm, state==RUNNING?"RUNNING":"IDLE");
    Serial.print(F("JSON: ")); Serial.println(latestJson);
    Serial.print(F("CSV: ")); Serial.println(doserToCsv(d, outPwm));
    digitalWrite(PIN_STATUS_LED, (now/ (state==RUNNING?150:600))%2);

    // Send log to ESP32 for POST to Rover1
    esp32SendLog(espSerial, latestJson);
  }

  delay(10);
}
