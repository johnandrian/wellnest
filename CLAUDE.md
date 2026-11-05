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
- **Two looks.** The app has a soft and a classic look, set for developers in `src/design.ts` (`DESIGN`, or `EXPO_PUBLIC_DESIGN`); people using the app never choose. New UI must look right in both: build it from `ui.card`, `ui.button`, `ui.addButton`, `radius` and the colour tokens (the `bar*` tokens for top bars), which change with the look, and check `isSoft()` from `src/theme.ts` only where a token can't express the difference.

## Commits

- **Small commits, 2 or 3 changes each.** When a batch of work is committed, split it into several commits of 2 or 3 related fixes or features each, rather than one commit for everything. A large feature (new screens, new tables, a big rework) gets a commit of its own, and a really big change (a redesign across many screens, a rework touching many files) is split further into as many commits as it naturally breaks into, for example one per area or step, each one working on its own. Each commit carries its own code, strings, tests and README lines. Stage by file, or by hunk when a file such as `src/i18n.ts` or `README.md` carries parts of several features, and make sure each commit still typechecks.
- **Still ask first.** Commit, push or deploy only when asked; splitting is about how a batch is committed, not about committing sooner.
- **Message format:** `feat:`, `fix:` or `doc:` and one plain sentence about that commit only, no em dashes.
