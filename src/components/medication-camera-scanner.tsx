"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { MedicationScan } from "@/lib/medication-scan";
import { readMedicationScanResponse } from "../lib/medication-scan-response";

type CameraState = "idle" | "starting" | "ready" | "analyzing" | "complete" | "error";

export function MedicationCameraScanner({ onScan }: { onScan: (scan: MedicationScan) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const previous = useRef<Uint8ClampedArray | null>(null);
  const stableFrames = useRef(0);
  const lastRequestAt = useRef(0);
  const lastSuccessfulImage = useRef<Uint8ClampedArray | null>(null);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const scanGeneration = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function stop() {
    scanGeneration.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    inFlight.current = false;
    completed.current = false;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    previous.current = null;
    stableFrames.current = 0;
    setCapturedImage(null);
    setState("idle");
  }

  useEffect(() => () => {
    scanGeneration.current += 1;
    requestController.current?.abort();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) { setMessage("Camera access requires HTTPS or localhost and a supported browser."); setState("error"); return; }
    const generation = ++scanGeneration.current;
    setState("starting"); setMessage(null); completed.current = false; setCapturedImage(null);
    previous.current = null; stableFrames.current = 0;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (scanGeneration.current !== generation) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
      if (scanGeneration.current !== generation) return;
      setState("ready");
    } catch (error) {
      if (scanGeneration.current !== generation) return;
      stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
      mediaError(error, setMessage);
      setState("error");
    }
  }

  function capture(): { image: string; signature: Uint8ClampedArray } | null {
    const source = video.current;
    if (!source || source.readyState < 2 || !source.videoWidth) return null;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / source.videoWidth);
    canvas.width = Math.round(source.videoWidth * scale);
    canvas.height = Math.round(source.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const sample = document.createElement("canvas"); sample.width = 16; sample.height = 12;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    if (!sampleContext) return null;
    sampleContext.drawImage(canvas, 0, 0, 16, 12);
    const pixels = sampleContext.getImageData(0, 0, 16, 12).data;
    const signature = new Uint8ClampedArray(16 * 12);
    for (let i = 0; i < signature.length; i += 1) signature[i] = (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3;
    return { image: canvas.toDataURL("image/jpeg", 0.82), signature };
  }

  async function analyze() {
    if (inFlight.current || !navigator.onLine) { if (!navigator.onLine) setMessage("Offline. Reconnect before analyzing a photo."); return; }
    if (Date.now() - lastRequestAt.current < 8_000) { setMessage("Please wait a few seconds before scanning again."); return; }
    const captured = capture();
    if (!captured) { setMessage("Camera image is not ready. Try again."); return; }
    if (lastSuccessfulImage.current) {
      const difference = captured.signature.reduce((sum, value, index) => sum + Math.abs(value - lastSuccessfulImage.current![index]), 0) / captured.signature.length;
      if (difference < 8) { setMessage("This looks like the last scanned label. Move to another package before scanning again."); return; }
    }
    inFlight.current = true;
    const generation = scanGeneration.current;
    const controller = new AbortController();
    requestController.current = controller;
    lastRequestAt.current = Date.now();
    setCapturedImage(captured.image);
    setState("analyzing"); setMessage(null);
    try {
      const startedAt = performance.now();
      const response = await fetch("/api/medication-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: captured.image }), cache: "no-store", signal: controller.signal });
      const scan = await readMedicationScanResponse(response);
      const remainingAnimation = 900 - (performance.now() - startedAt);
      if (remainingAnimation > 0) await new Promise((resolve) => window.setTimeout(resolve, remainingAnimation));
      if (scanGeneration.current !== generation) return;
      if (!scan.brand && !scan.activeIngredient && !scan.strength) {
        setMessage("No readable medication label found. Move closer or use manual capture.");
      } else {
        completed.current = true;
        lastSuccessfulImage.current = captured.signature;
        stream.current?.getTracks().forEach((track) => track.stop());
        stream.current = null;
        if (video.current) video.current.srcObject = null;
        setState("complete");
        onScan(scan);
        setMessage("Label details found. Review and correct them below before saving.");
      }
    } catch (error) {
      if (scanGeneration.current !== generation) return;
      setMessage(error instanceof Error ? error.message : "Scan failed. Try again.");
    } finally {
      if (scanGeneration.current === generation) {
        requestController.current = null;
        inFlight.current = false;
        if (!completed.current) { setCapturedImage(null); setState("ready"); }
      }
    }
  }

  useEffect(() => {
    if (state !== "ready") return;
    const timer = window.setInterval(() => {
      if (inFlight.current || completed.current || Date.now() - lastRequestAt.current < 10_000 || !navigator.onLine) return;
      const source = video.current;
      if (!source || source.readyState < 2) return;
      const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 48;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(source, 0, 0, 64, 48);
      const pixels = context.getImageData(0, 0, 64, 48).data;
      const gray = new Uint8ClampedArray(64 * 48);
      let texture = 0; let change = 0;
      for (let i = 0; i < gray.length; i += 1) {
        const p = i * 4; gray[i] = (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3;
        if (i % 64) texture += Math.abs(gray[i] - gray[i - 1]);
        if (previous.current) change += Math.abs(gray[i] - previous.current[i]);
      }
      const stable = previous.current && change / gray.length < 4;
      stableFrames.current = stable && texture / gray.length > 7 ? stableFrames.current + 1 : 0;
      previous.current = gray;
      if (stableFrames.current >= 3) { stableFrames.current = 0; void analyze(); }
    }, 900);
    return () => window.clearInterval(timer);
  });

  return <section className="mt-5 rounded-xl border border-teal-200 bg-teal-50 p-4 text-slate-900">
    <h3 className="font-semibold">Scan medication packaging</h3>
    <p className="mt-1 text-sm text-slate-600">Hold the label steady and readable. Automatic capture waits for a stable image; you can capture manually at any time. Only captured images are sent for analysis.</p>
    <MedicationScanViewport state={state} capturedImage={capturedImage} videoRef={video} />
    <div className="mt-3 flex flex-wrap gap-2">
      {state === "idle" || state === "error" ? <button type="button" onClick={() => void start()} className="rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white">Start camera</button> : state !== "complete" && <button type="button" onClick={stop} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900">{state === "analyzing" ? "Cancel scan" : "Stop camera"}</button>}
      <button type="button" disabled={state !== "ready"} onClick={() => void analyze()} className="rounded-full border border-teal-700 bg-white px-4 py-2 text-sm font-semibold text-teal-800 disabled:opacity-50">Capture now</button>
      {state === "complete" && <button type="button" onClick={() => void start()} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900">Scan again</button>}
    </div>
    {state === "starting" && <p role="status" className="mt-2 text-sm">Waiting for camera permission…</p>}
    {state === "analyzing" && <p role="status" className="mt-2 text-sm">Analyzing captured label with Claude…</p>}
    {message && <p role="status" className="mt-2 text-sm text-slate-700">{message}</p>}
  </section>;
}

export function MedicationScanViewport({ state, capturedImage, videoRef }: {
  state: CameraState;
  capturedImage: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const active = state === "starting" || state === "ready" || state === "analyzing" || state === "complete";
  return <div className="ps-scan-viewport mt-3 aspect-video w-full overflow-hidden rounded-lg bg-slate-900" data-phase={state}>
    <video ref={videoRef} muted playsInline autoPlay aria-label="Live medication camera" className={`h-full w-full object-cover ${capturedImage ? "invisible" : ""}`} />
    {capturedImage && <div role="img" aria-label="Captured medication label" className="ps-scan-frozen-image" style={{ backgroundImage: `url(${capturedImage})` }} />}
    {active && <div className="ps-scan-overlay" aria-hidden="true">
      <span className="ps-scan-status">{state === "complete" ? "Label captured" : state === "analyzing" ? "Reading captured label" : state === "starting" ? "Starting camera" : "Align label in square"}</span>
      <div className="ps-scan-frame">
        <span className="ps-scan-corner ps-scan-corner-tl" />
        <span className="ps-scan-corner ps-scan-corner-tr" />
        <span className="ps-scan-corner ps-scan-corner-bl" />
        <span className="ps-scan-corner ps-scan-corner-br" />
        {(state === "ready" || state === "analyzing") && <span className="ps-scan-beam" />}
        {state === "complete" && <span className="ps-scan-check">✓</span>}
      </div>
      {state === "ready" && <span className="ps-scan-hint">Hold steady for automatic capture</span>}
      {state === "analyzing" && <span className="ps-scan-hint ps-scan-loading">Analyzing with Claude</span>}
    </div>}
  </div>;
}

function mediaError(error: unknown, setMessage: (message: string) => void) {
  const name = error instanceof Error ? error.name : "";
  setMessage(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser and try again." : name === "NotFoundError" ? "No camera was found." : "Could not start the camera. Check that another app is not using it.");
}
