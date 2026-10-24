import type { ReactNode } from "react";

/* Shared H5A presentation primitives. Everything here is purely visual; no data access. */

export type IconName =
  | "home" | "cube" | "mic" | "calendar" | "people" | "bell" | "bluetooth" | "info"
  | "chart" | "check" | "chevron" | "back" | "gear" | "close" | "alert" | "pill"
  | "chat" | "refresh" | "wave" | "arrow" | "link" | "clock" | "shield";

export function Icon({ name, size = 22, strokeWidth = 1.8, className }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className, "aria-hidden": true };
  switch (name) {
    case "home": return <svg {...p}><path d="M4 11.5 12 4.5l8 7" /><path d="M6 10.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1v-8.5" /></svg>;
    case "cube": return <svg {...p}><path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2L12 3Z" /><path d="m4 7.2 8 4.3 8-4.3M12 11.5V21" /></svg>;
    case "mic": return <svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" /></svg>;
    case "calendar": return <svg {...p}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;
    case "people": return <svg {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16.5 14.2c2.3.2 3.7 1.7 4 4.3" /></svg>;
    case "bell": return <svg {...p}><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>;
    case "bluetooth": return <svg {...p}><path d="m7 7.5 10 9-5 4.5V3l5 4.500-10 9" /></svg>;
    case "info": return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.2M12 7.8v.1" /></svg>;
    case "chart": return <svg {...p}><path d="M5 20V12M10 20V6M15 20v-9M20 20V9" /></svg>;
    case "check": return <svg {...p}><path d="m5 12.5 4.5 4.5L19 7.500" /></svg>;
    case "chevron": return <svg {...p}><path d="m9.5 5.500 6.500 6.500-6.500 6.500" /></svg>;
    case "back": return <svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
    case "gear": return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3.500v2.200M12 18.300v2.200M3.500 12h2.200M18.300 12h2.200M6 6l1.500 1.500M16.500 16.500 18 18M18 6l-1.500 1.500M7.500 16.500 6 18" /></svg>;
    case "close": return <svg {...p}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "alert": return <svg {...p}><path d="M12 4 3.500 19h17L12 4Z" /><path d="M12 10v4M12 16.500v.1" /></svg>;
    case "pill": return <svg {...p}><rect x="3.500" y="8.500" width="17" height="7" rx="3.500" transform="rotate(-40 12 12)" /><path d="m9.500 9.500 5 5" /></svg>;
    case "chat": return <svg {...p}><path d="M5 5.500h14a1.500 1.500 0 0 1 1.500 1.500v8a1.500 1.500 0 0 1-1.500 1.500H11l-4.500 3.500v-3.500H5A1.500 1.500 0 0 1 3.500 15V7A1.500 1.500 0 0 1 5 5.500Z" /></svg>;
    case "refresh": return <svg {...p}><path d="M19.500 12a7.500 7.500 0 1 1-2.300-5.400M19.500 4.500v4h-4" /></svg>;
    case "wave": return <svg {...p}><path d="M4 12v0M7 9v6M10 6v12M13 9v6M16 7v10M19 11v2" /></svg>;
    case "arrow": return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "link": return <svg {...p}><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="8.500" /><path d="M12 7.500V12l3 2" /></svg>;
    case "shield": return <svg {...p}><path d="M12 3.500 5 6v5.500c0 4.200 2.800 7.200 7 9 4.200-1.800 7-4.800 7-9V6l-7-2.500Z" /><path d="m9 12 2.200 2.200L15.500 10" /></svg>;
  }
}

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#2dd4bf] to-[#0f766e] text-white shadow-[0_6px_14px_-8px_rgba(15,118,110,0.7)]" style={{ width: size, height: size }}>
      <Icon name="pill" size={Math.round(size * 0.55)} strokeWidth={2} />
    </span>
  );
}

/** Detailed capsule-and-tablet illustration for medication tiles. Purely decorative. */
export function MedicationIcon({ size = 72 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#eef6ff] to-[#dbeafb] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" style={{ width: size * 0.78, height: size * 0.78 }}>
        <defs>
          <linearGradient id="ps-cap-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3fc3b3" /><stop offset="1" stopColor="#0f766e" /></linearGradient>
          <linearGradient id="ps-cap-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dfe7f0" /></linearGradient>
          <linearGradient id="ps-tab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fffdf8" /><stop offset="1" stopColor="#e8dcc6" /></linearGradient>
        </defs>
        <ellipse cx="32" cy="56" rx="22" ry="3.5" fill="#0f3d57" opacity="0.12" />
        <g transform="rotate(-35 30 28)">
          <rect x="6" y="19" width="48" height="19" rx="9.5" fill="url(#ps-cap-b)" stroke="#b9c6d6" strokeWidth="1" />
          <path d="M30 19h15.500a9.500 9.500 0 0 1 0 19H30Z" fill="url(#ps-cap-a)" />
          <rect x="11" y="22" width="30" height="4" rx="2" fill="#fff" opacity="0.65" />
          <path d="M30 19v19" stroke="#064e48" strokeOpacity="0.3" />
        </g>
        <g transform="translate(40 40)">
          <circle r="10" fill="url(#ps-tab)" stroke="#cdbf9f" strokeWidth="1" />
          <path d="M-8 0h16" stroke="#b8a883" strokeWidth="1.600" strokeLinecap="round" />
          <path d="M-6 -5.500a8 8 0 0 1 8-2.500" stroke="#fff" strokeWidth="1.600" strokeLinecap="round" fill="none" opacity="0.9" />
        </g>
      </svg>
    </span>
  );
}

const reminderTone = {
  amber: { box: "border-[#f6c86b] bg-gradient-to-br from-[#fff6dd] to-[#ffe9c2]", badge: "bg-[#f59e0b] text-white", title: "text-[#6b4200]", body: "text-[#7c5a14]" },
} as const;

/** Reusable soft reminder card: icon badge, title, plain-language message and optional detail lines. */
export function ReminderCard({ title, message, items, footnote, tone = "amber", icon = "bell" }: { title: string; message: string; items?: Array<{ id: string; label: string; detail: string }>; footnote?: string; tone?: keyof typeof reminderTone; icon?: IconName }) {
  const t = reminderTone[tone];
  return (
    <section aria-label={title} className={`rounded-2xl border p-3.5 shadow-[0_6px_16px_-12px_rgba(180,83,9,0.45)] ${t.box}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full ${t.badge}`}><Icon name={icon} size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className={`text-[0.95rem] font-semibold leading-tight ${t.title}`}>{title}</h2>
          <p className={`mt-1 text-sm leading-5 ${t.body}`}>{message}</p>
        </div>
      </div>
      {items && items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/75 px-3 py-2.5">
              <span className="min-w-0 truncate text-sm font-semibold text-[#0f172a]">{item.label}</span>
              <span className="shrink-0 text-sm font-medium text-[#8a5a00]">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {footnote && <p className={`mt-3 text-xs leading-5 ${t.body}`}>{footnote}</p>}
    </section>
  );
}

export function ScreenHeader({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 pb-3">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back to Today" className="ps-focus -ml-2 grid size-11 shrink-0 place-items-center rounded-full text-[#0f172a] hover:bg-white/70">
          <Icon name="back" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="ps-display truncate text-[1.25rem] font-semibold leading-tight text-[#0f172a]">{title}</h2>
        {subtitle && <p className="truncate text-xs text-[#64748b]">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export type PillTone = "teal" | "mist" | "amber" | "coral" | "slate" | "green";

const toneClass: Record<PillTone, string> = {
  teal: "bg-[#d9f5ef] text-[#0b5d63]",
  mist: "bg-[#e3efff] text-[#1e4f8a]",
  amber: "bg-[#fef3d7] text-[#8a5a00]",
  coral: "bg-[#fde4e4] text-[#b42323]",
  slate: "bg-[#e8eef5] text-[#475569]",
  green: "bg-[#d9f5ef] text-[#0b6b5f]",
};

export function StatusPill({ tone = "slate", children, dot }: { tone?: PillTone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold ${toneClass[tone]}`}>
      {dot && <span aria-hidden="true" className="size-2 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-1">
      <h3 className="text-[0.9rem] font-semibold text-[#0f172a]">{children}</h3>
      {action}
    </div>
  );
}

/** Soft green hills and a sun in morning haze, used only on the Today greeting. Decorative. */
export function ScenicAccent() {
  return (
    <svg aria-hidden="true" viewBox="0 0 220 130" className="pointer-events-none absolute -right-4 -top-2 h-32 w-52">
      <defs>
        <linearGradient id="ps-hill-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fd0b0" stopOpacity="0.55" /><stop offset="1" stopColor="#d9f0e6" stopOpacity="0" /></linearGradient>
        <linearGradient id="ps-hill-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b7e1cf" stopOpacity="0.6" /><stop offset="1" stopColor="#eaf6f1" stopOpacity="0" /></linearGradient>
        <linearGradient id="ps-hill-fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.45" stopColor="#fff" stopOpacity="1" /></linearGradient>
        <mask id="ps-hill-mask"><rect width="220" height="130" fill="url(#ps-hill-fade)" /></mask>
      </defs>
      <g mask="url(#ps-hill-mask)">
        <path d="M20 70 C60 40 100 58 140 36 C170 20 200 30 220 22 V130 H20Z" fill="url(#ps-hill-a)" />
        <path d="M60 92 C100 66 140 86 180 58 C198 46 210 50 220 46 V130 H60Z" fill="url(#ps-hill-b)" />
      </g>
    </svg>
  );
}

export function SunGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 text-[#f5b83a]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.25" />
      <path d="M12 2.500v2.200M12 19.300v2.200M2.500 12h2.200M19.300 12h2.200M5.300 5.300l1.500 1.500M17.200 17.200l1.500 1.500M18.700 5.300l-1.500 1.500M6.800 17.200l-1.500 1.500" />
    </svg>
  );
}

export function Avatar({ name, size = 40, tone = "teal" }: { name: string; size?: number; tone?: "teal" | "mist" }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full font-semibold ${tone === "teal" ? "bg-[#d9f5ef] text-[#0b5d63]" : "bg-[#e3efff] text-[#1e4f8a]"}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* Carousel placeholder / slot map.                                           */
/* Real carousel positions are 0..7. Slot 0 is HOME; slots 1..7 are usable.   */
/* This is illustrative geometry only: it never reflects live position.       */
/* ------------------------------------------------------------------------- */

const CENTER = 120;
const FLAT_RADIUS = 104;
const VERTEX_RADIUS = FLAT_RADIUS / Math.cos(Math.PI / 8);
const HUB_RADIUS = 40;

function polar(radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return [CENTER + radius * Math.cos(radians), CENTER + radius * Math.sin(radians)] as const;
}

function wedgePoints(slot: number) {
  const mid = slot * 45 - 90;
  const [ox1, oy1] = polar(VERTEX_RADIUS, mid - 22.5);
  const [ox2, oy2] = polar(VERTEX_RADIUS, mid + 22.5);
  const [ix2, iy2] = polar(HUB_RADIUS + 4, mid + 17);
  const [ix1, iy1] = polar(HUB_RADIUS + 4, mid - 17);
  return `${ox1},${oy1} ${ox2},${oy2} ${ix2},${iy2} ${ix1},${iy1}`;
}

export type CarouselProps = {
  /** "placeholder" is the restrained model stand-in; "map" is the selectable setup map. */
  variant: "placeholder" | "map";
  selectedSlot?: number | null;
  /** Slot highlighted as the single supported supervised motor-test target. */
  testTargetSlot?: number | null;
  occupiedSlots?: ReadonlySet<number>;
  onSelectSlot?: (slot: number) => void;
};

export function CarouselGraphic({ variant, selectedSlot = null, testTargetSlot = null, occupiedSlots, onSelectSlot }: CarouselProps) {
  const interactive = variant === "map" && Boolean(onSelectSlot);
  return (
    <svg viewBox="0 0 240 240" role="img" aria-label="Illustrative eight-position carousel diagram. Position 0 is the home reference. This diagram does not show live device position." className="mx-auto block w-full max-w-[17rem]">
      <defs>
        <linearGradient id="ps-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fbf8f2" /><stop offset="1" stopColor="#ddd5c6" /></linearGradient>
        <linearGradient id="ps-well" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#efe9dd" /><stop offset="1" stopColor="#f9f6ef" /></linearGradient>
        <linearGradient id="ps-sel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#14b8a6" /><stop offset="1" stopColor="#0f766e" /></linearGradient>
        <filter id="ps-soft" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0f3d57" floodOpacity="0.18" /></filter>
      </defs>
      <ellipse cx="120" cy="228" rx="90" ry="8" fill="#0f3d57" opacity="0.12" />
      {/* Dispensing chute, behind the body */}
      <g transform={`translate(${polar(116, 45).join(" ")}) rotate(45)`}>
        <rect x="-20" y="-12" width="40" height="24" rx="9" fill="url(#ps-body)" stroke="#cfc6b5" strokeWidth="1.2" />
        <rect x="-12" y="-5" width="24" height="10" rx="5" fill="#d8cfbd" />
      </g>
      {/* Extruded edge gives the body visible thickness */}
      <polygon points={Array.from({ length: 8 }, (_, i) => polar(VERTEX_RADIUS + 4, i * 45 - 67.5).join(",")).join(" ")} transform="translate(0 6)" fill="#c9bfab" stroke="#b9ae98" strokeWidth="1.2" />
      <polygon points={Array.from({ length: 8 }, (_, i) => polar(VERTEX_RADIUS + 4, i * 45 - 67.5).join(",")).join(" ")} fill="url(#ps-body)" stroke="#cfc6b5" strokeWidth="1.5" filter="url(#ps-soft)" />
      <polygon points={Array.from({ length: 8 }, (_, i) => polar(VERTEX_RADIUS - 2, i * 45 - 67.5).join(",")).join(" ")} fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.200" />
      {Array.from({ length: 8 }, (_, slot) => {
        const selected = selectedSlot === slot;
        const target = testTargetSlot === slot;
        const home = slot === 0;
        const [lx, ly] = polar(78, slot * 45 - 90);
        const occupied = occupiedSlots?.has(slot) ?? false;
        const fill = selected ? "url(#ps-sel)" : target && variant === "placeholder" ? "url(#ps-sel)" : "url(#ps-well)";
        const light = selected || (target && variant === "placeholder");
        const label = home ? "Slot 0 — home reference" : `Slot ${slot}${target ? " — supervised test target" : ""}${occupied ? ", assigned" : ""}`;
        return (
          <g
            key={slot}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? label : undefined}
            aria-pressed={interactive ? selected : undefined}
            onClick={interactive ? () => onSelectSlot?.(slot) : undefined}
            onKeyDown={interactive ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectSlot?.(slot); } } : undefined}
            style={interactive ? { cursor: "pointer" } : undefined}
            className="outline-none focus-visible:[&>polygon]:stroke-[#0f766e] focus-visible:[&>polygon]:stroke-[3]"
          >
            <polygon points={wedgePoints(slot)} fill={fill} stroke={home ? "#0f766e" : "#cfc6b5"} strokeWidth={home ? 1.6 : 1} strokeDasharray={home ? "4 3" : undefined} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={home ? 12 : 17} fontWeight={600} fill={light ? "#ffffff" : home ? "#0f766e" : "#8a8474"} style={{ pointerEvents: "none" }}>
              {home ? "HOME" : slot}
            </text>
            {occupied && !light && <circle cx={lx} cy={ly + 15} r="3.2" fill="#14b8a6" style={{ pointerEvents: "none" }} />}
          </g>
        );
      })}
      <circle cx={CENTER} cy={CENTER + 3} r={HUB_RADIUS} fill="#cfc6b5" />
      <circle cx={CENTER} cy={CENTER} r={HUB_RADIUS} fill="url(#ps-body)" stroke="#cfc6b5" strokeWidth="1.2" />
      <circle cx={CENTER} cy={CENTER} r={HUB_RADIUS - 6} fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="1" />
      <g transform="translate(120 120) rotate(-40)">
        <rect x="-15" y="-7" width="30" height="14" rx="7" fill="#e6f4fb" stroke="#9cc4dd" strokeWidth="1.2" />
        <rect x="-15" y="-7" width="15" height="14" rx="7" fill="#bfe0f2" />
      </g>
    </svg>
  );
}
