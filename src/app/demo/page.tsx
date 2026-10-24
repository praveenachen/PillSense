import type { Metadata } from "next";
import { DemoStudio } from "@/components/demo-studio";

export const metadata: Metadata = {
  title: "Mobile Demo Studio",
  description: "Live mobile-web presentation surface for the PillSense CalHacks prototype.",
};

export default function DemoPage() {
  const authUiConfigured = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.NEXT_PUBLIC_CONVEX_URL,
  );

  return <DemoStudio authUiConfigured={authUiConfigured} />;
}
