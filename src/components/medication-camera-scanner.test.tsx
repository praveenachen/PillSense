import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MedicationCameraScanner, MedicationScanViewport } from "./medication-camera-scanner";

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

describe("MedicationCameraScanner", () => {
  it("shows only the camera controls, with no upload option or helper copy", () => {
    const html = renderToStaticMarkup(<MedicationCameraScanner onScan={() => undefined} />);
    expect(html).toContain("Start camera");
    expect(html).not.toContain("Upload");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Use the camera");
  });

  it("uses the dark design tokens by default and a light variant for the legacy caregiver page", () => {
    const dark = renderToStaticMarkup(<MedicationCameraScanner onScan={() => undefined} />);
    const light = renderToStaticMarkup(<MedicationCameraScanner tone="light" onScan={() => undefined} />);
    expect(dark).toContain("bg-pd-surface");
    expect(dark).not.toContain("teal-");
    expect(light).toContain("border-teal-200");
  });
});
