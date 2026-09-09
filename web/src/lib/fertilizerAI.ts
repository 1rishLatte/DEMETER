// AI Fertilizer Recommendation — advice only, 2 crops, real sensor inputs, fake/demo ranges
// Implements Steps 1-9 from prompt + invoke LLM for management_advice phrasing + crop bias + store history
// Crops: paddy, tomato (2 predetermined as requested)

export type Crop = "paddy" | "tomato";
export const CROPS: { id: Crop; label: string; icon: string }[] = [
  { id: "paddy", label: "Paddy (Rice)", icon: "🌾" },
  { id: "tomato", label: "Tomato", icon: "🍅" },
];

export type Inputs = {
  soil_moisture_percent: number; // 0-100 from GP27 soilPct
  mq135_gas_reading: number; // 0-1023 GP26 gas
  ultrasonic_distance_cm: number; // cm (ultra mm/10)
  humidity_percent: number; // DHT11 h
  temperature_C: number; // DHT11 t
  crop: Crop;
};

export type Recommendation = {
  soil_moisture_status: "dry" | "optimal" | "wet";
  gas_emission_level: "low" | "medium" | "high";
  canopy_density: "sparse" | "moderate" | "dense";
  volatilization_potential: "low" | "medium" | "high";
  N_need_level: "low" | "medium" | "high";
  PK_need_level: "low" | "medium" | "high";
  fertilizer_types: string[];
  fertilizer_amount_category: "low" | "medium" | "high";
  fertilizer_amount_range_kg_per_ha: string;
  management_advice: string[];
  notes: string[];
  // Novelty extensions
  health_score?: number; // 0-100
  cost_estimate_inr_per_ha?: string; // e.g. "₹800–1500"
  trend_summary?: string; // e.g. "Soil drying, gas rising"
  yield_prediction?: string; // e.g. "3.2 t/ha if irrigated"
};

// Tunable thresholds — calibrated to your hardware (probe 10k pulldown, DHT11, HC-SR04 mount ~35cm)
const GAS_LOW = 300;
const GAS_HIGH = 600;
// canopy: ultrasonic mounted ~35cm above soil. Crop height = mount - distance. Invert to density.
function canopyDensity(cm: number): Recommendation["canopy_density"] {
  if (cm > 25) return "sparse"; // short/sparse
  if (cm > 10) return "moderate";
  return "dense"; // <10cm close to sensor
}

function soilStatus(pct: number): Recommendation["soil_moisture_status"] {
  if (pct < 15) return "dry";
  if (pct <= 35) return "optimal";
  return "wet";
}
function gasLevel(raw: number): Recommendation["gas_emission_level"] {
  if (raw < GAS_LOW) return "low";
  if (raw < GAS_HIGH) return "medium";
  return "high";
}
function volatilization(t: number, h: number, soil: Recommendation["soil_moisture_status"], gas: Recommendation["gas_emission_level"]): Recommendation["volatilization_potential"] {
  if (t > 30 && h >= 60 && soil === "optimal" && (gas === "medium" || gas === "high")) return "high";
  if (soil === "dry" || soil === "wet" || t < 20) return "low";
  return "medium";
}
function computeHealthScore(soil: Recommendation["soil_moisture_status"], gas: Recommendation["gas_emission_level"], canopy: Recommendation["canopy_density"], vol: Recommendation["volatilization_potential"], t:number,h:number): number {
  let s=100;
  if (soil==="dry") s-=30; else if (soil==="wet") s-=15;
  if (gas==="high") s-=20; else if (gas==="medium") s-=10;
  if (canopy==="sparse") s-=25; else if (canopy==="moderate") s-=10;
  if (vol==="high") s-=15;
  if (t>35 || t<15) s-=10;
  if (h<30 || h>85) s-=10;
  return Math.max(0, Math.min(100, s));
}
function estimateCost(types: string[], cat: Recommendation["fertilizer_amount_category"]): string {
  const kg = cat==="high"? 125 : cat==="medium"? 75 : 25;
  const pricePerKg: Record<string,number> = {"Urea":7, "NPK 10-26-26":28, "DAP":27, "MOP":22, "No fertilizer needed at this stage":0};
  let totalLow=0, totalHigh=0;
  for(const t of types){ const p=pricePerKg[t]??15; totalLow+=p*(kg-25); totalHigh+=p*(kg+25); }
  if (totalLow===0 && totalHigh===0) return "₹0";
  return `₹${Math.round(totalLow)}–${Math.round(totalHigh)}/ha`;
}
function predictYield(canopy: Recommendation["canopy_density"], soil: Recommendation["soil_moisture_status"], n: Recommendation["N_need_level"], crop: Crop): string {
  const base = crop==="paddy"? 3.5 : 2.8;
  let adj=0;
  if (canopy==="dense") adj+=0.6; else if (canopy==="sparse") adj-=0.8;
  if (soil==="optimal") adj+=0.3; else if (soil==="dry") adj-=0.5;
  if (n==="high") adj-=0.4;
  const y = Math.max(0.5, base+adj).toFixed(1);
  return `${y} t/ha if advice followed`;
}

// Invoke Gemini for full calculation + advice — if GEMINI_API_KEY present uses Gemini, else deterministic fallback
// Config: GEMINI_API_KEY or GOOGLE_API_KEY, optional GEMINI_MODEL (default gemini-1.5-flash)
async function invokeGemini(inputs: Inputs, base: Recommendation): Promise<Recommendation | null> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  const sysPrompt = `You are DEMETER AI Fertilizer Agent for smallholder rover. Using ONLY low-cost sensor inputs, output JSON per Steps 1-9 exactly. Keep reasoning internal, output ONLY final JSON. Rules: soil<15 dry 15-35 optimal >35 wet; gas low<${GAS_LOW} med ${GAS_LOW}-${GAS_HIGH} high>${GAS_HIGH}; canopy sparse>25cm moderate 10-25 dense<10 (HC-SR04 mount ~35cm); volatilization high if t>30 h>=60 soil optimal gas med/high, low if dry/wet or t<20 else medium; N/PK heuristics as in prompt with crop bias (paddy wet→lower N, tomato sparse→higher N/PK); fertilizer_types per step6; amount high if N/PK high →100-150, medium→50-100 else 0-50; also compute health_score 0-100, cost_estimate_inr_per_ha "₹X–Y/ha", trend_summary short, yield_prediction "X.X t/ha". Crop set paddy/tomato. Return JSON fields: soil_moisture_status,gas_emission_level,canopy_density,volatilization_potential,N_need_level,PK_need_level,fertilizer_types,fertilizer_amount_category,fertilizer_amount_range_kg_per_ha,management_advice[1-4 short],notes[1-3],health_score,cost_estimate_inr_per_ha,trend_summary,yield_prediction.`;
  const userPrompt = `Inputs: ${JSON.stringify(inputs)}\nBase deterministic result (use as guide, improve with Gemini reasoning): ${JSON.stringify(base)}`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: sysPrompt + "\n\n" + userPrompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 800, responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn("Gemini error", res.status, txt.slice(0,300));
      return null;
    }
    const j = await res.json();
    const txt: string = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!txt) return null;
    const parsed = JSON.parse(txt) as Recommendation;
    // Validate enums quickly
    if (!["dry","optimal","wet"].includes(parsed.soil_moisture_status) || !["low","medium","high"].includes(parsed.N_need_level)) return null;
    return parsed;
  } catch (e) {
    console.warn("Gemini invoke failed", e);
    return null;
  }
}

async function invokeLLM(prompt: string): Promise<string[]> {
  // Legacy OpenAI path kept for backward compat, but primary is Gemini via invokeGemini
  const key = process.env.OPENAI_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.6,
        max_tokens: 300,
        messages: [
          { role: "system", content: "You are a concise agronomy advisor for smallholder DEMETER rover. Output 1-4 short bullet strings, each <25 words, no preamble, no numbers." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return [];
    const j = await res.json();
    const txt: string = j.choices?.[0]?.message?.content ?? "";
    const lines = txt.split("\n").map(s=> s.replace(/^[-•\d.)\s]+/, "").trim()).filter(Boolean).slice(0,4);
    return lines.length ? lines : [];
  } catch { return []; }
}

export async function recommend(inputs: Inputs): Promise<Recommendation> {
  const soil_moisture_status = soilStatus(inputs.soil_moisture_percent);
  const gas_emission_level = gasLevel(inputs.mq135_gas_reading);
  const canopy_density = canopyDensity(inputs.ultrasonic_distance_cm);
  const volatilization_potential = volatilization(inputs.temperature_C, inputs.humidity_percent, soil_moisture_status, gas_emission_level);

  // Step 5 N
  let N: Recommendation["N_need_level"] = "medium";
  if (canopy_density === "sparse" && (gas_emission_level === "low" || gas_emission_level === "medium") && soil_moisture_status === "optimal") N = "high";
  else if (canopy_density === "sparse" && soil_moisture_status === "dry") N = gas_emission_level === "low" ? "medium" : "low";
  else if ((canopy_density === "moderate" || canopy_density === "dense") && gas_emission_level === "high") N = "low";
  else if (canopy_density === "moderate" && (gas_emission_level === "low" || gas_emission_level === "medium") && soil_moisture_status === "optimal") N = "medium";
  if (soil_moisture_status === "wet" && gas_emission_level === "high") {
    if (N === "high") N = "medium"; else if (N === "medium") N = "low";
  }
  // crop bias: paddy tolerates wet+high N less, tomato needs more N when sparse
  if (inputs.crop === "tomato" && canopy_density === "sparse" && N !== "high") N = "high";
  if (inputs.crop === "paddy" && soil_moisture_status === "wet" && N === "high") N = "medium";

  // Step 5 PK
  let PK: Recommendation["PK_need_level"] = "low";
  if (canopy_density === "sparse" && soil_moisture_status === "optimal" && inputs.temperature_C >= 20) PK = "high";
  else if ((canopy_density === "moderate" || canopy_density === "dense") && soil_moisture_status === "optimal") PK = "low";
  else if (canopy_density === "sparse" && soil_moisture_status === "dry") PK = "low";
  // crop bias: tomato PK heavier
  if (inputs.crop === "tomato" && PK === "low" && canopy_density === "moderate") PK = "medium";

  // Step 6 fertilizer types
  let fertilizer_types: string[];
  if (N === "high" && (PK === "low" || PK === "medium")) fertilizer_types = inputs.crop === "paddy" ? ["Urea"] : ["Urea"];
  else if (N === "high" && PK === "high") fertilizer_types = ["NPK 10-26-26", "Urea"];
  else if (N === "medium" && (PK === "medium" || PK === "high")) fertilizer_types = ["NPK 10-26-26"];
  else if (N === "low" && (PK === "medium" || PK === "high")) fertilizer_types = inputs.crop === "tomato" ? ["DAP", "MOP"] : ["DAP", "MOP"];
  else fertilizer_types = ["No fertilizer needed at this stage"];

  // Step 7 amount
  let cat: Recommendation["fertilizer_amount_category"] = "low";
  if (N === "high" || PK === "high") cat = "high";
  else if (N === "medium" || PK === "medium") cat = "medium";
  const range = cat === "low" ? "0–50 kg/ha" : cat === "medium" ? "50–100 kg/ha" : "100–150 kg/ha";

  // Step 8 base advice
  const baseAdvice: string[] = [];
  if (volatilization_potential === "high") baseAdvice.push("Risk of nitrogen loss as gas is high. Prefer split applications and incorporate fertilizer into soil or irrigate soon after applying.");
  if (soil_moisture_status === "dry") baseAdvice.push("Soil is dry; fertilizer response may be limited. Consider irrigation before or with fertilizer application.");
  if (soil_moisture_status === "wet") baseAdvice.push("Soil is wet; avoid heavy nitrogen doses to reduce leaching and denitrification risk.");
  if (gas_emission_level === "high" && canopy_density === "dense") baseAdvice.push("Gas emissions are high and crop is dense; likely sufficient nitrogen. Avoid additional high nitrogen doses.");
  if (canopy_density === "sparse" && soil_moisture_status === "optimal") baseAdvice.push("Crop canopy is sparse; likely nutrient-limited. A balanced fertilizer may help improve growth.");
  if (inputs.crop === "paddy" && soil_moisture_status === "wet") baseAdvice.push("Paddy is in wet soil — prefer DAP/NPK over heavy urea to limit N loss.");
  if (inputs.crop === "tomato" && canopy_density !== "dense") baseAdvice.push("Tomato benefits from steady P/K — avoid late heavy N that delays fruiting.");
  const trimmed = baseAdvice.slice(0, 4);

  // Try Gemini for full calculation (if GEMINI_API_KEY set) — otherwise use deterministic base
  const baseRec: Recommendation = {
    soil_moisture_status, gas_emission_level, canopy_density, volatilization_potential,
    N_need_level: N, PK_need_level: PK,
    fertilizer_types, fertilizer_amount_category: cat, fertilizer_amount_range_kg_per_ha: range,
    management_advice: trimmed.length ? trimmed : ["Monitor and maintain current practice; re-measure in 3–5 days."],
    notes: [
      "Crop type and yield target not known; recommendations are relative demo from sensor patterns.",
      "Fertilizer ranges 0–150 kg/ha are approximate; adjust to local extension for " + inputs.crop + ".",
      "MQ135 is a proxy for nitrogenous gas, not direct ammonia; calibrate thresholds per field.",
    ],
  };

  // Novelty: health score + cost + trend (deterministic, Gemini can refine)
  const health_score = computeHealthScore(soil_moisture_status, gas_emission_level, canopy_density, volatilization_potential, inputs.temperature_C, inputs.humidity_percent);
  const cost_estimate_inr_per_ha = estimateCost(fertilizer_types, cat);
  const trend_summary = `Soil ${soil_moisture_status}, gas ${gas_emission_level}, canopy ${canopy_density} — ${inputs.crop} ${volatilization_potential} volatilization risk.`;
  const yield_prediction = predictYield(canopy_density, soil_moisture_status, N, inputs.crop);
  baseRec.health_score = health_score;
  baseRec.cost_estimate_inr_per_ha = cost_estimate_inr_per_ha;
  baseRec.trend_summary = trend_summary;
  baseRec.yield_prediction = yield_prediction;

  // If Gemini key present, let Gemini recompute/refine the JSON (still advice only, real sensors)
  const geminiRec = await invokeGemini(inputs, baseRec);
  if (geminiRec) {
    // Ensure Gemini respected crop-specific fertilizer list — keep fallback if empty
    if (!geminiRec.fertilizer_types?.length) geminiRec.fertilizer_types = baseRec.fertilizer_types;
    if (!geminiRec.management_advice?.length) geminiRec.management_advice = baseRec.management_advice;
    // Keep novelty fields if Gemini omitted
    geminiRec.health_score = geminiRec.health_score ?? health_score;
    geminiRec.cost_estimate_inr_per_ha = geminiRec.cost_estimate_inr_per_ha ?? cost_estimate_inr_per_ha;
    geminiRec.trend_summary = geminiRec.trend_summary ?? trend_summary;
    geminiRec.yield_prediction = geminiRec.yield_prediction ?? yield_prediction;
    return geminiRec;
  }

  // Fallback: try OpenAI rephrase of advice only
  const prompt = `Crop ${inputs.crop}, soil ${soil_moisture_status} (${inputs.soil_moisture_percent}%), gas ${gas_emission_level} (${inputs.mq135_gas_reading}), canopy ${canopy_density} (${inputs.ultrasonic_distance_cm}cm), volatilization ${volatilization_potential}, N ${N} PK ${PK}, temp ${inputs.temperature_C}C hum ${inputs.humidity_percent}%. Rephrase these advices concisely, keep agronomy, 1-4 bullets: ${trimmed.join(" | ")}`;
  const llmAdvice = await invokeLLM(prompt);
  if (llmAdvice.length) baseRec.management_advice = llmAdvice;
  return baseRec;
}
