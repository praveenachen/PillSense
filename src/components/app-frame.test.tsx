import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useConvexAuth, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "./app-frame";
import { OnboardingGate } from "./onboarding-gate";
import { PersistentArduinoLab } from "./persistent-arduino-lab";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/") }));
vi.mock("convex/react", () => ({ useConvexAuth: vi.fn(), useQuery: vi.fn() }));
vi.mock("../app/providers", () => ({ Providers: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./caregiver-medication-setup", () => ({ CaregiverMedicationSetup: () => <div>Create demo caregiver + patient</div> }));
vi.mock("./auth-required", () => ({ AuthRequired: () => <div>Sign in</div> }));
vi.mock("./persistent-arduino-lab", () => ({ PersistentArduinoLab: () => <aside>BLE-LAB-SENTINEL</aside> }));

/** Every ancestor type on the path from the root to the first element of `target`. */
function ancestorsOf(node: ReactNode, target: unknown, path: unknown[] = []): unknown[] | null {
  if (Array.isArray(node)) {
    for (const child of node) { const found = ancestorsOf(child, target, path); if (found) return found; }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === target) return path;
  return ancestorsOf(element.props.children, target, [...path, element.type]);
}

describe("root composition keeps the BLE controller mounted", () => {
  beforeEach(() => {
    vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: true } as ReturnType<typeof useConvexAuth>);
  });

  it("renders the Hardware Lab as a sibling of the onboarding gate, never as its child", () => {
    const tree = AppFrame({ authUiConfigured: true, children: <p>page</p> });
    const ancestors = ancestorsOf(tree, PersistentArduinoLab);
    expect(ancestors).not.toBeNull();
    expect(ancestors).not.toContain(OnboardingGate);
  });

  it.each([
    ["auth still loading", { isLoading: true, isAuthenticated: false }, undefined],
    ["signed out", { isLoading: false, isAuthenticated: false }, undefined],
    ["dashboard reloading", { isLoading: false, isAuthenticated: true }, undefined],
    ["needs onboarding", { isLoading: false, isAuthenticated: true }, { status: "needs_onboarding" }],
    ["unauthorized", { isLoading: false, isAuthenticated: true }, { status: "unauthorized" }],
    ["ready", { isLoading: false, isAuthenticated: true }, { status: "ready" }],
  ])("keeps exactly one Hardware Lab mounted while %s", (_label, auth, dashboard) => {
    vi.mocked(useConvexAuth).mockReturnValue(auth as ReturnType<typeof useConvexAuth>);
    vi.mocked(useQuery).mockReturnValue(dashboard as never);
    const html = renderToStaticMarkup(<AppFrame authUiConfigured><p>page</p></AppFrame>);
    expect(html.match(/BLE-LAB-SENTINEL/g)).toHaveLength(1);
  });

  it("keeps the Hardware Lab available even when Clerk/Convex are not configured", () => {
    const html = renderToStaticMarkup(<AppFrame authUiConfigured={false}><p>page</p></AppFrame>);
    expect(html).toContain("PillSense setup required");
    expect(html.match(/BLE-LAB-SENTINEL/g)).toHaveLength(1);
  });
});
