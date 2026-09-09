"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { startPicoBridge } from "@/lib/bridge";
import type { Telem } from "@/lib/telemetry";
import { picoToTelem } from "@/lib/telemetry";
import { CROPS, type Crop, type Recommendation } from "@/lib/fertilizerAI";

gsap.registerPlugin(ScrollTrigger);

function useLiveTelem(mode: string, active: boolean) {
  const [liveTele, setLiveTele] = useState<Telem | null>(null);
  const [liveHistory, setLiveHistory] = useState<{ i:number; gas:number; ultraNorm:number; soilR1:number; soilR2:number; pwm:number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(()=>{
    if(mode !== "supabase" || !active) return;
    let cancelled=false;
    const load = async ()=>{
      try{
        const res = await fetch("/api/telemetry?limit=60", { cache:"no-store" });
        if(!res.ok){
          const txt = await res.text().then(t=>t.slice(0,300));
          throw new Error(`telemetry ${res.status}: ${txt}`);
        }
        const json = await res.json() as { data: Telem[]; error?: string };
        if(json.error) throw new Error(json.error);
        const data = json.data;
        if(cancelled) return;
        if(!data || data.length===0){ setError("No rows yet — click BRIDGE ON or POST to /api/ingest"); return; }
        setError(null);
        const last = data[data.length-1];
        setLiveTele(last);
        const norm = (v:number)=> v>=9999?0: Math.min(1023, Math.round(v*0.255));
        setLiveHistory(data.map((r: Telem, i:number)=>({ i, gas: r.gas, ultraNorm: norm(r.ultra), soilR1: r.soilR1, soilR2: r.rover2.soil, pwm: r.rover2.pwm })));
      }catch(e: unknown){
        const msg = e instanceof Error ? e.message : String(e);
        if(!cancelled) setError(msg);
        console.warn("supabase telemetry fetch failed", e);
      }
    };
    load();
    const id=setInterval(load, 2000);
    return ()=>{ cancelled=true; clearInterval(id); };
  },[mode, active]);
  useEffect(()=>{
    if(mode !== "pico" || !active) return;
    const picoUrl = process.env.NEXT_PUBLIC_PICO_URL ?? "http://192.168.4.1";
    let cancelled=false;
    let hist: { i:number; gas:number; ultraNorm:number; soilR1:number; soilR2:number; pwm:number }[] = [];
    const poll = async ()=>{
      try{
        const res = await fetch(`${picoUrl}/status`, { cache:"no-store" });
        if(!res.ok) throw new Error(`pico ${res.status} ${await res.text().then(t=>t.slice(0,60))}`);
        const j = await res.json() as import("@/lib/telemetry").PicoStatus;
        const t = picoToTelem(j);
        if(cancelled) return;
        setError(null);
        setLiveTele(t);
        const norm = t.ultra>=9999?0: Math.min(1023, Math.round(t.ultra*0.255));
        hist = [...hist.slice(-59), { i: hist.length, gas: t.gas, ultraNorm: norm, soilR1: t.soilR1, soilR2: t.rover2.soil, pwm: t.rover2.pwm }];
        setLiveHistory([...hist]);
      }catch(e: unknown){
        const msg = e instanceof Error ? e.message : String(e);
        if(String(msg).includes("Failed to fetch")) setError(`Cannot reach Pico ${picoUrl} — are you on DEMETER-AP WiFi? (${msg})`);
        else setError(msg);
      }
    };
    poll();
    const id=setInterval(poll, 1000);
    return ()=>{ cancelled=true; clearInterval(id); };
  },[mode, active]);
  const placeholder: Telem = { t: 0, h: 0, gas: 0, gasAlert: 0, ultra: 9999, tilt: 0, ax: 0, ay: 0, az: 0, soilR1: 0, soilPctR1: 0, soilDryR1: 0, mpu: 0, dht: 0, rover2: { soil: 0, soilPct: 0, dist: 9999, plant: 0, ir: "---", pwm: 0, state: "NO DATA", ts: 0 }, ts: 0, sessionId: "field-a" };
  return { tele: liveTele ?? placeholder, history: liveHistory, error };
}

const FARMS = {
  hero: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=1920&auto=format&fit=crop",
  deconstruct: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=1920&auto=format&fit=crop",
  telemetry: "https://images.unsplash.com/photo-1464226184884-fa280b87c399?q=80&w=1920&auto=format&fit=crop",
  specs: "https://images.unsplash.com/photo-1471193945509-9ad0617afabf?q=80&w=1920&auto=format&fit=crop",
};

export default function Page(){
  const dataSource = (process.env.NEXT_PUBLIC_DATA_SOURCE ?? "supabase") as "supabase"|"pico";
  const { tele, history, error } = useLiveTelem(dataSource, true);
  const heroRef = useRef<HTMLDivElement>(null);
  const [deploy, setDeploy] = useState(true);
  const [bridgeOn, setBridgeOn] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<{ok:number;fail:number;last:string;queued:number}>({ok:0,fail:0,last:"idle",queued:0});
  const [crop, setCrop] = useState<Crop>("paddy");
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [recInputs, setRecInputs] = useState<Record<string, unknown> | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [askQ, setAskQ] = useState("");
  const [askAns, setAskAns] = useState<string | null>(null);
  const [askLang, setAskLang] = useState<"en"|"hi">("en");
  const [askLoading, setAskLoading] = useState(false);
  useEffect(()=>{
    if(!bridgeOn) return;
    const stop = startPicoBridge(2000, setBridgeStatus);
    return stop;
  },[bridgeOn]);

  // AI recommend — real sensors, fake demo ranges, invoke LLM, store history
  useEffect(()=>{
    let cancelled=false;
    const fetchRec = async ()=>{
      setRecLoading(true);
      try{
        const res = await fetch(`/api/recommend?crop=${crop}`, { cache:"no-store" });
        const j = await res.json();
        if(!res.ok) throw new Error(j.error ?? "recommend failed");
        if(!cancelled){ setRec(j.recommendation); setRecInputs(j.inputs); }
      }catch(e){ console.warn("recommend fetch", e); }
      setRecLoading(false);
    };
    fetchRec();
    const id=setInterval(fetchRec, 5000);
    return ()=>{ cancelled=true; clearInterval(id); };
  },[crop]);

  const handleAsk = async ()=>{
    if(!askQ.trim()) return;
    setAskLoading(true); setAskAns(null);
    try{
      const res = await fetch("/api/ask", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ question: askQ, crop, lang: askLang }) });
      const j = await res.json();
      setAskAns(j.answer ?? j.error ?? "No answer");
    }catch(e){ setAskAns(String(e)); }
    setAskLoading(false);
  };

  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0,0.22], [1,0]);
  const heroY = useTransform(scrollYProgress, [0,0.22], [0,-40]);

  const specCards = useMemo(()=>[
    { k:"01", title:"Scout Rover — Pico WH", desc:"The field scout that maps the farm — it senses climate and soil moisture while creating the farm's Wi-Fi network and streaming live field data to your dashboard.", chips:["Live Scouting","Climate & Soil","Field Network"] },
    { k:"02", title:"Manual Vibrator — ESP32", desc:"A precision dosing unit you control. It delivers fertilizer only where needed, with adjustable flow and a quick stop for accurate placement.", chips:["Precision Dosing","Adjustable Flow","Quick Stop"] },
    { k:"03", title:"Precision Logic", desc:"Smart dosing that decides per plant — light in wet soil, strong when dry with a plant detected, and gradual levels in between. Two field zones demonstrate the contrast.", chips:["Per-Plant","Soil Aware","Field Proven"] },
    { k:"04", title:"Swarm Link", desc:"Both rovers work as a team. Your phone connects to the field network, starts the second rover, and both share live updates to the cloud dashboard.", chips:["Team Rovers","Phone Control","Live Cloud"] },
  ],[]);

  // GSAP — native scroll (Lenis disabled to keep fixed BG warp stable)
  useEffect(()=>{
    const ctx = gsap.context(()=>{
      // hero in
      gsap.fromTo(".hero-title span", { y: 36, opacity:0 }, { y:0, opacity:1, duration:0.85, stagger:0.06, ease:"power3.out", delay:0.12 });
      gsap.fromTo(".hero-meta", { y: 12, opacity:0 }, { y:0, opacity:1, duration:0.6, ease:"power2.out", delay:0.45 });

      // ——— PARALLAX DEPTH SYSTEM ———
      // layered parallax: slow (bg field), medium (cards), fast (accents) — true depth like reel
      gsap.utils.toArray<HTMLElement>(".parallax-slow").forEach((el)=>{
        gsap.fromTo(el, { y: 0 }, { y: -56, ease:"none", scrollTrigger:{ trigger: el, start:"top bottom", end:"bottom top", scrub: 1.2 } });
      });
      gsap.utils.toArray<HTMLElement>(".parallax-medium").forEach((el)=>{
        gsap.fromTo(el, { y: 0 }, { y: -28, ease:"none", scrollTrigger:{ trigger: el, start:"top bottom", end:"bottom top", scrub: 1 } });
      });
      gsap.utils.toArray<HTMLElement>(".parallax-fast").forEach((el)=>{
        gsap.fromTo(el, { y: 0 }, { y: -14, ease:"none", scrollTrigger:{ trigger: el, start:"top bottom", end:"bottom top", scrub: 0.9 } });
      });
      // per-section farmland depth — subtle yPercent (parallax-slow on img already handles)
      // hero title depth — each word different speed
      gsap.fromTo(".hero-title span:nth-child(1)", { y: 0 }, { y: -18, ease:"none", scrollTrigger:{ trigger: "#hero", start:"top top", end:"bottom top", scrub: 1 } });
      gsap.fromTo(".hero-title span:nth-child(3)", { y: 0 }, { y: -36, ease:"none", scrollTrigger:{ trigger: "#hero", start:"top top", end:"bottom top", scrub: 1 } });

      // reveal on scroll for all content blocks
      gsap.utils.toArray<HTMLElement>(".reveal").forEach((el)=>{
        gsap.fromTo(el, { y: 22, opacity:0 }, { y:0, opacity:1, duration:0.65, ease:"power2.out",
          scrollTrigger:{ trigger: el, start:"top 88%", toggleActions:"play none none reverse" }
        });
      });
      gsap.utils.toArray<HTMLElement>(".step-card").forEach((el, i)=>{
        gsap.fromTo(el, { y: 18, opacity:0 }, { y:0, opacity:1, duration:0.6, ease:"power2.out", delay: i*0.04,
          scrollTrigger:{ trigger: el, start:"top 90%", toggleActions:"play none none reverse" }
        });
      });

    });
    return ()=>{ ctx.revert(); };
  },[]);

  return (
    <div className="min-h-screen text-[#EADDC8] selection:bg-[#00674F] selection:text-[#EADDC8] overflow-x-hidden bg-[#191919]">
      {/* NAV — lighter veil */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-[#00674F]/15 bg-[#191919]/55 backdrop-blur-xl">
        <div className="mx-auto max-w-[1280px] px-5 sm:px-8 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-[#00674F] grid place-items-center text-[#EADDC8] font-black text-[11px] tracking-widest">DE</div>
            <span className="font-brittany text-[28px] leading-none text-[#EADDC8] tracking-[0.02em]">D.E.M.E.T.E.R</span>
            <span className="hidden sm:inline text-[10px] tracking-widest text-[#EADDC8]/50 ml-2">DYNAMIC ENVIRONMENTAL MAPPING</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-[11px] tracking-[0.16em] text-[#EADDC8]/60">
            <a href="#deconstruct" className="hover:text-[#EADDC8] transition">DECONSTRUCT</a>
            <a href="#telemetry" className="hover:text-[#EADDC8] transition">TELEMETRY</a>
            <a href="#specs" className="hover:text-[#EADDC8] transition">SPECS</a>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-2 text-[11px] tracking-widest">
              <span className={`size-2 rounded-full ${deploy?"bg-[#00674F] shadow-[0_0_14px_#00674F]":"bg-[#EADDC8]/20"} animate-pulse`} />
              <span className="text-[#EADDC8]/70">{deploy?"SWARM LINKED":"IDLE"}</span>
            </span>
            <button onClick={()=>setDeploy(v=>!v)} className={`h-9 px-5 rounded-full text-xs font-semibold tracking-wide transition ${deploy?"bg-[#EADDC8] text-[#191919] hover:bg-white":"bg-[#00674F] text-[#EADDC8] hover:bg-[#7a9a7a]"}`}>
              {deploy?"STOP SWARM":"DEPLOY ROVER 2"}
            </button>
          </div>
        </div>
      </nav>

      {/* HERO — per-section farmland warp */}
      <motion.section id="hero" ref={heroRef} style={{ opacity: heroOpacity, y: heroY }} className="relative z-10 pt-[108px] pb-10 overflow-hidden bg-[#191919]/28 backdrop-blur-[0.5px]">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={FARMS.hero} alt="" className="w-full h-full object-cover opacity-[0.22] scale-[1.04] will-change-transform parallax-slow" style={{filter:"sepia(0.12) saturate(0.95)"}} />
          <div className="absolute inset-0 bg-[#191919]/18" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_10%,rgba(104,135,99,0.22),transparent_70%),radial-gradient(700px_400px_at_10%_60%,rgba(245,241,224,0.06),transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 grain opacity-[0.06]" />
        <div className="mx-auto max-w-[1280px] px-5 sm:px-8 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 items-center">
          <div>
            <div className="hero-meta parallax-fast inline-flex items-center gap-2 rounded-full border border-[#00674F]/30 bg-[#00674F]/15 px-3 py-1.5 text-[11px] tracking-[0.18em] text-[#EADDC8]/80">
              <span className="size-1.5 rounded-full bg-[#00674F]" /> IOT + ROBOTICS · 2-ROVER SWARM · PICO WH + UNO/ESP32
            </div>
            <h1 className="hero-title mt-6 font-[--font-space] font-[700] leading-[0.88] tracking-[-0.04em] text-[42px] sm:text-[64px] lg:text-[72px] text-[#EADDC8]">
              <span className="block">PRECISION</span>
              <span className="block text-[#EADDC8]/55">GROWN.</span>
              <span className="block text-[#00674F]">NOT SPRAYED.</span>
            </h1>
            <p className="hero-meta mt-5 max-w-[560px] text-[15px] leading-7 text-[#EADDC8]/65">
              Rover 1 scouts and maps temperature, humidity, gas and micro-topography. Rover 2 follows the line and micro-doses fertilizer per plant — from <span className="text-[#EADDC8]">Pico WH</span> to <span className="text-[#EADDC8]">Uno + ESP32</span> in 100ms.
            </p>
            <div className="hero-meta mt-7 flex flex-wrap gap-3">
              <a href="#deconstruct" className="h-11 px-6 rounded-full bg-[#00674F] text-[#EADDC8] font-semibold text-sm grid place-items-center hover:bg-[#7a9a7a] transition">Explore the swarm — ↓</a>
              <a href="#telemetry" className="h-11 px-6 rounded-full border border-[#00674F]/30 bg-[#EADDC8]/5 font-medium text-sm grid place-items-center hover:bg-[#EADDC8]/10 transition text-[#EADDC8]">Watch live telemetry</a>
            </div>
            <div className="hero-meta parallax-slow mt-10 grid grid-cols-3 gap-3 max-w-[520px]">
              {[
                { v:"±0.5°C", k:"DHT11 · GP16", sub:"temp/hum" },
                { v:"≤200mm", k:"VL53L0X · A4/A5", sub:"plant detect" },
                { v:"0-255 PWM", k:"Vibrator · D5", sub:"dose control" },
              ].map(s=>(
                <div key={s.k} className="rounded-2xl border border-[#00674F]/20 bg-[#00674F]/10 p-4">
                  <div className="font-[--font-jet] text-sm font-semibold text-[#EADDC8]">{s.v}</div>
                  <div className="text-[11px] tracking-widest text-[#EADDC8]/60">{s.k}</div>
                  <div className="text-[11px] text-[#EADDC8]/40">{s.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* hero visual — parallax medium depth */}
          <div className="parallax-medium relative lg:h-[560px] h-[420px] rounded-[28px] border border-[#00674F]/20 bg-gradient-to-b from-[#00674F]/15 to-[#191919]/60 p-4 sm:p-6 overflow-hidden will-change-transform" style={{ transform:"translateZ(0)" }}>
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(245,241,224,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(245,241,224,0.04)_1px,transparent_1px)] bg-[size:28px_28px] opacity-20" />
            <div className="absolute top-4 left-4 flex items-center gap-2 text-[11px] tracking-[0.16em] text-[#EADDC8]/60"><span className="size-2 rounded-full bg-[#00674F] animate-pulse" /> DEMETER-AP · 192.168.4.1</div>
            <div className="absolute top-4 right-4 text-[10px] tracking-widest text-[#EADDC8]/40 border border-[#00674F]/20 rounded-full px-3 py-1">PICO WH + ESP32 BRIDGE</div>
            <div className="relative h-full grid place-items-center">
              <div className="w-full max-w-[420px] space-y-4 will-change-transform parallax-slow" style={{ transform: "translateZ(0)" }}>
                <div className="rounded-2xl bg-[#EADDC8] border border-[#00674F]/20 p-4 flex gap-4 items-center shadow-[0_8px_30px_rgba(10,58,35,0.25)] parallax-fast">
                  <div className="size-14 rounded-xl bg-[#00674F] grid place-items-center text-[#EADDC8] font-black">R1</div>
                  <div>
                    <div className="font-semibold text-sm text-[#191919]">SCOUT — Pico WH</div>
                    <div className="text-xs text-[#191919]/60">DHT11 · MQ-135 · MPU-6050 · AP host</div>
                    <div className="mt-2 flex gap-2 text-[11px] font-mono"><span className="px-2 py-1 rounded bg-[#00674F] text-[#EADDC8]">{tele.t}°C</span><span className="px-2 py-1 rounded bg-[#191919]/10 text-[#191919]">{tele.h.toFixed(3)}%</span><span className={`px-2 py-1 rounded ${tele.gasAlert?"bg-red-600 text-white":"bg-[#191919]/10 text-[#191919]"}`}>{tele.gas} gas</span></div>
                  </div>
                </div>
                <div className="h-6 flex justify-center"><div className="w-px h-full bg-[#00674F]/30" /><div className="absolute text-[10px] tracking-widest bg-[#EDE9D9] px-2 -mt-1 text-[#191919]/50 rounded-full border border-[#00674F]/20">UART 115200 · WiFi 192.168.4.2</div></div>
                <div className={`rounded-2xl border p-4 flex gap-4 items-center transition ${tele.rover2.pwm>0?"bg-[#00674F] text-[#EADDC8] border-[#00674F] shadow-[0_8px_24px_rgba(104,135,99,0.4)]":"bg-[#EADDC8] border-[#00674F]/15 text-[#191919]"}`}>
                  <div className={`size-14 rounded-xl grid place-items-center font-black ${tele.rover2.pwm>0?"bg-[#191919] text-[#EADDC8]":"bg-[#00674F]/15 text-[#191919]"}`}>R2</div>
                  <div>
                    <div className="font-semibold text-sm">DOSER — Uno + ESP32</div>
                    <div className={`text-xs ${tele.rover2.pwm>0?"text-[#EADDC8]/70":"text-[#191919]/60"}`}>VL53 A4/A5 · Soil A0 · IR D4/D8/D9 · Vib D5</div>
                    <div className="mt-2 flex gap-2 text-[11px] font-mono">
                      <span className={`px-2 py-1 rounded ${tele.rover2.pwm>0?"bg-[#191919] text-[#EADDC8]":"bg-[#191919]/10 text-[#191919]"}`}>soil {tele.rover2.soil}</span>
                      <span className={`px-2 py-1 rounded border ${tele.rover2.pwm>0?"bg-white/10 border-white/20 text-[#EADDC8]":"bg-[#191919]/5 border-[#191919]/10 text-[#191919]"}`}>dist {tele.rover2.dist>8000?"—":tele.rover2.dist+"mm"}</span>
                      <span className={`px-2 py-1 rounded font-bold ${tele.rover2.pwm>0?"bg-[#EADDC8] text-[#191919]":"bg-[#00674F] text-[#EADDC8]"}`}>PWM {tele.rover2.pwm}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-[#EADDC8]/60 px-1">
                  <span>STATE {tele.rover2.state}</span><span className={tele.rover2.pwm>0?"text-[#00674F] font-bold":""}>● LIVE 1.0s</span>
                </div>
              </div>
            </div>
            <div className="absolute bottom-4 inset-x-4 flex gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-[#191919]/20 overflow-hidden border border-[#191919]/10"><div className="h-full bg-[#00674F] transition-all duration-700" style={{ width: `${tele.rover2.soilPct}%`}} /></div>
              <span className="text-[11px] font-mono text-[#EADDC8]/70">{tele.rover2.soilPct}% dry</span>
            </div>
          </div>
        </div>
      </motion.section>

      {/* DECONSTRUCT — per-section forest */}
      <section id="deconstruct" className="relative z-10 border-y border-[#EADDC8]/10 bg-[#7A6A2E]/48 backdrop-blur-[2px] overflow-hidden">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={FARMS.deconstruct} alt="" className="w-full h-full object-cover opacity-[0.18] scale-[1.04] will-change-transform parallax-slow" style={{filter:"sepia(0.14) saturate(0.9)"}} />
          <div className="absolute inset-0 bg-[#191919]/10" />
        </div>
        <div className="mx-auto max-w-[1280px] px-5 sm:px-8 py-12 lg:py-16 grid lg:grid-cols-[0.95fr_1.05fr] gap-8 items-start">
          {/* left: sticky visual + header — parallax slow */}
          <div className="lg:sticky lg:top-[80px] space-y-6 parallax-slow">
            <div className="text-[11px] tracking-[0.22em] text-[#EADDC8]/80">● SCROLL TO EXPLORE · FULLY SCROLLABLE · 60FPS TRANSFORMS</div>
            <h2 className="font-[--font-space] text-[30px] sm:text-[42px] font-bold leading-none tracking-tight text-[#EADDC8]">
              TWO ROVERS.<br/><span className="text-[#191919]">ONE FIELD.</span><br/><span className="text-[#EADDC8]">ZERO WASTE.</span>
            </h2>
            <p className="text-sm leading-6 text-[#EADDC8]/75 max-w-[420px]">Scroll controls the reveal — no pin lock, entire page flows. Each layer uses <span className="text-[#EADDC8] font-medium">translate3d</span> for butter-smooth scrub.</p>

            <div className="relative h-[380px] sm:h-[420px] rounded-[24px] border border-[#191919]/15 bg-[#EADDC8] overflow-hidden p-6 grain shadow-[0_20px_60px_rgba(10,58,35,0.18)] will-change-transform">
              <div className="absolute inset-0 bg-[radial-gradient(600px_300px_at_50%_0%,rgba(104,135,99,0.18),transparent_70%)]" />
              <div className="absolute inset-0 grid place-items-center">
                <div className="relative w-[320px] h-[180px]">
                  <div className="absolute inset-0 rounded-[18px] border border-[#191919]/10 bg-gradient-to-b from-[#191919]/5 to-transparent" />
                  <div className="absolute inset-2 rounded-[14px] border border-[#00674F]/20 bg-white" />
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-6 flex gap-3">
                    <span className="size-7 rounded-full bg-[#00674F]/20 border border-[#00674F]/30" /><span className="size-7 rounded-full bg-[#00674F]/20 border border-[#00674F]/30" />
                  </div>
                  <div className="absolute top-6 left-6 right-6 h-10 rounded-full border border-[#00674F]/20 bg-[#00674F]/10 grid place-items-center text-[10px] tracking-[0.2em] text-[#191919] font-semibold">CHASSIS · L298P D3/D11 D13/D12</div>
                </div>
              </div>
              <div className="absolute top-6 inset-x-6 flex gap-2 justify-center">
                <div className="rounded-xl bg-[#00674F] text-[#EADDC8] px-3 py-2 text-xs font-bold shadow">DHT11<span className="block text-[10px] font-normal opacity-80">GP16 · {tele.t}°C {tele.h}%</span></div>
                <div className="rounded-xl bg-[#191919] text-[#EADDC8] px-3 py-2 text-xs font-bold">MQ-135<span className="block text-[10px] font-normal opacity-70">GP26 · {tele.gas}</span></div>
                <div className="rounded-xl bg-white border border-[#00674F]/20 text-[#191919] px-3 py-2 text-xs font-bold">MPU-6050<span className="block text-[10px] font-normal text-[#191919]/60">GP4/5 · {tele.tilt}°</span></div>
              </div>
              <div className="absolute bottom-6 inset-x-6 flex gap-2 justify-center">
                <div className="rounded-xl bg-[#191919] text-[#EADDC8] border border-[#191919] px-3 py-2 text-xs">VL53L0X<span className="block font-mono text-[#EADDC8]/80 text-[11px]">{tele.rover2.dist>8000?"—":tele.rover2.dist+"mm"} · IR {tele.rover2.ir}</span></div>
                <div className="rounded-xl bg-[#00674F] text-[#EADDC8] px-3 py-2 text-xs font-bold">Soil A0<span className="block text-[11px] opacity-90">{tele.rover2.soil} · {tele.rover2.soilPct}%</span></div>
                <div className="rounded-xl bg-[#EADDC8] border border-[#191919]/10 text-[#191919] px-3 py-2 text-xs font-bold">Vibrator D5<span className="block text-[11px] font-mono">PWM {tele.rover2.pwm}</span></div>
              </div>
              <div className="absolute bottom-3 inset-x-3 flex justify-between text-[9px] tracking-widest font-mono text-[#191919]/50">
                <span className="rounded-full border border-[#00674F]/15 bg-white px-2.5 py-1">PICO WH · MicroPython</span>
                <span className="rounded-full border border-[#00674F]/15 bg-white px-2.5 py-1">ESP32 16/17 · UNO D2/D6</span>
              </div>
            </div>
          </div>

          {/* right: alternating steps — parallax fast for depth */}
          <div className="space-y-5 sm:space-y-6 parallax-medium">
            {[
              { n:"01", title:"Scout & Map", body:"Rover 1 crawls the field hosting DEMETER-AP. DHT11 reads canopy temp/humidity, MQ-135 sniffs gas, MPU-6050 maps micro-topography — streamed to /status at 10Hz.", pin:"GP16/GP26/GP4-5", align:"left" },
              { n:"02", title:"Detect — Plant or Pass", body:"Rover 2's VL53L0X (A4/A5) ranges <200mm = plant. Soil cap A0: wet 250-350, dry 650-850. IR D4/D8/D9 holds the line. No plant → dose 0 in 100ms.", pin:"A4/A5 · A0 · D4/8/9", align:"right" },
              { n:"03", title:"Decide — Per-Plant PWM", body:"Wet or no-plant → 0. Dry + plant → 255 blast. In-between → 40→180 lerp. Demo: Zone A (dry 680, 120mm) heavy, Zone B (wet 300, —) silent.", pin:"D5 PWM · 1k/2k divider", align:"left" },
              { n:"04", title:"Dose — Vibrator Precision", body:"D5 MOSFET drives vibrator, 1N4007-protected, 1000µF on 3.3V. Dashboard chart: gas vs soil/pwm inverse — the jury wow.", pin:"D3/D11 · 1000µF", align:"right" },
            ].map((s)=>(
              <div key={s.n} className={`step-card parallax-fast relative rounded-[20px] border border-[#191919]/10 bg-[#EADDC8] p-6 sm:p-7 shadow-[0_8px_30px_rgba(10,58,35,0.12)] will-change-transform ${s.align==="right"?"lg:ml-8":"lg:mr-8"}`} style={{ transform:"translateZ(0)"}}>
                <div className="flex items-center gap-3 text-[#00674F] font-mono text-xs tracking-widest"><span className="size-7 rounded-full bg-[#191919] text-[#EADDC8] grid place-items-center font-bold text-xs">{s.n}</span> STEP {s.n}</div>
                <h3 className="mt-3 font-[--font-space] text-[20px] font-semibold tracking-tight text-[#191919]">{s.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#191919]/65">{s.body}</p>
                <div className="mt-4 text-[11px] font-mono text-[#191919]/40">PINS · {s.pin}</div>
              </div>
            ))}
            <div className="step-card rounded-[16px] border border-[#191919]/15 bg-[#191919] p-4 text-[#EADDC8] text-xs leading-5 will-change-transform">
              Entire section is <span className="font-semibold">standard smooth scroll</span> — no pin, no lock. Alternating cards slide in on scroll, sticky visual tracks with `translate3d`. Mobile scales gracefully.
            </div>
          </div>
        </div>
      </section>

      {/* TELEMETRY — per-section drone farmland */}
      <section id="telemetry" className="relative z-10 border-t border-[#00674F]/12 bg-[#191919]/38 backdrop-blur-[2px] overflow-hidden">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={FARMS.telemetry} alt="" className="w-full h-full object-cover opacity-[0.20] scale-[1.04] will-change-transform parallax-slow" style={{filter:"sepia(0.1) saturate(0.95)"}} />
          <div className="absolute inset-0 bg-[#191919]/15" />
        </div>
        <div className="mx-auto max-w-[1280px] px-5 sm:px-8 py-10 sm:py-14">
          <div className="flex flex-wrap gap-4 items-end justify-between reveal">
            <div>
              <div className="text-[11px] tracking-[0.2em] text-[#00674F]">● LIVE TELEMETRY · MOCK NOW · PICO LATER</div>
              <h2 className="font-[--font-space] text-[28px] sm:text-[36px] font-bold tracking-tight text-[#EADDC8]">Field data, not guesswork.</h2>
              <p className="text-sm text-[#EADDC8]/60 max-w-[560px]">Toggle <span className="text-[#EADDC8]">NEXT_PUBLIC_DATA_SOURCE=pico</span> to fetch <span className="font-mono text-[#EADDC8]">http://192.168.4.1/status</span> directly. History is local 60-point ring.</p>
            </div>
          <div className="flex gap-2 flex-wrap items-center">
              <span className="self-center text-[10px] tracking-widest px-2 py-1 rounded-full border border-[#00674F]/20 bg-[#191919]/30">SRC: {dataSource} {!bridgeOn && dataSource==="supabase" ? "(needs BRIDGE)" : ""}</span>
              <button onClick={()=>setBridgeOn(v=>!v)} className={`h-10 px-4 rounded-full font-semibold text-xs transition ${bridgeOn?"bg-[#00674F] text-white":"bg-[#EADDC8]/10 text-[#EADDC8] border border-[#EADDC8]/15"}`}>{bridgeOn?`BRIDGE ON • ${bridgeStatus.queued}Q`:"BRIDGE OFF"}</button>
              {bridgeOn && <span className="text-[11px] font-mono text-[#EADDC8]/60 max-w-[260px] truncate">{bridgeStatus.last}</span>}
              <button onClick={()=>setDeploy(true)} className={`h-10 px-5 rounded-full font-semibold text-sm transition ${deploy?"bg-[#00674F] text-[#EADDC8]":"bg-[#EADDC8]/10 text-[#EADDC8] border border-[#EADDC8]/15"}`}>RUNNING</button>
              <button onClick={()=>setDeploy(false)} className={`h-10 px-5 rounded-full font-semibold text-sm transition ${!deploy?"bg-[#EADDC8] text-[#191919]":"bg-[#EADDC8]/10 text-[#EADDC8] border border-[#EADDC8]/15"}`}>IDLE</button>
              <div className="flex gap-1.5 items-center ml-2 pl-3 border-l border-[#EADDC8]/15">
                <span className="text-[10px] tracking-widest text-[#EADDC8]/50">CROP:</span>
                {CROPS.map(c=>(
                  <button key={c.id} onClick={()=>setCrop(c.id)} className={`h-7 px-3 rounded-full text-xs font-semibold transition ${crop===c.id?"bg-[#EADDC8] text-[#191919]":"bg-[#00674F]/20 text-[#EADDC8] hover:bg-[#00674F]/30"}`}>{c.icon} {c.label}</button>
                ))}
              </div>
            </div>
            {error && <div className="mt-2 text-xs bg-red-500/20 border border-red-500/30 text-red-200 px-3 py-2 rounded-xl">❌ {error} — check <a href="/api/health" target="_blank" className="underline">/api/health</a> · {dataSource==="pico" ? "Are you on DEMETER-AP WiFi? Pico URL: "+(process.env.NEXT_PUBLIC_PICO_URL ?? "http://192.168.4.1") : "Vercel env NEXT_PUBLIC_SUPABASE_URL set? Try NEXT_PUBLIC_DATA_SOURCE=pico"}</div>}
            {tele.rover2.state==="NO DATA" && !error && <div className="mt-2 text-xs bg-amber-500/20 border border-amber-500/30 text-amber-200 px-3 py-2 rounded-xl">⚠️ No live Supabase rows — click BRIDGE ON while on DEMETER-AP (192.168.4.1) + phone USB tether, or set NEXT_PUBLIC_DATA_SOURCE=pico for direct Pico poll</div>}
            {tele.t===0 && tele.gas===0 && !error && <div className="mt-2 text-xs bg-red-500/20 border border-red-500/30 text-red-200 px-3 py-2 rounded-xl">🔧 Wiring check: t:0 h:0 dht:0 → DHT11 GP16 needs 10k→3.3V + 3.3V VCC; ax:0 mpu:0 → MPU6050 GP4/5 SDA/SCL swapped? Print i2c.scan() in Thonny should show [104]</div>}
            {dataSource==="supabase" && history.length===0 && !bridgeOn && tele.rover2.state!=="NO DATA" && !error && <div className="mt-2 text-xs text-[#EADDC8]/60">No live rows yet — click BRIDGE ON while on DEMETER-AP (192.168.4.1) + internet (USB tether)</div>}
            {bridgeOn && bridgeStatus.last.includes("not on DEMETER-AP") && <div className="mt-2 text-xs text-amber-300">→ Keep WiFi on DEMETER-AP (192.168.4.1), add internet via phone USB tether (not WiFi). Then http://192.168.4.1/status will be reachable.</div>}
            {bridgeOn && bridgeStatus.queued>0 && <div className="mt-2 text-xs text-amber-300">Offline — queued {bridgeStatus.queued} — will upload when internet returns</div>}
          </div>

          <div className="mt-8 grid grid-cols-2 lg:grid-cols-6 gap-3 parallax-slow">
            {[
              { label:"Temp", value:`${tele.t}`, unit:"°C", sub:"DHT11 GP16", ok:true },
              { label:"Humidity", value:`${tele.h.toFixed(1)}`, unit:"%", sub:"DHT11", ok:true },
              { label:"Gas", value:`${tele.gas}`, unit:tele.gasAlert?"🔴 alert":"🟢 ok", sub:"MQ-135 GP26 via 1k/2k", ok:!tele.gasAlert },
              { label:"Soil R1", value:`${tele.soilR1}`, unit:`${tele.soilDryR1?"🏜️":"💧"} ${tele.soilPctR1}%`, sub:"Hygro GP27 3.3V→probe→10k", ok:!tele.soilDryR1 },
              { label:"Ultra", value:`${tele.ultra===9999?"—":tele.ultra}`, unit:"mm", sub:"HC-SR04 GP14/15", ok: tele.ultra!==9999 },
              { label:"Tilt", value:`${tele.tilt}`, unit:"deg", sub:"MPU GP4/5", ok:true },
            ].map(c=>(
              <div key={c.label} className="reveal parallax-fast rounded-2xl border border-[#00674F]/20 bg-[#00674F]/10 p-4 will-change-transform" style={{ transform:"translateZ(0)"}}>
                <div className="text-[10px] tracking-[0.16em] text-[#EADDC8]/55">{c.label}</div>
                <div className="mt-1 font-[--font-space] text-[26px] font-bold leading-none text-[#EADDC8]">{c.value}<span className="text-xs font-normal text-[#EADDC8]/50 ml-1">{c.unit}</span></div>
                <div className={`mt-2 text-[11px] font-mono ${c.ok?"text-[#00674F]":"text-[#EADDC8]/40"}`}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* AI Fertilizer — advice only, 2 crops, real sensors, invoke LLM, history stored */}
          <div className="reveal rounded-2xl border border-[#00674F]/30 bg-gradient-to-br from-[#EADDC8] to-[#EDE9D9] p-4 sm:p-6 will-change-transform" style={{ transform:"translateZ(0)"}}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#00674F] animate-pulse" />
                <div className="text-sm font-bold text-[#191919]">AI Fertilizer Advisor <span className="text-xs font-normal text-[#191919]/60">— {crop.toUpperCase()} · advice only</span></div>
              </div>
              <span className="text-[11px] font-mono text-[#191919]/40">{recLoading ? "thinking..." : rec ? `${rec.fertilizer_amount_category} · ${rec.fertilizer_amount_range_kg_per_ha}` : "waiting telemetry"}</span>
            </div>
            {rec ? (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {rec.fertilizer_types.map(t=> <span key={t} className="rounded-full bg-[#191919] text-[#EADDC8] px-3 py-1 text-xs font-semibold">{t}</span>)}
                  <span className="rounded-full border border-[#00674F]/30 bg-[#00674F]/10 px-3 py-1 text-xs font-mono text-[#191919]">{rec.fertilizer_amount_range_kg_per_ha}</span>
                  <span className="rounded-full border border-[#191919]/10 px-3 py-1 text-[11px] font-mono text-[#191919]/60">N:{rec.N_need_level} PK:{rec.PK_need_level} Vol:{rec.volatilization_potential}</span>
                </div>
                {/* Novelty: health + cost + trend */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-[#191919] text-[#EADDC8] p-3">
                    <div className="text-[10px] tracking-widest opacity-60">HEALTH</div>
                    <div className="text-lg font-bold">{rec.health_score ?? 0}<span className="text-xs font-normal">/100</span></div>
                    <div className="h-1.5 bg-[#EADDC8]/20 rounded-full mt-1"><div className="h-full bg-[#00674F] rounded-full" style={{ width:`${rec.health_score ?? 0}%` }} /></div>
                  </div>
                  <div className="rounded-xl border border-[#00674F]/20 bg-white p-3">
                    <div className="text-[10px] tracking-widest text-[#191919]/60">COST</div>
                    <div className="text-sm font-bold text-[#191919]">{rec.cost_estimate_inr_per_ha ?? "—"}</div>
                    <div className="text-[11px] text-[#191919]/50">{rec.trend_summary ?? ""}</div>
                  </div>
                  <div className="rounded-xl border border-[#00674F]/20 bg-white p-3">
                    <div className="text-[10px] tracking-widest text-[#191919]/60">YIELD</div>
                    <div className="text-sm font-bold text-[#191919]">{rec.yield_prediction ?? "—"}</div>
                    <div className="text-[11px] text-[#191919]/50">{rec.soil_moisture_status} • {rec.canopy_density}</div>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {rec.management_advice.map((m,i)=> <li key={i} className="text-xs leading-5 text-[#191919]/75 flex gap-2"><span className="text-[#00674F]">•</span><span>{m}</span></li>)}
                </ul>
                <div className="text-[11px] font-mono text-[#191919]/40">Inputs: soil {recInputs ? String((recInputs as Record<string, unknown>).soil_moisture_percent)+`%` : `${tele.soilPctR1}%`} · gas {String((recInputs as Record<string, unknown>)?.mq135_gas_reading ?? tele.gas)} · ultra {Math.round(tele.ultra/10)}cm · {tele.h.toFixed(0)}% {tele.t}°C · canopy:{rec.canopy_density} moisture:{rec.soil_moisture_status}</div>
                <div className="text-[10px] text-[#191919]/40 italic">{rec.notes[0]}</div>
                <div className="flex gap-2">
                  <a href="/api/recommend?crop=paddy&history=10" target="_blank" className="text-[11px] font-mono text-[#00674F] underline">History → /api/recommend</a>
                  <span className="text-[11px] font-mono text-[#191919]/30">Gemini {process.env.NEXT_PUBLIC_GEMINI_MODEL ?? "1.5-flash"} {typeof rec.health_score==="number" ? "• AI" : ""}</span>
                </div>
                {/* Chat */}
                <div className="rounded-xl border border-[#191919]/10 bg-white p-3 space-y-2">
                  <div className="text-xs font-semibold text-[#191919]">Ask Farmer Assistant — Gemini</div>
                  <div className="flex gap-2">
                    <input value={askQ} onChange={e=> setAskQ(e.target.value)} placeholder={askLang==="hi" ? "पूछें: क्या आज सिंचाई करूँ?" : "Ask: Should I irrigate today?"} className="flex-1 rounded-full border border-[#191919]/15 px-3 py-2 text-xs outline-none" />
                    <select value={askLang} onChange={e=> setAskLang(e.target.value as never)} className="rounded-full border border-[#191919]/15 px-2 text-xs"><option value="en">EN</option><option value="hi">HI</option></select>
                    <button onClick={handleAsk} disabled={askLoading} className="rounded-full bg-[#191919] text-[#EADDC8] px-4 text-xs font-semibold disabled:opacity-50">{askLoading ? "..." : "Ask"}</button>
                  </div>
                  {askAns && <div className="rounded-xl bg-[#00674F]/10 p-3 text-xs leading-5 text-[#191919] whitespace-pre-wrap">{askAns}</div>}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-[#191919]/60">{recLoading ? "Generating with Gemini..." : "Waiting for telemetry… click BRIDGE ON if SRC:supabase"}</div>
            )}
            <div className="mt-2 text-[10px] font-mono text-[#191919]/30">Real sensors only · fake demo ranges · Gemini 1.5-flash · stored to demeter_recommendations</div>
          </div>

          <div className="mt-6 grid lg:grid-cols-[1.4fr_0.6fr] gap-4">
            <div className="reveal rounded-2xl border border-[#00674F]/20 bg-[#EADDC8] p-4 sm:p-6 will-change-transform" style={{ transform:"translateZ(0)"}}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-[#191919]">Gas / Soil R1 GP27 vs Ultra (live)</div>
                <span className="text-[11px] font-mono text-[#191919]/50">60 pts · 1s poll · {dataSource} · Rover1 only</span>
              </div>
              <div className="mt-4 h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <XAxis dataKey="i" hide />
                    <YAxis domain={[0,1023]} hide />
                    <Tooltip contentStyle={{ background:"#EADDC8", border:"1px solid rgba(10,58,35,0.12)", borderRadius:12, fontSize:12, color:"#191919" }} formatter={(value: unknown, name: unknown)=> String(name)==="ultraNorm"? [`${Math.round((Number(value))/0.255)}mm`, "Ultra"] : [value as string, String(name)]} />
                    <Line type="monotone" dataKey="gas" stroke="#191919" strokeWidth={2} dot={false} name="Gas" />
                    <Line type="monotone" dataKey="ultraNorm" stroke="#3D4A2E" strokeWidth={2} dot={false} name="ultraNorm" />
                    <Line type="monotone" dataKey="soilR1" stroke="#00674F" strokeWidth={2.2} dot={false} name="Soil R1 GP27" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-mono text-[#191919]/60"><span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#191919]" />Gas 0-1023</span><span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#3D4A2E]" />Ultra (norm)</span><span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#00674F]" />Soil R1 GP27</span></div>
            </div>
            <div className="reveal rounded-2xl border border-[#00674F]/20 bg-[#00674F]/10 p-5 will-change-transform" style={{ transform:"translateZ(0)"}}>
              <div className="text-sm font-semibold text-[#EADDC8]">Live Rover1 Only</div>
              <div className="mt-4 space-y-3">
                <div className={`rounded-xl border p-3 flex justify-between items-center ${tele.soilDryR1?"border-amber-500/50 bg-amber-500/10":"border-[#00674F]/50 bg-[#00674F]/20"}`}>
                  <div><div className="text-xs font-bold text-[#EADDC8]">Soil R1 Hygro GP27</div><div className="text-[11px] font-mono text-[#EADDC8]/60">raw {tele.soilR1} · {tele.soilPctR1}% {tele.soilDryR1?"🏜️ dry":"💧 wet"}</div></div><span className="text-xs font-bold text-[#00674F]">{tele.soilPctR1}%</span>
                </div>
                <div className={`rounded-xl border p-3 flex justify-between items-center ${tele.gas>400?"border-[#00674F]/50 bg-[#00674F]/20":"border-[#EADDC8]/15 opacity-60"}`}>
                  <div><div className="text-xs font-bold text-[#EADDC8]">Gas MQ135 GP26</div><div className="text-[11px] font-mono text-[#EADDC8]/60">raw {tele.gas} · alert {tele.gasAlert?"🔴":"🟢"}</div></div><span className="text-xs font-bold text-[#00674F]">{tele.gas} </span>
                </div>
                <div className={`rounded-xl border p-3 flex justify-between items-center ${tele.ultra!==9999 && tele.ultra<800?"border-[#00674F]/50 bg-[#00674F]/20":"border-[#EADDC8]/15 opacity-60"}`}>
                  <div><div className="text-xs font-bold text-[#EADDC8]">Ultra HC-SR04 GP14/15</div><div className="text-[11px] font-mono text-[#EADDC8]/60">dist {tele.ultra===9999?"—":tele.ultra+"mm"}</div></div><span className="text-xs text-[#EADDC8]/70">{tele.tilt}°</span>
                </div>
                <div className="rounded-xl bg-[#00674F] text-[#EADDC8] p-3 text-xs leading-5">
                  R1 Soil {tele.soilR1} ({tele.soilPctR1}%) · Gas {tele.gas} · Ultra {tele.ultra===9999?"—":tele.ultra+"mm"} · {tele.t}°C {tele.h}% · Tilt {tele.tilt}°
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SPECS — per-section field */}
      <section id="specs" className="relative z-10 border-t border-[#EADDC8]/10 bg-[#3D4A2E]/55 backdrop-blur-[2px] py-12 sm:py-16 overflow-hidden">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={FARMS.specs} alt="" className="w-full h-full object-cover opacity-[0.16] scale-[1.04] will-change-transform parallax-slow" style={{filter:"sepia(0.13) saturate(0.9)"}} />
          <div className="absolute inset-0 bg-[#191919]/12" />
        </div>
        <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
          <div className="flex flex-wrap justify-between gap-4 items-end">
            <h2 className="reveal font-[--font-space] text-[30px] sm:text-[40px] font-bold tracking-tight leading-none text-[#EADDC8]">Every pin,<br/><span className="text-[#191919]">every decision.</span></h2>
            <p className="reveal max-w-[420px] text-sm text-[#EADDC8]/75">Built with Pico WH, Uno R3 + ESP32, Thonny & Arduino IDE 2.x — no hardcoded secrets, open AP for demo.</p>
          </div>
          <div className="mt-8 grid md:grid-cols-2 gap-4">
            {specCards.map(c=>(
              <div key={c.k} className="reveal rounded-[20px] border border-[#191919]/10 bg-[#EADDC8] p-6 will-change-transform shadow-[0_8px_30px_rgba(10,58,35,0.12)]" style={{ transform:"translateZ(0)"}}>
                <div className="text-[11px] tracking-[0.18em] text-[#00674F] font-semibold">0{c.k} —</div>
                <div className="mt-2 font-semibold text-[#191919]">{c.title}</div>
                <p className="mt-2 text-sm leading-6 text-[#191919]/65">{c.desc}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {c.chips.map(ch=> <span key={ch} className="rounded-full border border-[#191919]/10 bg-[#00674F]/10 px-3 py-1 text-[11px] font-mono text-[#191919]/70">{ch}</span>)}
                </div>
              </div>
            ))}
          </div>

          <div className="reveal mt-6 rounded-[20px] border border-[#191919]/15 bg-[#EADDC8] p-6 sm:p-8 text-[#191919] will-change-transform shadow-[0_12px_40px_rgba(10,58,35,0.15)]">
            <div className="flex flex-wrap gap-6 items-center justify-between">
              <div>
                <div className="text-[11px] tracking-[0.22em] font-semibold text-[#00674F]">READY FOR FIELD TRIAL?</div>
                <div className="font-[--font-space] text-[24px] sm:text-[30px] font-bold tracking-tight leading-none mt-1">Deploy the swarm. Watch precision.</div>
                <div className="text-sm opacity-60 mt-1">Phone → WiFi DEMETER-AP → http://192.168.4.1/ → Deploy. Bench: Uno Serial g/s.</div>
              </div>
              <div className="flex gap-3">
                <a href="#telemetry" className="h-11 px-7 rounded-full bg-[#191919] text-[#EADDC8] font-semibold grid place-items-center hover:bg-[#14402F] transition">Open telemetry</a>
                <a href="https://github.com" target="_blank" className="h-11 px-7 rounded-full border border-[#191919]/15 font-semibold grid place-items-center text-[#191919] hover:bg-[#00674F]/10 transition">Docs →</a>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 text-[11px] font-mono text-[#EADDC8]/60">
            <span>© 2026 D.E.M.E.T.E.R — AGRI-SWARM</span><span>·</span><span>Forty Love · The Courts palette: #00674F · #191919</span>
          </div>
        </div>
      </section>

      <style>{`html{scrollbar-gutter:stable; overflow-y: auto} body{overflow-y: auto} #deconstruct, #telemetry, #specs{ overflow: visible }`}</style>
    </div>
  );
}

