"""
DEMETER - Rover 1 Scout & Telemetry Hub (4WD chassis, Pico WH payload)
Controller: Raspberry Pi Pico WH (MicroPython)
Sensors: DHT11 GP16 (3.3V), MQ-135 GP26 ADC0 via 1k/2k divider 5V->3.3V, MPU-6050 I2C GP4/GP5 3.3V, HC-SR04 TRIG GP14 / ECHO GP15 via 1k/2k divider
Network: Hosts Wi-Fi AP DEMETER-AP (192.168.4.1) + HTTP server
         GET /        -> dashboard
         GET /status  -> JSON {t,h,gas,ultra,ax,ay,az,tilt}
         GET /deploy  -> triggers Rover2 via HTTP GET 192.168.4.2/deploy?token=DEMETER2026
         POST /log    -> receives Rover2 logs {soil,dist,pwm,state}
Wiring: DHT11 GP16 3.3V, MQ AO->divider->GP26 VCC 5V, MPU SDA GP4 SCL GP5 3.3V, HC-SR04 TRIG GP14 ECHO->divider->GP15 VCC 5V, LED onboard
Install: Thonny, MicroPython v1.22+ for Pico W, copy main.py + config.py to Pico
Secrets: No hardcoded creds - AP is open for demo; set AP_PASS if needed
"""

import network
import socket
import time
import json
from machine import Pin, ADC, I2C
import dht

# ---- Config ----
AP_SSID = "DEMETER-AP"
AP_PASS = "16042008"  # OPEN - matches your running Pico (image PASS: ''), no password needed
AP_CHANNEL = 1
ROVER2_IP = "192.168.4.2"
HTTP_PORT = 80

PIN_DHT = 16
PIN_GAS_ADC = 26  # GP26 = ADC0 via 1k/2k divider (MQ AO 5V->3.3V)
PIN_TRIG = 14     # HC-SR04 TRIG 3.3V->5V OK
PIN_ECHO = 15     # HC-SR04 ECHO via 1k/2k divider 5V->3.3V
PIN_LED = "LED"  # onboard, or 2

# ---- Hardware init ----
led = Pin(PIN_LED, Pin.OUT)
sensor_dht = dht.DHT11(Pin(PIN_DHT))
adc_gas = ADC(Pin(PIN_GAS_ADC))
pin_trig = Pin(PIN_TRIG, Pin.OUT)
pin_echo = Pin(PIN_ECHO, Pin.IN)
i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)
pin_trig.low()

# MPU-6050 minimal driver (register read)
MPU_ADDR = 0x68
mpu_ok = False
try:
    # Wake up MPU
    i2c.writeto_mem(MPU_ADDR, 0x6B, b'\x00')
    time.sleep_ms(100)
    mpu_ok = True
except:
    mpu_ok = False

latest_rover2_log = {"soil": 0, "dist": 0, "pwm": 0, "state": "IDLE", "ts": 0}

def read_mpu():
    if not mpu_ok:
        return {"ax":0,"ay":0,"az":0,"gx":0,"gy":0,"gz":0,"tilt":0,"ok":0}
    try:
        data = i2c.readfrom_mem(MPU_ADDR, 0x3B, 14)
        ax = (data[0]<<8|data[1])
        ay = (data[2]<<8|data[3])
        az = (data[4]<<8|data[5])
        gx = (data[8]<<8|data[9])
        gy = (data[10]<<8|data[11])
        gz = (data[12]<<8|data[13])
        # convert to signed
        def s16(v): return v-65536 if v>32767 else v
        ax,ay,az = s16(ax),s16(ay),s16(az)
        gx,gy,gz = s16(gx),s16(gy),s16(gz)
        # g units
        ax_g = ax/16384.0
        ay_g = ay/16384.0
        az_g = az/16384.0
        # tilt
        import math
        tilt = math.atan2(ay_g, az_g) * 57.2958 if az_g!=0 else 0
        return {"ax":round(ax_g,2),"ay":round(ay_g,2),"az":round(az_g,2),
                "gx":round(gx/131.0,1),"gy":round(gy/131.0,1),"gz":round(gz/131.0,1),
                "tilt":round(tilt,1),"ok":1}
    except:
        return {"ax":0,"ay":0,"az":0,"gx":0,"gy":0,"gz":0,"tilt":0,"ok":0}

def read_ultrasonic():
    # HC-SR04: 10us trigger, measure echo pulse width
    try:
        pin_trig.low()
        time.sleep_us(2)
        pin_trig.high()
        time.sleep_us(10)
        pin_trig.low()
        dur = machine.time_pulse_us(pin_echo, 1, 30000)  # timeout 30ms ~5m
        if dur < 0:
            return 9999
        dist_cm = dur * 0.0343 / 2
        if dist_cm < 2 or dist_cm > 400:
            return 9999
        return int(dist_cm * 10)  # mm
    except:
        return 9999

def read_sensors():
    # DHT11
    try:
        sensor_dht.measure()
        t = sensor_dht.temperature()
        h = sensor_dht.humidity()
        dht_ok = 1
    except:
        t, h, dht_ok = 0, 0, 0
    # Gas (via 1k/2k divider, recalibrated threshold ~400)
    raw = adc_gas.read_u16() >> 6  # 0-1023
    gas_alert = 1 if raw > 400 else 0  # was 600 without divider
    mpu = read_mpu()
    ultra = read_ultrasonic()
    return {
        "t": t, "h": h, "dht": dht_ok,
        "gas": raw, "gasAlert": gas_alert,
        "ultra": ultra,
        "ax": mpu["ax"], "ay": mpu["ay"], "az": mpu["az"],
        "gx": mpu["gx"], "gz": mpu["gz"], "tilt": mpu["tilt"], "mpu": mpu["ok"],
        "rover2": latest_rover2_log,
        "ts": int(time.ticks_ms()/1000)
    }

# ---- WiFi AP ----
ap = network.WLAN(network.AP_IF)
ap.active(False)
time.sleep_ms(500)
if AP_PASS == "":
    ap.config(essid=AP_SSID, channel=AP_CHANNEL)
    # open AP
else:
    ap.config(essid=AP_SSID, password=AP_PASS, channel=AP_CHANNEL)
ap.active(True)
while not ap.active():
    time.sleep_ms(100)
print("AP active:", ap.ifconfig(), "SSID:", AP_SSID, "PASS:", repr(AP_PASS))

# ---- HTTP helpers ----
DEPLOY_TOKEN = "DEMETER2026"
_rate = {}
def check_rate(ip):
    now = time.ticks_ms()
    lst = _rate.get(ip, [])
    lst = [t for t in lst if time.ticks_diff(now, t) < 10000]
    if len(lst) >= 5:
        _rate[ip]=lst
        return False
    lst.append(now); _rate[ip]=lst; return True

def http_response(conn, body, ctype="text/html", code="200 OK"):
    headers = [
        f"HTTP/1.1 {code}",
        f"Content-Type: {ctype}",
        "Access-Control-Allow-Origin: *",
        "Access-Control-Allow-Methods: GET, POST, OPTIONS",
        "Access-Control-Allow-Headers: Content-Type",
        "Content-Security-Policy: default-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "Strict-Transport-Security: max-age=31536000; includeSubDomains",
        "X-Frame-Options: DENY",
        "X-Content-Type-Options: nosniff",
        "Referrer-Policy: strict-origin-when-cross-origin",
        f"Content-Length: {len(body)}",
        "Connection: close", "", ""
    ]
    conn.send("\r\n".join(headers).encode())
    conn.send(body.encode() if isinstance(body,str) else body)

DASHBOARD = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DEMETER Scout 4WD — Manual Vib</title>
<style>*{box-sizing:border-box;font-family:system-ui}body{margin:0;background:#0f172a;color:#e2e8f0}
header{padding:16px;background:#1e293b;display:flex;justify-content:space-between}h1{margin:0;font-size:18px}.badge{padding:6px 10px;background:#22c55e;color:#000;border-radius:999px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;padding:16px}.card{background:#1e293b;border-radius:12px;padding:14px}.label{font-size:11px;opacity:.7;text-transform:uppercase}.value{font-size:22px;font-weight:700}.unit{font-size:11px;opacity:.6}
canvas{width:100%;height:180px;background:#0b1220;border-radius:8px} .status{padding:10px 16px;font-size:12px;opacity:.7}
button{padding:10px 16px;border:0;border-radius:8px;font-weight:600;cursor:pointer;margin-right:8px} .deploy{background:#22c55e} .stop{background:#ef4444;color:#fff}
</style><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body>
<header><h1>🌱 DEMETER — Scout Hub 4WD (Pico WH) + Rover2 ESP32 4WD</h1><span class="badge">192.168.4.1</span></header>
<div style="padding:12px 16px; display:flex; gap:8px; flex-wrap:wrap; align-items:center">
  <button class="deploy" onclick="fetch('/deploy?token=DEMETER2026').then(r=>r.text()).then(t=>alert(t))">🚀 Deploy (legacy)</button>
  <button class="stop" onclick="fetch('/stop?token=DEMETER2026').then(r=>r.text()).then(t=>alert(t))">⏹ Stop</button>
  <span style="opacity:.6">| Vib manual → Rover2 192.168.4.2:</span>
  <input id="vib" type="range" min="0" max="255" value="0" oninput="document.getElementById('vibv').textContent=this.value">
  <span id="vibv">0</span>
  <button onclick="let v=document.getElementById('vib').value; fetch('http://192.168.4.2/vibrate?pwm='+v).then(r=>r.text()).then(t=>alert(t)).catch(e=>alert('Rover2 not reachable: '+e))">Set Vib</button>
  <button onclick="fetch('http://192.168.4.2/stop').then(r=>r.text()).then(t=>alert(t))">Vib Stop</button>
</div>
<div class="grid">
 <div class="card"><div class="label">Temp</div><div class="value" id="t">--</div><div class="unit">°C DHT11 GP16</div></div>
 <div class="card"><div class="label">Humidity</div><div class="value" id="h">--</div><div class="unit">% (divider)</div></div>
 <div class="card"><div class="label">Gas MQ135</div><div class="value" id="gas">--</div><div class="unit"><span id="gasDot"></span> GP26 via 1k/2k</div></div>
 <div class="card"><div class="label">Ultra HC-SR04</div><div class="value" id="ultra">--</div><div class="unit">mm GP14/15</div></div>
 <div class="card"><div class="label">Tilt MPU6050</div><div class="value" id="tilt">--</div><div class="unit">deg GP4/5</div></div>
 <div class="card"><div class="label">Rover2 Soil</div><div class="value" id="soil">--</div><div class="unit">raw ESP32 33</div></div>
 <div class="card"><div class="label">Rover2 PWM</div><div class="value" id="pwm">--</div><div class="unit">/255 Vib 5</div></div>
</div>
<div style="padding:0 16px"><canvas id="chart" role="img" aria-label="Gas Soil PWM chart"></canvas></div>
<div class="status">Rover2: <span id="r2">--</span> | IR <span id="ir">--</span> | MPU <span id="mpu">--</span> DHT <span id="dht">--</span> Ultra <span id="ultraSt">--</span></div>
<script>
let ctx=document.getElementById('chart').getContext('2d');
let chart=new Chart(ctx,{type:'line',data:{labels:[],datasets:[
 {label:'Gas Scout',data:[],borderColor:'#f59e0b',tension:.3},
 {label:'Ultra mm',data:[],borderColor:'#a78bfa',tension:.3},
 {label:'Soil Rover2',data:[],borderColor:'#22c55e',tension:.3, yAxisID:'y1'},
 {label:'PWM',data:[],borderColor:'#38bdf8',tension:.3, yAxisID:'y1'}
]},options:{responsive:true,animation:false,scales:{y:{min:0,max:1023},y1:{position:'right',min:0,max:255,grid:{display:false}}}}});
let labels=[];
async function poll(){
 try{
  let j=await (await fetch('/status')).json();
  document.getElementById('t').textContent=j.t;
  document.getElementById('h').textContent=j.h;
  document.getElementById('gas').textContent=j.gas;
  document.getElementById('ultra').textContent=j.ultra==9999?'--':j.ultra;
  document.getElementById('tilt').textContent=j.tilt;
  document.getElementById('soil').textContent=j.rover2.soil;
  document.getElementById('pwm').textContent=j.rover2.pwm;
  document.getElementById('r2').textContent=j.rover2.state+' dist '+j.rover2.dist+'mm';
  document.getElementById('gasDot').textContent=j.gasAlert?' 🔴':' 🟢'; 
  let now=new Date().toLocaleTimeString();
  labels.push(now); if(labels.length>20){labels.shift(); chart.data.datasets.forEach(d=>d.data.shift());}
  chart.data.labels=labels;
  chart.data.datasets[0].data.push(j.gas);
  chart.data.datasets[1].data.push(j.ultra==9999?0:j.ultra);
  chart.data.datasets[2].data.push(j.rover2.soil);
  chart.data.datasets[3].data.push(j.rover2.pwm);
  chart.update();
 }catch(e){console.log(e)}
}
setInterval(poll,1000);poll();
</script></body></html>"""

def trigger_rover2(path="/deploy"):
    # Allowlist check (SSRF): only hardcoded ROVER2_IP
    if ROVER2_IP != "192.168.4.2":
        print("SSRF block: bad IP", ROVER2_IP)
        return "blocked"
    # append token
    if "?" in path: path = path + "&token=" + DEPLOY_TOKEN
    else: path = path + "?token=" + DEPLOY_TOKEN
    try:
        s = socket.socket()
        s.settimeout(2)
        s.connect((ROVER2_IP, 80))
        s.send(f"GET {path} HTTP/1.1\r\nHost: {ROVER2_IP}\r\nConnection: close\r\n\r\n".encode())
        resp = s.recv(1024)
        s.close()
        return resp.decode()[:200]
    except Exception as e:
        print("trigger_rover2 error", e)
        return "Rover2 not reachable"

# ---- Main loop: socket server ----
addr = socket.getaddrinfo('0.0.0.0', 80)[0][-1]
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(addr)
s.listen(2)
s.settimeout(0.5)
print("Listening on", addr)

while True:
    led.toggle()
    # handle one client with timeout
    try:
        cl, addr = s.accept()
        cl.settimeout(2)
        req = cl.recv(1024).decode('utf-8', 'ignore')
        if "GET /status" in req or "GET /api" in req:
            body = json.dumps(read_sensors())
            http_response(cl, body, "application/json")
        elif "GET /deploy" in req:
            ip = addr[0]
            if not check_rate(ip):
                http_response(cl, "429 Too Many Requests", "text/plain", "429 Too Many Requests")
            elif DEPLOY_TOKEN not in req:
                http_response(cl, "401 Unauthorized", "text/plain", "401 Unauthorized")
            else:
                r = trigger_rover2("/deploy")
                http_response(cl, f"Deployed Rover2: {r}", "text/plain")
                print("DEPLOY", r)
        elif "GET /stop" in req:
            ip = addr[0]
            if not check_rate(ip):
                http_response(cl, "429 Too Many Requests", "text/plain", "429 Too Many Requests")
            elif DEPLOY_TOKEN not in req:
                http_response(cl, "401 Unauthorized", "text/plain", "401 Unauthorized")
            else:
                r = trigger_rover2("/stop")
                http_response(cl, f"Stopped: {r}", "text/plain")
        elif "POST /log" in req:
            try:
                body = req.split("\r\n\r\n",1)[1]
                start = body.find("{")
                end = body.rfind("}")+1
                if start>=0 and end>start:
                    j = json.loads(body[start:end])
                    latest_rover2_log = j
                    print("LOG", j)
            except: pass
            http_response(cl, "OK", "text/plain")
        else:
            http_response(cl, DASHBOARD, "text/html")
        cl.close()
    except OSError as e:
        if e.args[0] not in (110, 116):
            print("accept error", e)
    except Exception as e:
        print("loop error", e)
        try:
            http_response(cl, '{"error":"Something went wrong"}', "application/json", "500 Internal Server Error")
        except: pass
        try: cl.close()
        except: pass
    time.sleep_ms(10)
