import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hardware Lab · PillSense",
  description: "Authorized internal Arduino, diagnostics, simulation, and local camera controls.",
};

export default function HardwareLabPage() {
  // The root-owned lab stays mounted across route changes so the single BLE
  // transport and its page-session dispatch lock are never recreated here.
  return null;
}
