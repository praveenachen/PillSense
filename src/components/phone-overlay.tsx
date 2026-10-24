"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Centered modal rendered inside the phone frame so it covers the app screen, not the whole browser window. */
export function PhoneOverlay({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState<Element | null>(null);
  useEffect(() => {
    setFrame(anchor.current?.closest('[aria-label="PillSense mobile web preview"]') ?? document.body);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <span ref={anchor} hidden />
      {frame && createPortal(
        <div role="dialog" aria-modal="true" aria-label={label} onClick={onClose} className={`${frame === document.body ? "fixed" : "absolute"} inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm`}>
          <div onClick={(event) => event.stopPropagation()} className="max-h-full w-full max-w-sm overflow-y-auto rounded-pd-card">{children}</div>
        </div>,
        frame,
      )}
    </>
  );
}
