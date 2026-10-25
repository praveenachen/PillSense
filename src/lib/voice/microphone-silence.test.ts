import { afterEach, describe, expect, it, vi } from "vitest";
import { SilenceWindow, watchMicrophoneSilence } from "./microphone-silence";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("three-second microphone silence", () => {
  it("submits only after three seconds without activity, resetting when sound resumes", () => {
    const window = new SilenceWindow(0);
    expect(window.sample(0, 2_999)).toBe(false);
    expect(window.sample(0.08, 3_000)).toBe(false);
    expect(window.sample(0, 5_999)).toBe(false);
    expect(window.sample(0, 6_000)).toBe(true);
    expect(window.heardActivity).toBe(true);
  });
  it("recognizes an entirely silent recording and ignores invalid measurements", () => {
    const window = new SilenceWindow(0);
    expect(window.sample(Number.NaN, 5_000)).toBe(false);
    expect(window.sample(0.001, 3_000)).toBe(true);
    expect(window.heardActivity).toBe(false);
  });
  it("uses the existing stream, fires once, and releases the analyser on silence", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const disconnect = vi.fn();
    const analyser = { fftSize: 2048, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0), disconnect };
    const source = { connect: vi.fn(), disconnect };
    const context = { state: "running", createAnalyser: () => analyser, createMediaStreamSource: vi.fn(() => source), close: vi.fn(async () => { context.state = "closed"; }) };
    vi.stubGlobal("AudioContext", function () { return context; });
    const stream = {} as MediaStream;
    const onSilence = vi.fn();
    const watcher = watchMicrophoneSilence(stream, onSilence);
    expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    vi.advanceTimersByTime(3_100);
    expect(onSilence).toHaveBeenCalledOnce();
    expect(watcher.heardActivity()).toBe(false);
    expect(context.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(onSilence).toHaveBeenCalledOnce();
  });
  it("cancels observation when recording ends or the user leaves Voice", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const context = { state: "running", createAnalyser: () => ({ fftSize: 2048, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0), disconnect: vi.fn() }), createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }), close: vi.fn(async () => undefined) };
    vi.stubGlobal("AudioContext", function () { return context; });
    const onSilence = vi.fn();
    const watcher = watchMicrophoneSilence({} as MediaStream, onSilence);
    watcher.stop();
    watcher.stop();
    vi.advanceTimersByTime(5_000);
    expect(onSilence).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it("falls back without blocking recording when Web Audio is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(watchMicrophoneSilence({} as MediaStream, vi.fn()).available).toBe(false);
  });
});
