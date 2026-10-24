import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { PersistentArduinoLab } from "@/components/persistent-arduino-lab";
import { OnboardingGate } from "@/components/onboarding-gate";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PillSense",
    template: "%s · PillSense",
  },
  description: "A medication-management prototype for patients and caregivers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const authUiConfigured = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.NEXT_PUBLIC_CONVEX_URL,
  );
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <OnboardingGate>
            {children}
            <PersistentArduinoLab authUiConfigured={authUiConfigured} />
          </OnboardingGate>
        </Providers>
      </body>
    </html>
  );
}
