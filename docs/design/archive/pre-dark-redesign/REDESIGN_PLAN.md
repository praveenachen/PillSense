# Archived H5A UI redesign: reference-reproduction spec

> **Historical record only.** This plan and the adjacent
> `pillsense-ui-reference-v2.png` are superseded and are not current design
> instructions. Follow [`../../CURRENT_DESIGN_DIRECTION.md`](../../CURRENT_DESIGN_DIRECTION.md).

Historical binding reference: `pillsense-ui-reference-v2.png`.
Presentation only: no Convex, Clerk, Cartesia, BLE, firmware or dose-state changes.

## Design tokens (implemented in `src/app/globals.css`)
- Canvas: `linear-gradient(180deg,#e8f2fd 0%,#f2f8fe 34%,#fbfdff 70%,#fff 100%)`
- Surfaces: white, 1px `#e6eef7` border, radius 17.6px, shadow `0 1px 2px rgba(15,23,42,.04), 0 6px 18px -10px rgba(15,76,117,.16)`
- Colours: seafoam `#14b8a6`, deep teal `#0f766e` → `#0b5d63` (CTA), navy `#0f172a`, slate `#475569`, muted `#64748b`; amber `#f59e0b`; red `#ef4444` (tint `#fdecec`)
- Type: Geist sans everywhere (`.ps-display` is now sans). Fraunces only on the Today greeting (`.ps-greeting`).
  Scale: greeting 22/29, screen title 20, card title 17.6, section 15, body 14, meta 12, chip 11, nav 10.
- Layout: 16px page margin, 12px section gap, card padding 12–14px
- CTA: 54px high, full pill (`.ps-cta`; red `.ps-cta-danger`). Touch targets at least 44px.
- Nav: white, no border, 58px orb with a 3px white ring straddling the bar. Active tab = filled teal icon + bold teal label, no pill.
- Orb (voice): 88px orb, rings 168/~145px, glow behind.

## Screen decisions
- **Today**: header, greeting + hills accent, compact device card, next-medication card (name, "dose · Slot N", instruction, 54px CTA), cardless timeline rail, then the refill reminder.
- **Dispenser**: chips on one row (no "Battery not reported"), floating placeholder, one-line caption (full text in "About this test"), status icon is a check only when READY/steps completed, compact 3-confirmation group (always visible, never collapsed), CTA, one-card secondary actions.
- **Voice**: single status dot line, 88px orb, supported-intent rows only, decorative bars only while listening/speaking (no idle bars), transcript kept.
- **Schedule**: no reference frame; derived from the Today row language. 40px medication thumb, 3.25rem rows, segmented control.
- **Caregiver**: compact patient card, 13px tabs, attention card with red CTA, bold sans metrics (real counts only, no adherence %), 2-line activity rows.
- **Setup**: 28px stepper, floating map, compact slot card and list. Slot 0 stays HOME and selecting a slot never moves hardware.

## Truthfulness rules kept
No fabricated battery, adherence, pill counts, or ingestion. "Reported taken" labels stay. Motor completion is never presented as ingestion.

## Verification
Headless Chrome at 390×844 @2x of the real components via a temporary fixture route (removed). Historical captures are in `redesign/` beside this plan.
