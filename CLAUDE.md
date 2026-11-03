<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## UI conventions

- **Animations are the standard.** New UI uses the helpers in `src/Motion.tsx` rather than appearing or swapping instantly: `Reveal` for panels and sections that open and close, `Enter` for a screen or card that comes into view, `usePresence` for drawers and overlays that slide in and out, and `SwapIcon` whenever an icon changes to another one. They already respect the system's reduced-motion setting.
- **Theme-aware styles.** Make style sheets with `themed(() => ({ ... }))` from `src/theme.ts` (not `StyleSheet.create`) and use the `colors` / `tint` tokens, never hard-coded hex colours, so dark mode and the text-size setting apply. Give every `Text` and `TextInput` an explicit colour.
