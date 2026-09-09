import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const space = Space_Grotesk({ variable: "--font-space", subsets: ["latin"], weight: ["300","400","500","600","700"] });
const jet = JetBrains_Mono({ variable: "--font-jet", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "D.E.M.E.T.E.R — Dynamic Environmental Mapping & Targeted Emission Robotics",
  description: "IoT + Robotics swarm: Pico WH scout + Uno+ESP32 doser. Scans farmland, maps temperature/humidity/gas/topography, and micro-doses precisely per plant.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${space.variable} ${jet.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  );
}
