/// <reference types="vite/client" />

import { describe, expect, it, vi } from "vitest";
import { synthesizeWithCartesia, transcribeWithCartesia } from "./cartesia-client";
import voiceCompanionSource from "../../components/voice-companion.tsx?raw";

describe("Cartesia server client", () => {
  it("does not reference the server key from the patient client component", () => {
    expect(voiceCompanionSource).not.toContain("CARTESIA_API_KEY");
    expect(voiceCompanionSource).not.toContain("NEXT_PUBLIC_CARTESIA");
  });
  it("uses the server-supplied key for Sonic without putting it in the request body", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer server-secret" });
      expect(String(init?.body)).not.toContain("server-secret");
      return new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "audio/wav" } });
    }) as unknown as typeof fetch;
    await expect(synthesizeWithCartesia({ apiKey: "server-secret", text: "Hello", fetcher })).resolves.toBeInstanceOf(Response);
  });

  it("mocks Ink transcription and rejects oversized recordings", async () => {
    const fetcher = vi.fn(async () => Response.json({ text: "I took my medication" })) as unknown as typeof fetch;
    await expect(transcribeWithCartesia({ apiKey: "server-secret", audio: new Blob(["audio"], { type: "audio/webm" }), filename: "voice.webm", fetcher })).resolves.toBe("I took my medication");
    await expect(transcribeWithCartesia({ apiKey: "server-secret", audio: new Blob([new Uint8Array(2_500_001)]), filename: "large.webm", fetcher })).rejects.toThrow("INVALID_AUDIO_SIZE");
  });
});
