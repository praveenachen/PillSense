<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

## Visual design authority

`docs/design/CURRENT_DESIGN_DIRECTION.md` is the single authoritative visual
and interaction specification. The implemented dark Today screen, its `pd-*`
tokens, eight-position dispenser SVG, and shared patient navigation are the
current baseline. Remaining light screens are transitional and await
screen-by-screen migration; do not use them to revert Today.

Old H5A light/teal references are historical only and live under
`docs/design/archive/pre-dark-redesign/`. Presentation work must never alter
Convex, Clerk, BLE, voice, camera, medication-state, or hardware-safety
behavior.

<!-- convex-ai-end -->
