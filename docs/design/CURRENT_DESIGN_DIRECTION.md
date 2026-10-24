# PillSense current design direction

This document is the single authoritative source for PillSense visual styling,
interaction design, component consistency, and screen-by-screen UI work. If an
older mockup, screenshot, plan, comment, or tool suggestion conflicts with this
document, follow this document.

The newly implemented dark Today screen is the current product baseline. The
remaining light screens are a temporary migration state, not a competing design
direction and not a reason to revert Today. No approved dark reference image is
currently stored in the repository; do not invent or substitute one.

## Product identity

PillSense is a premium, AI-native consumer hardware product—not a generic
medication tracker or traditional healthcare dashboard. Its visual character
draws inspiration from Apple hardware interfaces, Nothing's industrial design,
Teenage Engineering's precision, and ambient AI companion products. Use those
references as qualities, not as templates to imitate.

The product should feel dark, minimal, technically sophisticated,
hardware-forward, calm, precise, and trustworthy. Ambient illumination and
restrained motion may communicate state, but decoration must not compete with
the patient's next action.

## Approved system

The dark tokens already implemented in `src/app/globals.css` are:

| Role | Token | Implemented value |
| --- | --- | --- |
| Background | `pd-bg` / `--color-pd-bg` | `#080B13` |
| Elevated surface | `pd-surface` / `--color-pd-surface` | `#101522` |
| Secondary surface | `pd-surface-2` / `--color-pd-surface-2` | `#171D2C` |
| Primary text | `pd-text` / `--color-pd-text` | `#F5F7FF` |
| Secondary text | `pd-muted` / `--color-pd-muted` | `#9CA6BE` |
| Accent | `pd-accent` / `--color-pd-accent` | `#7774FF` |
| Accent highlight | `pd-accent-soft` / `--color-pd-accent-soft` | `#A3A1FF` |
| Secondary accent | `pd-accent-2` / `--color-pd-accent-2` | `#5479FF` |
| Connected/success | `pd-ok` / `--color-pd-ok` | `#35D58A` |
| Attention | `pd-warn` / `--color-pd-warn` | `#FFB547` |
| Subtle border | `pd-line` / `--color-pd-line` | `rgb(255 255 255 / 0.08)` |
| Card radius | `--radius-pd-card` | `1.25rem` |
| Chip radius | `--radius-pd-chip` | `0.875rem` |

These values match the approved palette. The implementation also includes the
intentional `pd-accent-soft` highlight and translucent `pd-line` border.

Use Geist or Inter for the dark product system. Today currently uses Geist. The
repository still loads Fraunces and retains `ps-*` light-theme tokens because
unmigrated screens use them; these are legacy implementation dependencies, not
the direction for new redesign work. Remove them only after their consumers are
migrated and verified—never as incidental cleanup.

### Layout and components

- Build mobile-first for 390 × 844, then explicitly verify 375px and 430px.
- Use a 4px spacing foundation and 20px mobile horizontal padding.
- Keep 16–20px between major components unless a denser control group requires
  an intentional exception.
- Use the existing card radii and surface hierarchy consistently.
- Keep icon size, stroke weight, touch target, and selected states consistent.
- Use the shared fixed patient navigation as the baseline: Home, Dispenser,
  Voice, Schedule, Care.
- Keep content clear of the fixed navigation and device safe areas.
- Preserve visible keyboard focus and approximately 44px minimum touch targets.
- Respect `prefers-reduced-motion`; motion must never be required to understand
  state.

## Visual principles

- Establish one strong information hierarchy and one primary contextual action.
- Prefer clean, professional widgets over long stacks of generic cards.
- Use precise alignment, concise labels, and disciplined typography.
- Let real hardware state and real application data drive visual state.
- Use ambient light, glow, and motion sparingly and consistently.
- Keep every patient screen recognizably part of the same product.

Avoid traditional light healthcare dashboards, excessive teal gradients,
oversized serif headings, random glowing purple objects, decorative medical
illustrations, inconsistent widget dimensions, repetitive developer disclaimers,
and unnecessary technical labels on patient surfaces.

## Experience architecture

### Patient experience

- Today
- My Dispenser
- Voice Companion
- Schedule
- Caregiver
- Setup & Slot Mapping

Patient surfaces should show real medication data or explicitly scoped,
realistic synthetic demo data. Keep engineering explanations out of the primary
flow unless they are necessary for informed consent, safety, or honest evidence
interpretation.

### Developer / Hardware Lab

Developer-oriented tools belong in a distinct lab experience:

- BLE connection and debugging
- Supervised motor testing and its existing acknowledgements
- Camera debugging
- Synthetic scenario controls
- Event provenance
- Agent execution diagnostics

Retain every existing safety boundary. Moving a control must never create a new
or unauthorized motor pathway. Simulated, browser-observed, patient-reported,
and physically verified states must remain visibly distinct.

## Interaction principles

Every screen should answer, in order:

1. What should the patient do next?
2. What is PillSense doing?
3. What happened?
4. Does anything require follow-up?

The intended end-to-end workflow is:

Medication due → voice interaction → patient confirmation → authorized hardware
operation → camera observation → patient report or unresolved status → caregiver
follow-up.

This workflow is not fully integrated until H6C. Do not present reminder-driven
camera orchestration or other H6C behavior as implemented. A camera
hand-to-mouth observation cannot establish that a pill was present, collected,
entered the mouth, or was swallowed. A motor `DONE` result establishes only
completion of the commanded motor steps; it does not establish pill release,
collection, ingestion, or sensor-verified alignment.

## Signature elements

### Hardware visualization

Use the reusable eight-position carousel implemented for Today. Position 0 is
HOME; positions 1–7 are medication compartments. Slot mapping must remain
accurate. The visualization may highlight a scheduled compartment but must not
claim a live physical position, battery value, position sensor, or other
unavailable telemetry.

Do not rebuild the current SVG or add React Three Fiber during design-context
cleanup. A future optional 3D visualization should reuse actual CAD geometry
from `docs/design/dispenser-cad.3mf` when practical and must preserve the same
truthfulness boundaries.

### Voice companion

The Voice experience should feel immersive and ambient, with clearly distinct
idle, listening, thinking, and speaking states. Animation should communicate
real state rather than simulate activity. Preserve the existing Cartesia
integration and its safety limits.

### Navigation

The existing shared patient navigation is the baseline. Preserve its five
destinations, spacing, icon language, selected state, fixed placement, and safe
area behavior across migrated screens.

## Implementation sequence

Today is implemented and awaits live Clerk/Convex visual and functional review.
Its 390 × 844 headless check passed; 375px and 430px still require verification.

Migrate the remaining screens separately in this order:

1. My Dispenser
2. Voice Companion
3. Schedule
4. Caregiver
5. Setup & Slot Mapping
6. Developer / Hardware Lab

For each screen, preserve its data and safety behavior, implement only that
surface, and perform explicit responsive and state-based visual verification
before moving to the next screen.

## Historical references and conflict resolution

The light/mist-blue H5A reference, its screenshots, and its reproduction plan
are archived in `docs/design/archive/pre-dark-redesign/`. They document a prior
milestone only. They are not valid visual targets, quality bars, palettes, or
sources of truth for future work.

Some runtime files still contain `ps-*` styles and historical H5A comments
because light screens remain operational during migration. Treat those lines as
the actual implementation of unmigrated screens—not as active design
instructions. Do not remove or reinterpret them until the corresponding screen
is deliberately redesigned.

Future approved per-screen reference images belong in
`docs/design/references/`. A reference becomes binding only when this document
or an explicit user instruction identifies it as approved.

## Functional invariants

Visual work must not change Convex or Clerk authorization, medication and
schedule state machines, caregiver access, refill workflows, Cartesia behavior,
Claude or Fetch.ai execution, the H6B camera boundary, Arduino firmware, BLE
command semantics, command idempotency, uncertain-outcome handling, or hardware
safety confirmations. Never fabricate patient data, medication evidence,
battery state, physical position, adherence, or clinical claims to match a
composition.
