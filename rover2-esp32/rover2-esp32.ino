/*
  DEMETER - Rover 2 Vibrator-only manual (ESP32)
  Board: ESP32 Dev Module | Baud: 115200
  Manual control: no sensors/motors, only vibrator PWM GPIO5 -> IRLZ44N
  Control: HTTP GET /vibrate?pwm=0..255  GET /stop  GET /status  OR Serial 0-9/v/s
  WiFi: STA to Pico WH AP DEMETER-AP (192.168.4.1) 192.168.4.2, POST log every 500ms
*/
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include "config.h"
#include "dosing.h"

WebServer server(80);
int currentPwm = 0;
String currentState = "IDLE";
unsigned long lastPostMs = 0;

void applyPwm(int pwm, String state){
  currentPwm = constrain(pwm, 0, 255);
  currentState = state;
  setVibrator(currentPwm);
  digitalWrite(PIN_STATUS_LED, currentPwm>0 ? HIGH : LOW);
  Serial.printf("Vibrator pwm=%d state=%s\n", currentPwm, currentState.c_str());
}

void handleVibrate(){
  int pwm = server.hasArg("pwm") ? server.arg("pwm").toInt() : -1;
  int v = server.hasArg("v") ? server.arg("v").toInt() : -1;
  if(v>=0) pwm=v;
  if(pwm<0 || pwm>255){ server.send(400, "text/plain", "use ?pwm=0..255"); return; }
  applyPwm(pwm, pwm>0 ? "RUNNING" : "IDLE");
  server.sendHeader("Content-Security-Policy", "default-src 'self'");
  server.send(200, "text/plain", String("PWM ") + currentPwm);
}

void handleStop(){
  applyPwm(0, "IDLE");
  server.send(200, "text/plain", "STOPPED");
}

void handleStatus(){
  String j = "{\"pwm\":" + String(currentPwm) + ",\"state\":\"" + currentState + "\"}";
  server.sendHeader("Content-Security-Policy", "default-src 'self'");
  server.send(200, "application/json", j);
}

void handleRoot(){
  String html = "<html><body style='font-family:system-ui'><h3>DEMETER Rover2 — Vibrator Manual</h3>"
                "<p>WiFi: " + WiFi.localIP().toString() + " | PWM: " + String(currentPwm) + " | " + currentState + "</p>"
                "<p><a href='/vibrate?pwm=255'>MAX 255</a> | <a href='/vibrate?pwm=150'>MID 150</a> | <a href='/vibrate?pwm=80'>LOW 80</a> | <a href='/stop'>STOP 0</a> | <a href='/status'>status</a></p>"
                "<p>Manual: URL ?pwm=0..255 or Serial 0-9, v255, s</p></body></html>";
  server.send(200, "text/html", html);
}

void setup(){
  Serial.begin(115200);
  Serial.println("DEMETER Rover2 Vibrator-manual booting...");
  dosingInit();
  pinMode(PIN_STATUS_LED, OUTPUT);
  Serial.println("Pins: Vib GPIO5 -> IRLZ44N, LED GPIO2");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_AP_SSID, WIFI_AP_PASSWORD);
  Serial.print("Connecting to DEMETER-AP");
  int tries=0;
  while(WiFi.status()!=WL_CONNECTED && tries<20){ delay(500); Serial.print("."); tries++; }
  if(WiFi.status()==WL_CONNECTED){ Serial.print("\nWiFi "); Serial.println(WiFi.localIP()); }
  else Serial.println("\nWiFi retrying... Pico may be off. Use Serial: 0-9/v255/s");

  server.on("/", handleRoot);
  server.on("/vibrate", handleVibrate);
  server.on("/stop", handleStop);
  server.on("/status", handleStatus);
  // legacy compat
  server.on("/deploy", handleVibrate);
  server.begin();
  Serial.println("HTTP :80 — /vibrate?pwm=0..255  /stop  /status");
  Serial.println("Serial: 0..9 => 0..255, s=stop, v<0-255> e.g. v200");
}

void loop(){
  static String serialBuf="";
  if(WiFi.status()!=WL_CONNECTED){
    static unsigned long lastTry=0;
    if(millis()-lastTry>3000){ lastTry=millis(); WiFi.begin(WIFI_AP_SSID, WIFI_AP_PASSWORD); }
  }
  server.handleClient();

  while(Serial.available()){
    char c=Serial.read();
    if(c=='\n' || c=='\r'){
      serialBuf.trim();
      if(serialBuf.length()){
        if(serialBuf=="s" || serialBuf=="S" || serialBuf=="stop") applyPwm(0,"IDLE");
        else if(serialBuf.startsWith("v")){ int p=serialBuf.substring(1).toInt(); applyPwm(p, p>0?"RUNNING":"IDLE"); }
        else if(serialBuf.length()==1 && isDigit(serialBuf[0])){ int d=serialBuf.toInt(); int p=map(d,0,9,0,255); applyPwm(p, p>0?"RUNNING":"IDLE"); }
        else Serial.println("use: s | v0..255 | 0..9");
      }
      serialBuf="";
    } else serialBuf+=c;
  }
  // single char without newline
  if(serialBuf.length()==1 && isDigit(serialBuf[0])){ /* wait for newline */ }

  // POST log to Pico
  if(WiFi.status()==WL_CONNECTED && millis()-lastPostMs>LOG_INTERVAL_MS){
    lastPostMs=millis();
    String j="{\"pwm\":" + String(currentPwm) + ",\"state\":\"" + currentState + "\",\"soil\":0,\"dist\":0}";
    HTTPClient http;
    http.begin(String("http://")+ROVER1_IP+"/log");
    http.addHeader("Content-Type","application/json");
    http.POST(j);
    http.end();
  }
  delay(10);
}
