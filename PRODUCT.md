# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Patient** (primary, daily): uses mobile-first screens (Today, Schedule, Voice companion) to see upcoming doses, report `TAKEN`/not taken, and hear reminders.
- **Caregiver** (primary, oversight): sets up medications and schedules, watches alerts, refills, device issues and dispense activity, and acknowledges or resolves unresolved-dose care cases. Also preauthorizes the synthetic demo case.
- Built within a CalHacks hackathon context; all patient data is synthetic.

## Product Purpose

PillSense is a hardware + AI medication-support prototype: an Arduino Uno R4 WiFi dispenser (BLE from the browser), a Next.js/Convex/Clerk web app, a Claude-based care coordinator, and a Fetch.ai uAgent reachable through Agentverse and ASI:One. It keeps a patient's dose schedule, tracks reminder state, and when a dose goes unresolved, investigates the case with bounded evidence tools and returns a non-sensitive result with uncertainty and a safe caregiver follow-up. Success is a caregiver who knows, honestly, what is and is not known about a missed dose.

## Positioning

Evidence-honest adherence support: motor completion never implies ingestion, only a direct patient `TAKEN` report resolves a dose, and the system states its uncertainty instead of guessing. It does not recommend catch-up doses or auto-retry ambiguous commands.

## Operating Context

- Reminder lifecycle: `UPCOMING` → `DUE` → `OVERDUE` → `RESOLVED` (default 60 min lead, 15 min follow-up), reconciled by a five-minute Convex cron and a one-minute patient-screen poll.
- Overdue doses open a versioned care case with a deterministic trigger (no response, motor completed but ingestion unconfirmed, motor outcome unknown, reported not taken, device fault/disconnected).
- Device link is Web Bluetooth with a provisional protocol; BLE status is browser-local, not trusted motor evidence.
- Agent Activity screen shows coordinator and Agentverse investigations.

## Capabilities and Constraints

- Not medical advice. Cannot dispense autonomously, change medication instructions, infer ingestion, or expose private patient information.
- Stack: Next.js 16, React 19, Tailwind 4, Convex, Clerk, Python agents (`agent/`, `fetch_agents/`).
- Routes: `/patient`, `/caregiver`, `/agent-activity`, `/demo`; `/` redirects to `/patient`.
- Hardware is a prototype (slot 6 supervised movement verified); firmware protocol is provisional.
- Undecided: public submission links (Agentverse profile, ASI:One share, repo, demo video, Devpost).

## Brand Commitments

Name: **PillSense**. Fetch.ai agent identity: "PillSense Care Coordinator" (`@pillsense-care-coordinator`).

## Visual Authority

- `docs/design/CURRENT_DESIGN_DIRECTION.md` is the **single binding design specification** for visual styling, interaction, shared components, and screen-by-screen implementation.
- The implemented dark Today experience is the current baseline. Its `pd-*` tokens, hardware-forward eight-position SVG, and shared patient navigation must be preserved while the remaining screens are migrated individually.
- The application is intentionally transitional: Today is dark, while several other screens still use the older light H5A presentation. Those light screens are awaiting redesign and must not be used as authority or as a reason to revert Today.
- Old H5A light/teal mockups, screenshots, and plans are historical records under `docs/design/archive/pre-dark-redesign/`.
- Non-negotiable regardless of presentation: existing functionality, accessibility, authorization, privacy, evidence honesty, camera boundaries, and hardware safeguards such as single MOVE dispatch, operation-ID correlation, uncertain-command reconciliation, and safety confirmations.
- Illustrative content must never invent adherence, battery, physical position, inventory, ingestion, or patient evidence. Motor completion and camera observations remain separate from patient-reported ingestion.

## Evidence on Hand

- Verified live ASI:One → Agentverse → Convex → Claude run on a synthetic case (see README).
- Dispenser CAD: `docs/design/dispenser-cad.3mf`.
- No real patients, testimonials, or clinical claims exist; none may be fabricated.

## Product Principles

1. **Say what is unknown.** Never imply ingestion or safety the evidence doesn't support; show uncertainty plainly.
2. **Patient calm, caregiver clarity.** The patient surface is simple and low-stress; the caregiver surface is scannable and actionable.
3. **Human stays in control.** No autonomous dispensing, dosing advice, or silent retries.
4. **Privacy by default.** Surfaces show only what the role needs; agents see opaque aliases.

## Accessibility & Inclusion

Patients may be older or have limited vision, dexterity, or tech comfort. This is **inferred, not confirmed user research**. No formal standard has been specified. Reference-matching must not shrink touch targets below ~44px or text contrast below WCAG AA; where the reference's small type conflicts, keep the reference's look and meet the floor.
