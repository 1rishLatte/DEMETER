# ESP-01S AT Configuration for DEMETER Rover 1

ESP-01S must have AT firmware 1.7+ at 115200 baud (Ai-Thinker).

## One-time setup (via Uno passthrough or FTDI)

1. Wire Uno as USB-serial bridge (upload empty sketch, connect ESP TX->Uno D2, RX->Uno D6, 3.3V via AMS1117, GND common, ESP CH_PD->3.3V, GPIO0 floating, GPIO2 floating).

2. Open Serial Monitor 115200, line ending Both NL & CR.

3. Run:

```
AT
AT+GMR
AT+CWMODE=2
AT+CWSAP="DEMETER-AP","",1,0
AT+CIPMUX=1
AT+CIPSERVER=1,80
AT+CIPSTO=30
AT+CIFSR
```

Expect `192.168.4.1` for AP.

4. Test: connect phone to DEMETER-AP -> browser `http://192.168.4.1/` -> should get no data until Uno sketch runs.

## If 115200 garbled

```
AT+UART_DEF=9600,8,1,0,0
```

Then change `ESP_BAUD 9600` in `config.h` and reflash Uno.

## AT troubleshooting

- `AT` no reply -> check 3.3V (needs 300mA), GND, CH_PD high, baud.
- `+IPD` not seen -> check `AT+CIPMUX=1` and `AT+CIPSERVER=1,80`.
- `SEND OK` missing -> content length mismatch; check `AT+CIPSEND=<id>,<len>`.

## Security note

Use open AP for demo. For WPA2: `AT+CWSAP="DEMETER-AP","MyPass1234",1,3` and set `WIFI_AP_PASSWORD` in `config.h` placeholder only - do not commit real password.
