import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Global security headers + CORS allowlist for easy linking
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://192.168.4.1",
  "https://demeter.vercel.app",
];

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Security headers (also set in next.config — keep both for edge)
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin") ?? "";
    const allow = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app") ? origin : "*";
    // Easy linking: allow Pico viewer (http://192.168.4.1) and localhost, don't block curl/postman (no origin)
    res.headers.set("Access-Control-Allow-Origin", allow);
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: res.headers });
  }
  return res;
}

export const config = { matcher: ["/api/:path*", "/(.*)"] };
