import { useId } from "react";

/**
 * Premium top-down illustration of the eight-position carousel (positions 0..7, 0 = HOME).
 *
 * Illustrative only: the highlighted wedge is the *scheduled* compartment for the next dose.
 * It is never a live or verified motor position, because the firmware reports none here.
 */

export type DispenserTone = "ready" | "attention" | "idle";

/** "angled" is the low three-quarter hero shot; "tilted" looks down from higher up, so the disc reads rounder; "top" is a straight-down bird's-eye view with no visible side wall. */
export type DispenserView = "angled" | "tilted" | "top";

const GEOMETRY = {
  angled: { W: 320, H: 168, CX: 160, CY: 75, RX: 146, RY: 56, DEPTH: 30 },
  tilted: { W: 320, H: 282, CX: 160, CY: 118, RX: 146, RY: 110, DEPTH: 34 },
  top: { W: 320, H: 320, CX: 160, CY: 160, RX: 142, RY: 142, DEPTH: 0 },
} as const;
type Geometry = (typeof GEOMETRY)[DispenserView];

const glowColor: Record<DispenserTone, { a: string; b: string; opacity: number }> = {
  ready: { a: "#7774ff", b: "#5479ff", opacity: 1 },
  attention: { a: "#ffb547", b: "#ff8a4c", opacity: 0.7 },
  idle: { a: "#5d6680", b: "#3a4258", opacity: 0.55 },
};

function pt(g: Geometry, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return [g.CX + g.RX * r * Math.cos(rad), g.CY + g.RY * r * Math.sin(rad)] as const;
}
/** Wedge outline as a closed path; arcs are sampled so the perspective squash stays smooth. */
function wedgePath(g: Geometry, slot: number, inner = 0.33, outer = 0.9, half = 20) {
  const mid = slot * 45 - 90;
  const steps = [-half, -half / 2, 0, half / 2, half];
  const out = steps.map((d) => pt(g, outer, mid + d));
  const back = [...steps].reverse().map((d) => pt(g, inner, mid + d * 1.15));
  return `M${out.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} L${back.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} Z`;
}

export function DispenserVisual({
  activeSlot = null,
  tone = "idle",
  onSelectSlot,
  className = "",
  view = "angled",
}: {
  activeSlot?: number | null;
  tone?: DispenserTone;
  onSelectSlot?: (slot: number) => void;
  className?: string;
  view?: DispenserView;
}) {
  const g = GEOMETRY[view];
  const { W, H, CX, CY, RX, RY, DEPTH } = g;
  const top = view === "top";
  const glow = glowColor[tone];
  const highlighted = activeSlot !== null && activeSlot >= 0 && activeSlot <= 7 ? activeSlot : null;
  const id = useId().replaceAll(":", "");
  const ids = {
    side: `${id}-side`, top: `${id}-top`, well: `${id}-well`, active: `${id}-active`,
    edge: `${id}-edge`, floor: `${id}-floor`, blur: `${id}-blur`, blurSm: `${id}-blur-sm`,
  };
  const label = highlighted === null
    ? "Illustrative eight-position dispenser. Position 0 is home. No compartment is scheduled next."
    : `Illustrative eight-position dispenser. Position 0 is home. Slot ${highlighted} is highlighted because it is selected; this does not show live motor position.`;

  return (
    <div className={`relative mx-auto w-full ${top ? "max-w-[21rem]" : "max-w-[24rem]"} ${className}`}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full overflow-visible">
      <defs>
        <linearGradient id={ids.side} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#151925" />
          <stop offset="0.18" stopColor="#3a4153" />
          <stop offset="0.42" stopColor="#1b1f2c" />
          <stop offset="0.7" stopColor="#2c3242" />
          <stop offset="1" stopColor="#10131c" />
        </linearGradient>
        <linearGradient id={ids.top} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#626a7c" />
          <stop offset="0.24" stopColor="#3d4454" />
          <stop offset="0.6" stopColor="#222735" />
          <stop offset="1" stopColor="#11151f" />
        </linearGradient>
        <linearGradient id={ids.well} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2133" />
          <stop offset="1" stopColor="#0f1320" />
        </linearGradient>
        <linearGradient id={ids.active} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a87ff" />
          <stop offset="1" stopColor="#4f73ff" />
        </linearGradient>
        <linearGradient id={ids.edge} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={glow.b} stopOpacity="0" />
          <stop offset="0.25" stopColor={glow.b} />
          <stop offset="0.5" stopColor={glow.a} />
          <stop offset="0.75" stopColor={glow.b} />
          <stop offset="1" stopColor={glow.b} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={ids.floor} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={glow.a} stopOpacity="0.55" />
          <stop offset="1" stopColor={glow.a} stopOpacity="0" />
        </radialGradient>
        <filter id={ids.blur} x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="5" /></filter>
        <filter id={ids.blurSm} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.5" /></filter>
      </defs>

      {/* Ambient floor light, restrained and tied to the connection state */}
      <ellipse className={tone === "ready" ? "pd-breathe" : undefined} cx={CX} cy={top ? CY : CY + DEPTH + 6} rx={RX + 10} ry={top ? RY + 10 : 21} fill={`url(#${ids.floor})`} style={{ opacity: glow.opacity, transition: "opacity 300ms ease" }} />

      {/* Graphite body side */}
      {DEPTH > 0 && <>
      <path d={`M${CX - RX} ${CY} L${CX - RX} ${CY + DEPTH} A${RX} ${RY} 0 0 0 ${CX + RX} ${CY + DEPTH} L${CX + RX} ${CY} Z`} fill={`url(#${ids.side})`} />
      <path d={`M${CX - RX} ${CY + DEPTH} A${RX} ${RY} 0 0 0 ${CX + RX} ${CY + DEPTH}`} fill="none" stroke={`url(#${ids.edge})`} strokeWidth="5" filter={`url(#${ids.blurSm})`} style={{ opacity: glow.opacity, transition: "opacity 300ms ease" }} />
      <path d={`M${CX - RX} ${CY + DEPTH} A${RX} ${RY} 0 0 0 ${CX + RX} ${CY + DEPTH}`} fill="none" stroke={`url(#${ids.edge})`} strokeWidth="1.6" style={{ opacity: glow.opacity, transition: "opacity 300ms ease" }} />
      </>}

      {/* Bird's-eye view has no side wall, so the state glow rings the rim instead */}
      {top && <>
        <circle cx={CX} cy={CY} r={RX} fill="none" stroke={glow.a} strokeWidth="5" filter={`url(#${ids.blurSm})`} style={{ opacity: glow.opacity * 0.8, transition: "opacity 300ms ease" }} />
        <circle cx={CX} cy={CY} r={RX} fill="none" stroke={glow.a} strokeWidth="1.6" style={{ opacity: glow.opacity, transition: "opacity 300ms ease" }} />
      </>}

      {/* Top rim and tray */}
      <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill={`url(#${ids.top})`} />
      <path d={`M${(CX + RX * Math.cos(Math.PI * 1.06)).toFixed(1)} ${(CY + RY * Math.sin(Math.PI * 1.06)).toFixed(1)} A${RX} ${RY} 0 0 1 ${(CX + RX * Math.cos(Math.PI * 1.7)).toFixed(1)} ${(CY + RY * Math.sin(Math.PI * 1.7)).toFixed(1)}`} fill="none" stroke="#ffffff" strokeOpacity="0.32" strokeWidth="1.2" strokeLinecap="round" />
      <ellipse cx={CX} cy={CY} rx={RX * 0.955} ry={RY * 0.955} fill="#0a0d15" stroke="#ffffff" strokeOpacity="0.06" />
      <ellipse cx={CX} cy={CY - 1} rx={RX * 0.925} ry={RY * 0.91} fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1.1" />

      {/* Compartments 0..7 */}
      {Array.from({ length: 8 }, (_, slot) => {
        const active = slot === highlighted;
        const [lx, ly] = pt(g, 0.64, slot * 45 - 90);
        return (
          <g key={slot}>
            {active && <path d={wedgePath(g, slot)} fill={glow.a} opacity="0.75" filter={`url(#${ids.blur})`} className="pd-breathe" />}
            <path d={wedgePath(g, slot)} fill={active ? `url(#${ids.active})` : `url(#${ids.well})`} stroke={active ? "#cfd0ff" : "#9ca6be"} strokeOpacity={active ? 0.7 : 0.22} strokeWidth={active ? 1.2 : 0.9} style={{ transition: "fill 300ms ease" }} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={view === "angled" ? (active ? 19 : 15) : (active ? 23 : 18)} fontWeight={active ? 700 : 500} fill={active ? "#ffffff" : "#aab3ca"} style={{ pointerEvents: "none" }}>{slot}</text>
          </g>
        );
      })}

      {/* Centre hub */}
      <ellipse cx={CX} cy={CY + 3} rx={RX * 0.26} ry={RY * 0.3} fill="#000" opacity="0.5" filter={`url(#${ids.blurSm})`} />
      <ellipse cx={CX} cy={CY} rx={RX * 0.25} ry={RY * 0.28} fill="#07090f" stroke="#ffffff" strokeOpacity="0.14" />
      <ellipse cx={CX} cy={CY} rx={RX * 0.085} ry={RY * 0.1} fill="none" stroke={glow.a} strokeWidth="1.6" style={{ transition: "stroke 300ms ease" }} />

      {!top && <text x={CX} y={CY + RY + DEPTH * 0.52} textAnchor="middle" fontSize="13" fontWeight={600} letterSpacing="0.8" fill="#c3cae0" fillOpacity="0.85">PillSense</text>}
    </svg>
    {onSelectSlot && Array.from({ length: 8 }, (_, slot) => {
      const [x, y] = pt(g, 0.67, slot * 45 - 90);
      return (
        <button
          key={slot}
          type="button"
          aria-label={slot === 0 ? "Select home reference" : `Select slot ${slot}`}
          aria-pressed={slot === highlighted}
          onClick={() => onSelectSlot(slot)}
          className="pd-focus absolute size-11 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
        />
      );
    })}
    </div>
  );
}
