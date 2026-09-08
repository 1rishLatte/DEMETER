#ifndef ESP32_BRIDGE_H
#define ESP32_BRIDGE_H
#include <Arduino.h>
#include <SoftwareSerial.h>
void esp32BridgeInit(SoftwareSerial &esp);
bool esp32PollDeploy(SoftwareSerial &esp, bool &deployed);
void esp32SendLog(SoftwareSerial &esp, const String &json);
#endif
