# Style Guide — dark theme

The visual contract for every app in this repo. Screen UI is **dark only**. There is no
light theme and no toggle.

Scope: `web/src/index.css` owns the tokens; every other stylesheet consumes them. A new app
under `web/src/apps/` styles itself entirely out of these tokens and adds none of its own
raw colors.

## 1. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Theme modes | Dark only, no toggle | One surface to design and test against. A toggle doubles the review burden for a personal toolbox that is only ever used dark. |
| How dark is delivered | Values live directly in `:root` | The `@media (prefers-color-scheme: dark)` override block is deleted, not inverted. A media query implies a light branch exists; none does. |
| Grey temperature | Cool slate (blue-tinted) | Continuous with the palette already shipped. Both accents sit cleanly on it — purple stays purple rather than drifting mauve, green stays green rather than drifting olive. |
| Accent roles | Purple interactive, green semantic | One color means "you can click this". A second interactive color makes the user ask which button is the real one. See §3. |
| Token growth | Additive | Existing names (`--text`, `--bg`, `--accent`, …) keep their meaning, so no existing rule needs rewriting. New tokens cover surfaces, states, and focus. |
| Print | Always light, always ink-on-white | Independent of the screen theme. See §6. |
| Contrast target | WCAG AA — 4.5:1 text, 3:1 UI | Every pair in §2 is measured, not eyeballed. Ratios are recorded so a future palette edit can be checked against them. |

### 1.1 Green appearing rarely is the intended outcome

Purple carries the interactive load, so green only shows up on success and valid states —
today that is a thin slice of the UI. That is the point: when green does appear it means
something. Green is not to be used for decoration, for headings, or to make a screen look
more colorful. If a screen feels flat, the fix is spacing and type hierarchy, not painting
something green.

## 2. Tokens

All of this replaces the current `:root` block **and** the
`@media (prefers-color-scheme: dark)` block in `web/src/index.css`.

### 2.1 Surfaces and text

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#16171d` | Page background. The floor; nothing sits behind it. |
| `--surface` | `#1f2028` | Cards and control panels. One step up from the page. |
| `--surface-2` | `#2a2c36` | Anything sitting *on* a panel: inputs, textareas, notices. Also hovered surfaces and popovers. |
| `--code-bg` | `var(--surface)` | Inline `code` and code-like blocks. An alias, not a second value — it is the same plane as `--surface` and follows it. |
| `--border` | `#2e303a` | Decorative separators — panel edges, dividers, rules. |
| `--border-strong` | `#767b8a` | Borders that carry meaning: input and textarea outlines. Meets the 3:1 UI floor on `--surface-2`, where inputs actually sit. |
| `--text` | `#9ca3af` | Body copy, labels, secondary text. |
| `--text-h` | `#f3f4f6` | Headings, input values, grid letters — anything that should read as primary. |
| `--shadow` | `rgba(0,0,0,0.4) 0 10px 15px -3px, rgba(0,0,0,0.25) 0 4px 6px -2px` | Elevation on hover. |

Surface steps are deliberately close together (1.10–1.29:1). They read as depth, not as
stripes. Depth is reinforced by `--border` and `--shadow`, never by surface contrast alone
— so a surface change on its own must never be the only signal that something is
interactive.

### 2.2 Purple — interactive

| Token | Value | Use |
| --- | --- | --- |
| `--accent` | `#c084fc` | Link text, button text, focus ring, active state. |
| `--accent-bg` | `rgba(192,132,252,0.15)` | Button and tile fills. |
| `--accent-border` | `rgba(192,132,252,0.5)` | Button and tile borders at rest. |

### 2.3 Green — semantic, success and validity

| Token | Value | Use |
| --- | --- | --- |
| `--success` | `#4ade80` | Confirmation text, valid-state icons. |
| `--success-bg` | `rgba(74,222,128,0.15)` | Fill behind a success message or a highlighted match. |
| `--success-border` | `rgba(74,222,128,0.5)` | Border on a success panel. |

These three are **declared but not yet consumed** — no screen in the app has a success or
valid state today. The values are recorded and contrast-checked so the first one to need
green does not invent a shade; do not read their presence as a feature that exists.

### 2.4 Red — errors only

| Token | Value | Use |
| --- | --- | --- |
| `--danger` | `#f87171` | Error text, invalid input messages. |
| `--danger-bg` | `rgba(248,113,113,0.15)` | Fill behind an error panel. |

Red is reserved for errors. It is not a destructive-action color here, and it is not a
brand color. **`#c0392b` (`.ws-error` in `wordsearch.css`) is retired** — it scores 3.29:1
on `--bg`, below the 4.5:1 text floor, and fails outright on raised surfaces. `--danger`
replaces it.

### 2.5 Focus

| Token | Value | Use |
| --- | --- | --- |
| `--focus-ring` | `var(--accent)` | Every `:focus-visible` outline, site-wide. Aliased to the accent so a palette change moves the ring with it; give it its own value the day the ring should diverge. |

Focus is always `2px solid var(--focus-ring)` with `outline-offset: 2px`. It is never
removed and never restyled per component — a keyboard user should be able to learn the
ring once. This is enforced by a single bare `:focus-visible` rule in `web/src/index.css`;
app stylesheets do not declare focus outlines at all, so every new interactive element is
covered the moment it exists.

### 2.6 Measured contrast

Ratios against the surface each token is expected to appear on.

| Foreground | on `--bg` | on `--surface` | on `--surface-2` | Verdict |
| --- | --- | --- | --- | --- |
| `--text` `#9ca3af` | 7.04 | 6.38 | 5.47 | AA body text everywhere |
| `--text-h` `#f3f4f6` | 16.25 | 14.73 | 12.62 | AAA everywhere |
| `--accent` `#c084fc` | 6.77 | 6.13 | 5.26 | AA as text and as UI |
| `--success` `#4ade80` | 10.26 | 9.30 | 7.97 | AA everywhere |
| `--danger` `#f87171` | 6.46 | 5.86 | 5.02 | AA everywhere |
| `--border-strong` `#767b8a` | 4.23 | 3.84 | 3.29 | Meets 3:1 on every surface, including `--surface-2` where inputs sit |
| `--border` `#2e303a` | 1.36 | 1.24 | 1.06 | Decorative only — never the sole carrier of meaning |

Re-run these before changing any value. They were computed with the WCAG 2.x relative
luminance formula.

## 3. Color roles

**Purple means interactive.** Links, focus rings, primary buttons, clickable tile accents.
If a thing responds to a click, it is purple. If a thing is purple, it responds to a click.

**Green means it worked, or it is valid.** Success messages, valid-input affordances,
Never a button, never a link, never a heading.

**Red means it is broken.** Validation failures and error messages. Nothing else.

**Grey carries everything else.** Structure, copy, borders, surfaces. Most of the UI is
grey, and that is what lets the three accents register at all.

Anything not in §2 is not in the palette. No new raw hex values in app stylesheets — add a
token here first.

## 4. Type

Unchanged by this spec; recorded so it lives in one place.

| Token | Value |
| --- | --- |
| `--sans` | `system-ui, 'Segoe UI', Roboto, sans-serif` |
| `--heading` | same as `--sans` |
| `--mono` | `ui-monospace, Consolas, monospace` |

Base: `18px/145%`, `letter-spacing: 0.18px`, dropping to `16px` under `1024px`.
`h1` is `56px` (`36px` under `1024px`), `h2` is `24px` (`20px`), both `font-weight: 500`
in `--text-h`. Monospace is for generated or data-like content — the word search grid, the
word list textarea, inline `code` — not for UI chrome.

## 5. Component rules

**Panels** (`.ws-controls` and its descendants): `--surface` background, `1px solid
var(--border)`, `10px` radius. A panel always paints its background — a border alone
leaves it reading as a wireframe rather than a card.

**Inputs and textareas**: `--surface-2` background, `1px solid var(--border-strong)`,
`--text-h` value text, `6px` radius. Inputs live *on* a panel, so they take the step above
it: `--bg` < `--surface` (panel) < `--surface-2` (input). The stronger border is what makes
the field edge findable — an input must never be distinguishable from its panel by
background alone.

**Primary buttons**: `--accent-bg` fill, `1px solid var(--accent-border)`, `--accent`
text. On hover the border goes to `--accent`. Disabled is `opacity: 0.5` with
`cursor: default`.

**Tiles** (`.tile`): `--accent-bg` fill, `2px solid var(--border)`, going to
`--accent-border` plus `--shadow` on hover. Disabled tiles keep `opacity: 0.55` and
`filter: grayscale(1)`.

**Messages**: error text in `--danger`; success text in `--success`; a panel form of either
uses the matching `-bg` and `-border` tokens.

**Disabled** is always opacity plus `cursor: default`. It is never communicated by color
alone, because at reduced opacity the accent hues converge on the grey they sit on.

## 6. Print

Screen is dark; **print is always black on white**, regardless of anything in §2. The
`@media print` block in `wordsearch.css` already enforces this with `!important` overrides
on `:root`, `body`, and `#root`, and it stays. A dark-only screen theme does not reach
paper.

Any new printable app repeats the same override: reset background to `#fff`, text to
`#000`, drop borders and layout constraints, and hide controls and chrome. Do not print
accent colors — a purple link on paper is just grey.

## 7. How the conversion landed

A record of the decisions the dark-only switch encoded, so the reasoning survives the
commit. All of it is in the code already — this is not a task list.

1. **`web/src/index.css`** owns every value in §2 directly in `:root`. The
   `@media (prefers-color-scheme: dark)` block was deleted rather than inverted, and
   `color-scheme` is `dark` (not `light dark`) so form controls, scrollbars, and the
   browser's own UI render dark.
2. **`web/index.html`** carries `<meta name="color-scheme" content="dark">`, so the
   browser paints the right background before CSS parses and there is no white flash on
   first load. It is not redundant with the CSS declaration: the meta covers the pre-CSS
   paint, the declaration is the durable one.
3. **`.ws-controls`** paints `background: var(--surface)`. It previously had only a
   border, so the panel read as a wireframe over the page.
4. **Inputs and textareas** sit on `--surface-2` with a `--border-strong` edge, one plane
   above the panel that contains them, rather than punching back through to `--bg`.
5. **`.ws-error`** and **`.ws-warning`** consume `--danger` and `--surface-2`; the retired
   `#c0392b` was the last raw screen color in an app stylesheet.
6. **Focus** is one bare `:focus-visible` rule in `index.css` (§2.5). App stylesheets
   declare no focus outlines, so there is nothing to keep in sync and nothing to forget on
   a new element.
7. `HomePage.css` consumes only tokens and inherited the new theme for free.

## 8. Out of scope

- A light theme or a theme toggle. Explicitly rejected, not deferred.
- Per-app accent colors. Every app uses the one palette.
- Motion, easing, and transition tokens. Current transitions (`0.3s` on border and shadow)
  stay ad hoc until there is a second case that needs to match.
- A raw-scale/semantic-alias token architecture (`--grey-900` → `--color-bg`). Revisit if
  the app count grows enough that §2 stops fitting on one screen.
