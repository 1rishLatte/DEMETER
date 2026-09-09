"use client";
// Easy link: poll Pico http://192.168.4.1/status and POST to /api/ingest
// One call: startPicoBridge() — handles queue, retry, and uses same /api/ingest as any curl

import type { PicoStatus } from "@/lib/telemetry";

type BridgeStatus = { ok: number; fail: number; last: string; queued: number };
let queue: PicoStatus[] = [];
if (typeof window !== "undefined") {
  try { queue = JSON.parse(localStorage.getItem("demeter_queue") ?? "[]"); } catch { queue = []; }
}
function saveQueue() { try { localStorage.setItem("demeter_queue", JSON.stringify(queue.slice(-50))); } catch {} }

export function startPicoBridge(intervalMs = 2000, onStatus?: (s: BridgeStatus) => void) {
  const picoUrl = process.env.NEXT_PUBLIC_PICO_URL ?? "http://192.168.4.1";
  let ok = 0, fail = 0, last = "idle";
  console.log("[bridge] start", picoUrl, intervalMs);

  const tick = async () => {
    try {
      const res = await fetch(`${picoUrl}/status`, { cache: "no-store" });
      if (!res.ok) throw new Error(`pico ${res.status}`);
      const json = (await res.json()) as PicoStatus;
      queue.push(json); saveQueue();

      // Flush queue (batch POST — easy link, one shape)
      const batch = [...queue];
      if (batch.length > 0) {
        const r = await fetch("/api/ingest", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch.length === 1 ? batch[0] : batch),
        });
        if (!r.ok) throw new Error(`ingest ${r.status} ${await r.text().then(t=>t.slice(0,120))}`);
        ok += batch.length; queue = []; saveQueue();
        last = `synced ${batch.length} (R1 soil ${json.soil ?? "-"} R2 pwm ${(json.rover2 as Record<string,unknown>)?.pwm ?? "-"})`;
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("Failed to fetch")) last = "not on DEMETER-AP (192.168.4.1 unreachable)";
      else { fail++; last = msg.slice(0, 90); }
    }
    onStatus?.({ ok, fail, last, queued: queue.length });
  };

  tick();
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
export function getQueueLen() { return queue.length; }
