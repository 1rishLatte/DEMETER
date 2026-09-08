#include "esp32_bridge.h"
#include "config.h"

// ESP32 talks JSON lines over UART:
// ESP32 -> Uno: {"cmd":"deploy"} or {"cmd":"stop"}
// Uno -> ESP32: {"soil":..., "dist":..., "pwm":..., "state":"RUNNING", ...}  (one line)

static String rxBuf = "";

void esp32BridgeInit(SoftwareSerial &esp){
  rxBuf.reserve(128);
  delay(500);
  // ESP32 boots and auto-connects to DEMETER-AP, no AT needed
}

bool esp32PollDeploy(SoftwareSerial &esp, bool &deployed){
  while(esp.available()){
    char c = esp.read();
    if(c=='\n'){
      rxBuf.trim();
      if(rxBuf.length()>0){
        // expect {"cmd":"deploy"} or {"cmd":"stop"}
        if(rxBuf.indexOf("\"deploy\"")>=0) deployed = true;
        else if(rxBuf.indexOf("\"stop\"")>=0) deployed = false;
        rxBuf = "";
        return true;
      }
      rxBuf="";
    } else {
      rxBuf += c;
      if(rxBuf.length()>200) rxBuf = "";
    }
  }
  return false;
}

void esp32SendLog(SoftwareSerial &esp, const String &json){
  esp.println(json);
}
