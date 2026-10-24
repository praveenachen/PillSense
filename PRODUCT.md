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

## Visual Authority (binding, confirmed by user)

- `docs/design/pillsense-ui-reference-v2.png` is the **binding visual specification** for the five primary mobile screens (Today, My Dispenser, Voice Companion, Caregiver, Setup & Slot Mapping) plus Schedule, which follows the same system.
- The existing UI design system (sunset peach/orange gradient `.ps-canvas`, SF bridge scenic accent, current card/typography sizing) is **not authoritative**. It is evidence of what to replace.
- This is a **reference-reproduction project**, not an open-ended redesign. Visual fidelity to the reference outranks preserving existing styling. Do not invent a new aesthetic.
- Target feel: bright, airy, calm, premium consumer med-tech. White and light mist-blue surfaces, restrained seafoam, deep-teal CTAs, dark-navy type.
- Non-negotiable regardless of look: existing functionality, accessibility, authorization (Clerk roles), and hardware safeguards (single MOVE per session, uppercase operation-ID correlation, uncertain-command reconciliation, safety confirmations, mounted-tab BLE behavior).
- Where the reference's illustrative content (e.g. "50% adherence", "92% battery", "Eleanor", Slot 1 pill counts, a live waveform) conflicts with supported data or functionality, use real data and truthful labels or omit the element. Motor completion is never presented as ingestion.
- The 3D dispenser model is deferred to H5B (CAD-derived); keep the current placeholder until then.
- `DESIGN.md` for the replacement system is written **after** implementation, not by documenting the current UI.

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
