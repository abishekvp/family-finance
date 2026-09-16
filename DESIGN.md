# Family Finance — design system

**"Aurora Ledger"**: a modern-fintech layout (calm, data-forward, big tabular figures, generous
whitespace) rendered on frosted-glass surfaces floating over a slow aurora gradient. The aurora
supplies the personality; the glass surfaces stay quiet so dense tables of money stay readable.

The rule that keeps those two halves from fighting: **decoration lives behind and around content,
never underneath a number you have to read.**

---

## 1. Tokens

All colour is declared once in `client/src/styles/tokens.css` as `R G B` triplets, and re-declared
under `.dark`. Tailwind maps each to a utility (`client/tailwind.config.js`), so **markup carries
almost no `dark:` variants** — `bg-surface` means the right thing in both themes.

| Utility | Meaning |
| --- | --- |
| `bg-canvas` | Page background (the aurora sits behind it) |
| `bg-surface` / `bg-surface-raised` / `bg-surface-sunken` | Opaque surfaces; `sunken` for inset wells, chips, tracks |
| `border-line` / `border-line-strong` | Hairline / emphasised dividers |
| `text-ink` / `text-ink-muted` / `text-ink-subtle` | Primary / secondary / tertiary text |
| `text-brand-600`, `bg-brand-soft` | Brand accent and its tint |
| `text-income` / `bg-income-soft` | Positive money |
| `text-expense` / `bg-expense-soft` | Negative money |
| `text-warn`, `text-info` (+ `-soft`) | Advisory / informational |
| `text-aurora-{violet,cyan,mint,amber,coral,plum,indigo,lime}` | Chart series + category swatch fallbacks |

**Never** write raw `slate-*`, `indigo-*`, `gray-*`, `red-*` or `green-*` for UI chrome. Tailwind's
default palette is still available and is fine for the fixed avatar gradients only.

### Surfaces

- `.glass` — the frosted panel: translucent fill, hairline border, inner sheen, soft shadow,
  `backdrop-blur`. Used by `<Card>`, `<Modal>`, `<Popover>`, the sidebar and the tab bar.
- `.glass-solid` — same, but more opaque. Apply **on top of** `.glass` for anything holding dense
  rows or long forms.
- `.brand-gradient` — indigo → violet → cyan. Primary buttons, active indicators, progress fills.
- `.brand-text-gradient` — the same ramp clipped to text. One phrase per screen, maximum.
- `.ring-gradient` — hairline gradient border via a masked pseudo-element. Hero panels only.

### Shape, depth, motion

- Radii: controls `rounded-xl` (1rem), cards `rounded-2xl` (1.25rem), sheets/hero `rounded-3xl`/`4xl`.
- Shadows: `shadow-soft` (resting) → `shadow-lift` (hover) → `shadow-float` (overlay) →
  `shadow-glow` (brand emphasis only).
- Motion: 150 ms for state, 200–300 ms for movement, `ease-swift`; `ease-snap` for a single
  playful overshoot (tab icon). Animations: `animate-rise-in`, `animate-scale-in`,
  `animate-sheet-up`, `animate-fade-in`. All are disabled under `prefers-reduced-motion`.

### Type

`Plus Jakarta Sans` with a system fallback. Figures use `.tnum` (tabular numerals) so columns of
money align — `<Money>` already does this. Scale: `text-2xs` (labels/badges) · `text-xs` (meta) ·
`text-sm` (body, the default) · `text-base`/`text-lg` (card titles) · `text-[1.75rem]` (stat tiles)
· `text-2xl`+ (page hero). Headings are `font-semibold`/`font-bold` and `tracking-tight`.

---

## 2. Components — `client/src/components/ui.tsx`

Import from here rather than re-styling a bare element.

`cn` · `Card` · `CardHeader` · `Divider` · `Button` · `IconButton` · `Label` · `Input` ·
`Textarea` · `Select` · `Field` · `Checkbox` · `Radio` · `Toggle` · `ErrorText` · `SuccessText` ·
`Spinner` · `Skeleton` · `SkeletonRows` · `EmptyState` · `Badge` · `Avatar` · `Dot` ·
`ProgressBar` · `Segmented` · `Chip` · `Modal` · `Popover` · `ToastProvider` / `useToast`

Finance-specific, in `components/figures.tsx`: `Money`, `StatTile`.
Brand: `components/Logo.tsx` → `Logo`, `LogoLockup`.

Notes worth knowing:

- `Button` takes `variant` (`primary` · `secondary` · `outline` · `ghost` · `danger`),
  `size` (`sm` · `md` · `lg`), `loading`, and `icon`. It handles its own spinner — don't
  hand-roll "Saving…" states with a disabled prop alone.
- `Field` renders label + hint + error and wires `aria-describedby`; it calls its child as a
  function with `{ id, "aria-describedby" }` to spread onto the control.
- `Modal` is a centred dialog on desktop and a bottom sheet on phones. It portals to `body`,
  locks scroll, closes on Escape and backdrop click, and restores focus. Put actions in `footer`.
- `Money` renders a formatted, tabular figure. `tone="auto"` colours by sign; omit `tone` for a
  neutral balance; `signed` forces a leading + / −.
- `useToast()(message)` for transient confirmations. It no-ops outside a provider.

---

## 3. Layout

`components/Layout.tsx` owns the shell:

- **≥ lg** — a 236 px glass sidebar with an active pill and gradient rail, plus a sticky top bar.
- **< lg** — sticky top bar plus a bottom tab bar (Overview · Transactions · Insights · Accounts ·
  More). The More sheet holds Settings, Family and Get the app.
- Content is capped at `max-w-6xl` with `px-4 sm:px-6 lg:px-8`, and `pb-28` on phones to clear
  the tab bar. Anything fixed to the bottom on a phone (FAB, sheet) needs `safe-bottom`.

The family/personal scope toggle lives in the top bar (and in the account menu on phones) and
reaches pages through `useOutletContext<LayoutContext>()`.

---

## 4. Patterns

**Page rhythm.** Stat tiles → primary content card → secondary cards. `space-y-5 sm:space-y-6`
between sections. Every page states what it is in its first 100 px.

**Lists.** `divide-y divide-line` inside a `Card`. Rows are `py-3`, tappable rows get
`-mx-2 rounded-xl px-2 hover:bg-surface-sunken`, and each row's leading element is a coloured
`Dot`, `Avatar`, or a `h-10 w-10 rounded-xl` icon chip.

**Loading.** `SkeletonRows` for lists and `StatTile loading` for figures — matching the real
layout. `Spinner` only for a whole-page wait.

**Empty.** `EmptyState` with an icon, a concrete next step in `description`, and an `action`
button where one exists. Never a bare "No data".

**Destructive actions.** Two-step inline confirm (the existing Archive → Confirm/Cancel pattern),
`Button variant="danger"` or `IconButton tone="danger"`. No `window.confirm`.

**Errors.** `ErrorText` for the request-level failure; `Field`'s `error` prop for a single field.

**Money colour.** Income is `text-income`, expenses `text-expense`, plain balances `text-ink`.
A negative balance goes `text-expense`. Colour is never the *only* signal — pair it with a sign
or a label.

**Charts.** Recharts, series colours drawn from the `aurora` ramp, gradient area fills, grid lines
at `rgb(var(--c-line))`, tooltips on `.glass`. A chart always carries a legend or direct labels.

---

## 5. Accessibility

Interactive elements are real `<button>`/`<a>`. Icon-only controls get `aria-label` (use
`IconButton`, which requires it). Focus rings come free from the global `:focus-visible` rule —
never remove them. Both themes are checked at AA for body text. Tap targets are ≥ 40 px on phones.

---

## 6. Mobile (React Native)

`mobile/src/theme.ts` mirrors these tokens for React Native — same brand ramp, same semantics, a
light and a dark palette selected by `useTheme()`. `mobile/src/components/ui.tsx` mirrors the web
primitives (`Card`, `Button`, `Input`, `Segmented`, `Chip`, `Badge`, `Money`, `StatTile`,
`EmptyState`, `Sheet`, `Screen`). Glass comes from `expo-blur`, gradients from
`expo-linear-gradient`, and the aurora backdrop from `AuroraBackground`.

The two apps should feel like one product: same vocabulary, same colours, same figures — but
native conventions (bottom tabs, sheets, pull-to-refresh, haptics) rather than a ported web page.
