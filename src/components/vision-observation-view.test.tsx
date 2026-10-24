import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisionObservationView } from "./vision-observation-view";

describe("vision observation UI", () => {
  it("labels observations as non-clinical and offers explicit lifecycle controls", () => {
    const html = renderToStaticMarkup(<VisionObservationView state={{ status: "ACTIVE", bridge: "CONNECTED", personVisible: true, lastType: "HAND_AT_MOUTH_DETECTED", lastTimestamp: 1, lastGestureAt: 1 }} onStart={() => undefined} onStop={() => undefined} />);
    expect(html).toContain("Hand-to-mouth gesture observed");
    expect(html).toContain("does not verify pill ingestion");
    expect(html).toContain("Start observation");
    expect(html).toContain("Stop and release camera");
    expect(html).toContain("Observing · person visible");
    expect(html).toContain("Hand near mouth");
    expect(html).toContain("Pill / tray presence");
    expect(html).toContain("No images or video are uploaded or stored");
  });

  it("has no hardware, voice, or clinical completion integration", () => {
    const source = readFileSync(join(process.cwd(), "src", "components", "vision-observation-panel.tsx"), "utf8");
    expect(source).not.toMatch(/WebBluetooth|runSupervised|dispens|Cartesia|voice|reportIngestion|doseOccurrences/);
    expect(source).not.toMatch(/TAKEN|COMPLETED/);
    expect(source).not.toMatch(/getUserMedia|navigator\.mediaDevices/);
  });
});
