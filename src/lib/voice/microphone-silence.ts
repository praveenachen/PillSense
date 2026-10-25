export type MicrophoneSilenceWatch = { available: boolean; heardActivity(): boolean; stop(): void };

/** Uses sound level only; transcription still decides which words were spoken. */
export class SilenceWindow {
  private lastActivity: number;
  heardActivity = false;
  constructor(now: number, private readonly silenceMs = 3_000, private readonly threshold = 0.015) {
    this.lastActivity = now;
  }
  sample(level: number, now: number) {
    if (!Number.isFinite(level) || !Number.isFinite(now)) return false;
    if (level >= this.threshold) {
      this.heardActivity = true;
      this.lastActivity = now;
    }
    return now - this.lastActivity >= this.silenceMs;
  }
}

/** Analyzes the existing recording stream locally. Never opens another microphone. */
export function watchMicrophoneSilence(stream: MediaStream, onSilence: () => void): MicrophoneSilenceWatch {
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let window: SilenceWindow | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearInterval(timer);
    source?.disconnect();
    analyser?.disconnect();
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  };
  try {
    if (typeof globalThis.AudioContext === "undefined") return { available: false, heardActivity: () => false, stop };
    context = new AudioContext();
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source = context.createMediaStreamSource(stream);
    source.connect(analyser); // No destination connection: microphone audio is never played back.
    const samples = new Float32Array(analyser.fftSize);
    timer = setInterval(() => {
      if (stopped || !context || context.state !== "running" || !analyser) return;
      const now = performance.now();
      window ??= new SilenceWindow(now);
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / samples.length);
      if (window.sample(rms, now)) {
        stop();
        onSilence();
      }
    }, 100);
    if (context.state === "suspended") void context.resume().catch(stop);
    return { available: true, heardActivity: () => window?.heardActivity ?? false, stop };
  } catch {
    stop();
    // Keep the bounded recording/touch fallback when Web Audio is unavailable.
    return { available: false, heardActivity: () => false, stop };
  }
}
