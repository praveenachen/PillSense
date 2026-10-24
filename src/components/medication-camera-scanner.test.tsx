import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MedicationScanViewport } from "./medication-camera-scanner";

describe("MedicationScanViewport", () => {
  const videoRef = createRef<HTMLVideoElement>();

  it("shows the captured image and loading square during analysis", () => {
    const html = renderToStaticMarkup(<MedicationScanViewport state="analyzing" capturedImage="data:image/jpeg;base64,AAAA" videoRef={videoRef} />);
    expect(html).toContain('data-phase="analyzing"');
    expect(html).toContain('aria-label="Captured medication label"');
    expect(html).toContain("ps-scan-frame");
    expect(html).toContain("Analyzing with Claude");
    expect(html).toContain("ps-scan-beam");
  });

  it("shows the frozen captured image after a successful scan", () => {
    const html = renderToStaticMarkup(<MedicationScanViewport state="complete" capturedImage="data:image/jpeg;base64,AAAA" videoRef={videoRef} />);
    expect(html).toContain('data-phase="complete"');
    expect(html).toContain('aria-label="Captured medication label"');
    expect(html).toContain("Label captured");
    expect(html).toContain("ps-scan-check");
  });
});
