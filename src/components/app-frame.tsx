import type { ReactNode } from "react";
import { Providers } from "../app/providers";
import { OnboardingGate } from "./onboarding-gate";
import { PersistentArduinoLab } from "./persistent-arduino-lab";
import { ArduinoGatewayProvider } from "./arduino-gateway-provider";

/**
 * Root composition. The Hardware Lab owns the browser's single Bluetooth transport and its
 * one-dispatch session lock, so it is a SIBLING of the onboarding gate and never a child:
 * an auth refresh, sign-out or onboarding state must not unmount it.
 */
export function AppFrame({ children, authUiConfigured }: { children: ReactNode; authUiConfigured: boolean }) {
  const lab = <PersistentArduinoLab authUiConfigured={authUiConfigured} />;
  if (!authUiConfigured) {
    return (
      <>
        <main className="mx-auto w-full max-w-3xl px-5 py-16 text-slate-950">
          <h1 className="text-3xl font-semibold">PillSense setup required</h1>
          <p className="mt-4 text-slate-600">Configure NEXT_PUBLIC_CONVEX_URL and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to open the app.</p>
        </main>
        {lab}
      </>
    );
  }
  return (
    <Providers>
      <ArduinoGatewayProvider>
        <OnboardingGate>{children}</OnboardingGate>
        {lab}
      </ArduinoGatewayProvider>
    </Providers>
  );
}
