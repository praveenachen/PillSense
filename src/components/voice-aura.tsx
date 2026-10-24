"use client";

import { useEffect, useRef } from "react";
import { AURA_FRAGMENT, AURA_VERTEX } from "../lib/voice/aura-shader";

/** Visual intensity for each voice phase; the loop eases toward it so state changes feel fluid. */
const ENERGY: Record<string, number> = { idle: 0.15, listening: 1, processing: 0.55, speaking: 0.85, error: 0 };

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/**
 * Animated aura (flowing ribbons plus a glassy fluid sphere) drawn with a WebGL shader.
 * Purely decorative: motion reflects app state, never microphone level. Calls `onUnsupported`
 * when WebGL is unavailable so the caller can fall back to the CSS orb.
 */
export function VoiceAura({ state, onUnsupported }: { state: string; onUnsupported: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef(ENERGY.idle);

  useEffect(() => {
    target.current = ENERGY[state] ?? ENERGY.idle;
  }, [state]);

  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    const vs = gl && compile(gl, gl.VERTEX_SHADER, AURA_VERTEX);
    const fs = gl && compile(gl, gl.FRAGMENT_SHADER, AURA_FRAGMENT);
    const program = gl?.createProgram();
    if (!el || !gl || !vs || !fs || !program) { onUnsupported(); return; }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { onUnsupported(); return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uEnergy = gl.getUniformLocation(program, "uEnergy");
    gl.clearColor(0, 0, 0, 0);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let energy = target.current;
    let clock = 3 + Math.random() * 20;
    let last = performance.now();
    let frame = 0;

    function draw(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const width = el!.clientWidth;
      const height = el!.clientHeight;
      if (width > 0 && height > 0) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.round(width * dpr);
        const h = Math.round(height * dpr);
        if (el!.width !== w || el!.height !== h) { el!.width = w; el!.height = h; }
        gl!.viewport(0, 0, w, h);
        energy += (target.current - energy) * Math.min(1, dt * 3);
        clock += reduceMotion ? 0 : dt;
        gl!.uniform2f(uRes, w, h);
        gl!.uniform1f(uTime, clock);
        gl!.uniform1f(uEnergy, energy);
        gl!.clear(gl!.COLOR_BUFFER_BIT);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      }
      if (!reduceMotion && !document.hidden) frame = requestAnimationFrame(draw);
    }
    const resume = () => { if (!document.hidden && !reduceMotion) { last = performance.now(); cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); } };
    frame = requestAnimationFrame(draw);
    document.addEventListener("visibilitychange", resume);
    // The Voice tab is mounted while hidden (zero size), so draw again once it gets a real size.
    // Under reduced motion this is the only thing that paints the still frame.
    const observer = new ResizeObserver(() => { if (reduceMotion) requestAnimationFrame(draw); });
    observer.observe(el);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", resume); };
  }, [onUnsupported]);

  return <canvas ref={canvas} aria-hidden="true" className="pd-voice-canvas" />;
}
