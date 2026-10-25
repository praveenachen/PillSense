import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePathname } from "next/navigation";
import { OnboardingGate } from "./onboarding-gate";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/") }));
vi.mock("convex/react", () => ({ useConvexAuth: vi.fn(), useQuery: vi.fn() }));
vi.mock("./caregiver-medication-setup", () => ({ CaregiverMedicationSetup: () => <div>Create demo caregiver + patient</div> }));
vi.mock("./auth-required", () => ({ AuthRequired: () => <div>Sign in</div> }));

function UnsafeChild(): ReactNode { throw new Error("Protected queries must not mount before onboarding"); }

describe("onboarding gate", () => {
  beforeEach(() => {
    vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: true } as ReturnType<typeof useConvexAuth>);
  });

  it("shows onboarding without mounting protected route content", () => {
    vi.mocked(useQuery).mockReturnValue({ status: "needs_onboarding" } as never);
    const html = renderToStaticMarkup(<OnboardingGate><UnsafeChild /></OnboardingGate>);
    expect(html).toContain("Create demo caregiver + patient");
  });

  it("mounts route content once the patient dashboard is ready", () => {
    vi.mocked(useQuery).mockReturnValue({ status: "ready" } as never);
    const html = renderToStaticMarkup(<OnboardingGate><p>Ready workspace</p></OnboardingGate>);
    expect(html).toContain("Ready workspace");
  });

  it("never covers the Hardware Lab route with onboarding or sign-in UI", () => {
    vi.mocked(usePathname).mockReturnValue("/hardware-lab");
    vi.mocked(useQuery).mockReturnValue({ status: "needs_onboarding" } as never);
    expect(renderToStaticMarkup(<OnboardingGate><p>Lab route</p></OnboardingGate>)).toContain("Lab route");
    vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: false } as ReturnType<typeof useConvexAuth>);
    expect(renderToStaticMarkup(<OnboardingGate><p>Lab route</p></OnboardingGate>)).toContain("Lab route");
    vi.mocked(usePathname).mockReturnValue("/");
  });
});
