/*
 * DEMETER Rover 1 Scout & Telemetry Hub — Arduino (Pico W)
 * Board: Raspberry Pi Pico W (RP2040 + CYW43439) — Earle Philhower core 3.9.x
 * FQBN: rp2040:rp2040:rpipicow  @ 115200 baud
 * Sensors: DHT11 GP16, MQ-135 GP26 via 1k/2k, Soil Hygro GP27 cap 3.3V, MPU-6050 GP4/5, HC-SR04 GP14/15 via 1k/2k
 * Network: Hosts AP DEMETER-AP 192.168.4.1 + HTTP server on :80
 *   GET /        -> dashboard (Chart.js same as MicroPython)
 *   GET /status  -> JSON {t,h,gas,soil,soilPct,ultra,tilt,... rover2:{soil,dist,pwm}}
 *   GET /deploy?token=DEMETER2026 -> forwards GET http://192.168.4.2/deploy?token=...
 *   POST /log    -> receives Rover2 {soil,dist,pwm,state} (ESP32 POSTs every 500ms)
 *
 * Libraries (pin exact versions in platformio.ini / library manager):
 *  - rp2040 board package 3.9.x by Earle Philhower
 *  - DHT sensor library 1.4.6 + Adafruit Unified Sensor 1.1.14
 *  - Adafruit MPU6050 2.2.6 + Adafruit BusIO
 *  - WiFi (bundled with rp2040 core, wraps CYW43)
 */

#include "config.h"
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiServer.h>
#include <DHT.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>
#include <math.h>

// ---- Hardware ----
DHT dht(PIN_DHT, DHT11);
Adafruit_MPU6050 mpu;
WiFiServer server(HTTP_PORT);
bool mpuOk = false;

// Rate limit: 5/10s per IP (simple map of 8 slots)
struct RateEntry { IPAddress ip; unsigned long times[5]; uint8_t count; };
RateEntry rateTable[8];
bool checkRate(IPAddress ip){
  unsigned long now = millis();
  for(int i=0;i<8;i++){
    if(rateTable[i].ip == ip || rateTable[i].ip == IPAddress(0,0,0,0)){
      if(rateTable[i].ip == IPAddress(0,0,0,0)) rateTable[i].ip = ip;
      // prune >10s
      uint8_t valid=0;
      for(int j=0;j<rateTable[i].count;j++) if(now - rateTable[i].times[j] < 10000) rateTable[i].times[valid++] = rateTable[i].times[j];
      rateTable[i].count = valid;
      if(valid >= 5) return false;
      rateTable[i].times[valid++] = now;
      rateTable[i].count = valid;
      return true;
    }
  }
  return true;
}

// Rover2 latest (written by POST /log, read by /status)
struct Rover2Log { int soil=0; int dist=0; int pwm=0; String state="IDLE"; unsigned long ts=0; } rover2;

// ---- Soil hygrometer: 10-sample mean, map dry->0% wet->100% ----
int readSoilRaw(){
  long s=0;
  for(int i=0;i<10;i++){ s += analogRead(PIN_SOIL_HYGRO); delay(5); }
  return s/10; // 0-4095
}
void readSoil(int &raw, int &pct, int &dry){
  raw = readSoilRaw(); // 0-4095 with 10k pulldown: dry low wet high
  if(raw <= SOIL_DRY) pct=0;
  else if(raw >= SOIL_WET) pct=100;
  else pct = (raw - SOIL_DRY)*100/(SOIL_WET - SOIL_DRY);
  dry = raw < SOIL_THRESHOLD ? 1 : 0;
}

// ---- Ultrasonic HC-SR04 ----
int readUltra(){
  digitalWrite(PIN_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long dur = pulseIn(PIN_ECHO, HIGH, ULTRA_TIMEOUT_US);
  if(dur==0) return 9999;
  float distCm = dur * 0.0343 / 2.0;
  if(distCm < 2 || distCm > 400) return 9999;
  return (int)(distCm*10); // mm
}

// ---- DHT non-blocking (2s interval) ----
float lastT=0, lastH=0; int dhtOk=0; unsigned long dhtLast=0;
void pollDHT(){
  if(millis()-dhtLast < DHT_INTERVAL_MS) return;
  dhtLast = millis();
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if(isnan(h) || isnan(t) || (t==0 && h==0)) { /* keep last */ return; }
  lastH=h; lastT=t; dhtOk=1;
}

// ---- HTTP helpers ----
void httpResp(WiFiClient &c, const String &body, const String &ctype="text/html", const String &code="200 OK"){
  c.print(String("HTTP/1.1 ")+code+"\r\n");
  c.print(String("Content-Type: ")+ctype+"\r\n");
  c.print("Access-Control-Allow-Origin: *\r\n");
  c.print("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
  c.print("Access-Control-Allow-Headers: Content-Type\r\n");
  c.print("Content-Security-Policy: default-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net\r\n");
  c.print("Strict-Transport-Security: max-age=31536000; includeSubDomains\r\n");
  c.print("X-Frame-Options: DENY\r\n");
  c.print("X-Content-Type-Options: nosniff\r\n");
  c.print("Referrer-Policy: strict-origin-when-cross-origin\r\n");
  c.print(String("Content-Length: ")+body.length()+"\r\n");
  c.print("Connection: close\r\n\r\n");
  c.print(body);
}

String triggerRover2(const String &path){
  if(String(ROVER2_IP) != "192.168.4.2") return "blocked";
  String p = path.indexOf("?")>=0 ? path+"&token="+String(DEPLOY_TOKEN) : path+"?token="+String(DEPLOY_TOKEN);
  WiFiClient cli;
  cli.setTimeout(2);
  if(!cli.connect(ROVER2_IP, 80)) return "Rover2 not reachable";
  cli.print(String("GET ")+p+" HTTP/1.1\r\nHost: "+ROVER2_IP+"\r\nConnection: close\r\n\r\n");
  String resp; unsigned long s=millis(); while(millis()-s<2000 && cli.connected()){ while(cli.available()) resp+=(char)cli.read(); delay(1); }
  cli.stop();
  return resp.substring(0,200);
}

// ---- Dashboard (same as MicroPython main.py, ensures web bridge keeps working) ----
const char DASHBOARD[] PROGMEM = R"HTML(<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DEMETER Scout — Pico W Arduino</title>
<style>*{box-sizing:border-box;font-family:system-ui}body{margin:0;background:#0f172a;color:#e2e8f0}
header{padding:16px;background:#1e293b;display:flex;justify-content:space-between}h1{margin:0;font-size:18px}.badge{padding:6px 10px;background:#22c55e;color:#000;border-radius:999px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;padding:16px}.card{background:#1e293b;border-radius:12px;padding:14px}.label{font-size:11px;opacity:.7;text-transform:uppercase}.value{font-size:22px;font-weight:700}.unit{font-size:11px;opacity:.6}
canvas{width:100%;height:180px;background:#0b1220;border-radius:8px} .status{padding:10px 16px;font-size:12px;opacity:.7}
button{padding:10px 16px;border:0;border-radius:8px;font-weight:600;cursor:pointer;margin-right:8px} .deploy{background:#22c55e} .stop{background:#ef4444;color:#fff}
</style><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body>
<header><h1>DEMETER — Scout Hub Arduino (Pico W) + Rover2 ESP32</h1><span class="badge">192.168.4.1 Arduino</span></header>
<div style="padding:12px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
  <button class="deploy" onclick="fetch('/deploy?token=DEMETER2026').then(r=>r.text()).then(t=>alert(t))">Deploy</button>
  <button class="stop" onclick="fetch('/stop?token=DEMETER2026').then(r=>r.text()).then(t=>alert(t))">Stop</button>
  <span style="opacity:.6">| Vib manual -> Rover2 192.168.4.2:</span>
  <input id="vib" type="range" min="0" max="255" value="0" oninput="document.getElementById('vibv').textContent=this.value"> <span id="vibv">0</span>
  <button onclick="let v=document.getElementById('vib').value; fetch('http://192.168.4.2/vibrate?pwm='+v).then(r=>r.text()).then(t=>alert(t)).catch(e=>alert(e))">Set Vib</button>
</div>
<div class="grid">
  <div class="card"><div class="label">Temp</div><div class="value" id="t">--</div><div class="unit">C DHT11 GP16</div></div>
  <div class="card"><div class="label">Humidity</div><div class="value" id="h">--</div><div class="unit">%</div></div>
  <div class="card"><div class="label">Gas MQ135</div><div class="value" id="gas">--</div><div class="unit"><span id="gasDot"></span> GP26</div></div>
  <div class="card"><div class="label">Ultra HC-SR04</div><div class="value" id="ultra">--</div><div class="unit">mm</div></div>
  <div class="card"><div class="label">Tilt MPU</div><div class="value" id="tilt">--</div><div class="unit">deg</div></div>
  <div class="card" style="border:1px solid #38bdf8"><div class="label">Soil Hygro</div><div class="value" id="soil1">--</div><div class="unit"><span id="soilPct">--</span>% <span id="soilDot"></span> GP27</div></div>
  <div class="card"><div class="label">Rover2 Soil</div><div class="value" id="soil">--</div><div class="unit">raw 33</div></div>
  <div class="card"><div class="label">Rover2 PWM</div><div class="value" id="pwm">--</div><div class="unit">/255</div></div>
</div>
<div style="padding:0 16px"><canvas id="chart"></canvas></div>
<div class="status">Rover1 Soil: <span id="soilSt">--</span> | Rover2: <span id="r2">--</span> | MPU <span id="mpu">--</span> DHT <span id="dht">--</span></div>
<script>
let ctx=document.getElementById('chart').getContext('2d');
let chart=new Chart(ctx,{type:'line',data:{labels:[],datasets:[
  {label:'Gas 0-1023',data:[],borderColor:'#f59e0b',tension:.3},
  {label:'Ultra (norm)',data:[],borderColor:'#a78bfa',tension:.3},
  {label:'Soil R1 GP27',data:[],borderColor:'#38bdf8',tension:.3,borderWidth:2.5},
  {label:'Soil R2',data:[],borderColor:'#22c55e',tension:.3,borderDash:[6,3]},
  {label:'PWM 0-255',data:[],borderColor:'#e879f9',tension:.3,yAxisID:'y1'}
]},options:{responsive:true,animation:false,scales:{y:{min:0,max:1023},y1:{position:'right',min:0,max:255,grid:{display:false}}}}});
let labels=[];
async function poll(){ try{ let j=await (await fetch('/status')).json();
 document.getElementById('t').textContent=j.t; document.getElementById('h').textContent=j.h;
 document.getElementById('gas').textContent=j.gas; document.getElementById('ultra').textContent=j.ultra==9999?'--':j.ultra;
 document.getElementById('tilt').textContent=j.tilt; document.getElementById('soil1').textContent=j.soil; document.getElementById('soilPct').textContent=j.soilPct;
 document.getElementById('soilDot').textContent=j.soilDry?' dry':' wet'; document.getElementById('soilSt').textContent=j.soil+' ('+j.soilPct+'%)';
 document.getElementById('soil').textContent=j.rover2.soil; document.getElementById('pwm').textContent=j.rover2.pwm;
 document.getElementById('r2').textContent=j.rover2.state+' dist '+j.rover2.dist+'mm'; document.getElementById('gasDot').textContent=j.gasAlert?' 🔴':' 🟢';
  let now=new Date().toLocaleTimeString(); labels.push(now); if(labels.length>20){labels.shift(); chart.data.datasets.forEach(d=>d.data.shift());}
  chart.data.labels=labels; chart.data.datasets[0].data.push(j.gas); chart.data.datasets[1].data.push(j.ultra==9999?0:Math.min(1023,Math.round(j.ultra*0.255)));
  chart.data.datasets[2].data.push(j.soil); chart.data.datasets[3].data.push(j.rover2.soil); chart.data.datasets[4].data.push(j.rover2.pwm); chart.update();
}catch(e){console.log(e)}} setInterval(poll,1000);poll();
</script></body></html>)HTML";

String buildStatusJson(){
  pollDHT();
  int soilRaw4095, soilPct, soilDry; readSoil(soilRaw4095, soilPct, soilDry);
  int soilRaw = soilRaw4095 >> 2; // normalize 0-4095 -> 0-1023 for easy backend linking (same as MicroPython)
  int gasRaw4095 = analogRead(PIN_GAS_ADC); // 0-4095
  int gasRaw = gasRaw4095 >> 2; // 0-1023
  int gasAlert = gasRaw4095 > GAS_THRESHOLD ? 1 : 0;
  int ultra = readUltra();
  sensors_event_t a,g,temp; float tilt=0; int mpu_v=0;
  if(mpuOk && mpu.getEvent(&a,&g,&temp)){
    tilt = atan2(a.acceleration.y, a.acceleration.z)*57.2958; mpu_v=1;
    char buf[16]; // keep numeric
    String json = String("{\"t\":")+String(lastT,1)+",\"h\":"+String(lastH,1)+",\"dht\":"+String(dhtOk);
    json += String(",\"gas\":")+String(gasRaw)+",\"gasAlert\":"+String(gasAlert);
    json += String(",\"soil\":")+String(soilRaw)+",\"soilPct\":"+String(soilPct)+",\"soilDry\":"+String(soilDry);
    json += String(",\"ultra\":")+String(ultra);
    json += String(",\"tilt\":")+String(tilt,1)+",\"ax\":"+String(a.acceleration.x,2)+",\"ay\":"+String(a.acceleration.y,2)+",\"az\":"+String(a.acceleration.z,2);
    json += String(",\"gx\":")+String(g.gyro.x,1)+",\"gz\":"+String(g.gyro.z,1)+",\"mpu\":"+String(mpu_v);
    json += String(",\"rover2\":{\"soil\":")+String(rover2.soil)+",\"dist\":"+String(rover2.dist)+",\"pwm\":"+String(rover2.pwm)+",\"state\":\""+rover2.state+"\",\"ts\":"+String(rover2.ts)+"}";
    json += String(",\"ts\":")+String(millis()/1000)+"}";
    return json;
  } else {
    String json = String("{\"t\":")+String(lastT,1)+",\"h\":"+String(lastH,1)+",\"dht\":"+String(dhtOk);
    json += String(",\"gas\":")+String(gasRaw)+",\"gasAlert\":"+String(gasAlert);
    json += String(",\"soil\":")+String(soilRaw)+",\"soilPct\":"+String(soilPct)+",\"soilDry\":"+String(soilDry);
    json += String(",\"ultra\":")+String(ultra)+",\"tilt\":0,\"ax\":0,\"ay\":0,\"az\":0,\"gx\":0,\"gz\":0,\"mpu\":0";
    json += String(",\"rover2\":{\"soil\":")+String(rover2.soil)+",\"dist\":"+String(rover2.dist)+",\"pwm\":"+String(rover2.pwm)+",\"state\":\""+rover2.state+"\"}");
    json += String(",\"ts\":")+String(millis()/1000)+"}";
    return json;
  }
}

void setup(){
  Serial.begin(115200); delay(500);
  Serial.println("\nDEMETER Rover1 Arduino Pico W — AP DEMETER-AP 192.168.4.1");

  pinMode(PIN_TRIG, OUTPUT); digitalWrite(PIN_TRIG, LOW);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_LED, OUTPUT);
  analogReadResolution(12); // 0-4095 for RP2040
  dht.begin();

  Wire.setSDA(PIN_SDA); Wire.setSCL(PIN_SCL); Wire.begin();
  if(!mpu.begin()){ Serial.println("MPU fail, scan..."); mpuOk=false; }
  else { mpu.setAccelerometerRange(MPU6050_RANGE_2_G); mpu.setGyroRange(MPU6050_RANGE_250_DEG); mpuOk=true; Serial.println("MPU ok"); }
  Wire.setClock(400000);

  WiFi.mode(WIFI_AP);
  // For Pico W, length of PASS <8 means open — use "" for open demo to match MicroPython
  if(strlen(AP_PASS) < 8) WiFi.softAP(AP_SSID);
  else WiFi.softAP(AP_SSID, AP_PASS, AP_CHANNEL);
  delay(500);
  IPAddress ip = WiFi.softAPIP();
  Serial.print("AP active: "); Serial.print(ip); Serial.print(" SSID "); Serial.println(AP_SSID);
  server.begin();
  Serial.println("Listening on 80 — GET /status /deploy?token=... POST /log");
}

void loop(){
  // AP LED blink
  static unsigned long ledLast=0; static bool ledState=false;
  if(millis()-ledLast>600){ ledState=!ledState; digitalWrite(PIN_LED, ledState); ledLast=millis(); }
  pollDHT();
  WiFiClient client = server.available();
  if(!client) return;
  client.setTimeout(2);
  String req = client.readStringUntil('\r');
  // consume remainder
  String headers=""; while(client.available()){ headers+= (char)client.read(); if(headers.endsWith("\r\n\r\n")) break; }
  String body=""; 
  // if POST, read body by Content-Length
  if(req.indexOf("POST /log")>=0){
    int cl=0; int idx=headers.indexOf("Content-Length:"); if(idx>=0) cl=headers.substring(idx+15).toInt();
    unsigned long s=millis(); while(body.length() < (unsigned)cl && millis()-s<800){ if(client.available()) body+=(char)client.read(); }
    // parse JSON like {"soil":680,"dist":120,"pwm":255,"state":"RUNNING"}
    int ss=body.indexOf("{"); int ee=body.lastIndexOf("}");
    if(ss>=0 && ee>ss){
      String j=body.substring(ss, ee+1);
      auto getInt=[&](const char* k){ int i=j.indexOf(String("\"")+k+"\""); if(i<0) return 0; int c=j.indexOf(":",i); int e=j.indexOf(",",c); int e2=j.indexOf("}",c); if(e<0||(e2>=0&&e2<e)) e=e2; return j.substring(c+1,e).toInt(); };
      auto getStr=[&](const char* k){ int i=j.indexOf(String("\"")+k+"\""); if(i<0) return String("IDLE"); int c=j.indexOf(":",i); int q1=j.indexOf("\"",c); int q2=j.indexOf("\"",q1+1); if(q1<0||q2<0) return String("IDLE"); return j.substring(q1+1,q2); };
      rover2.soil=getInt("soil"); rover2.dist=getInt("dist"); rover2.pwm=getInt("pwm"); rover2.state=getStr("state");
      // soilPct/dist sometimes named soil_pct etc
      if(rover2.soil==0){ int v=getInt("soil_pct"); if(v) rover2.soil=v; }
      rover2.ts=millis();
      Serial.print("LOG "); Serial.println(j);
    }
    httpResp(client, "OK", "text/plain");
  } else if(req.indexOf("GET /status")>=0 || req.indexOf("GET /api")>=0){
    String js = buildStatusJson();
    httpResp(client, js, "application/json");
  } else if(req.indexOf("GET /deploy")>=0){
    IPAddress ip = client.remoteIP();
    if(!checkRate(ip)) httpResp(client,"429 Too Many Requests","text/plain","429 Too Many Requests");
    else if(req.indexOf(DEPLOY_TOKEN)<0) httpResp(client,"401 Unauthorized","text/plain","401 Unauthorized");
    else { String r=triggerRover2("/deploy"); httpResp(client, String("Deployed Rover2: ")+r, "text/plain"); Serial.print("DEPLOY "); Serial.println(r); }
  } else if(req.indexOf("GET /stop")>=0){
    IPAddress ip = client.remoteIP();
    if(!checkRate(ip)) httpResp(client,"429 Too Many Requests","text/plain","429 Too Many Requests");
    else if(req.indexOf(DEPLOY_TOKEN)<0) httpResp(client,"401 Unauthorized","text/plain","401 Unauthorized");
    else { String r=triggerRover2("/stop"); httpResp(client, String("Stopped: ")+r, "text/plain"); }
  } else if(req.indexOf("OPTIONS")>=0){
    client.print("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n\r\n");
  } else {
    String html = String(DASHBOARD); // PROGMEM already in flash
    // send from PROGMEM via copy
    client.print("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n");
    client.print("Access-Control-Allow-Origin: *\r\nContent-Security-Policy: default-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net\r\n");
    client.print("X-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\n");
    client.print(String("Content-Length: ")+html.length()+"\r\nConnection: close\r\n\r\n");
    client.print(html);
  }
  delay(2); client.stop();
}
