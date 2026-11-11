# Humble House design tokens

Scraped from the live marketing site at `https://humblehouseauto.com/`
on 2026-11-11. These are the **house tokens** — the ops app
(sign-in, My homepage, commissions admin, operator landing) and all
HH-branded UI use them.

**Scope exemption**: builder-branded surfaces — Lookbook PDF, `/q`
public quote page, Purchase Order PDF, Build Sheet PDF, and the
public BuilderShell at `/b/:slug` — read their palette from
`builder_brand` per builder and must NOT inherit these tokens.

## Fonts

| role | family | weights | source |
|---|---|---|---|
| display (headings) | **Playfair Display** | 400 regular, 500 medium, 400 italic | Google Fonts |
| body / UI | **Jost** | 300 light, 400 regular, 500 medium | Google Fonts |

Live site loads them from:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
```

The ops app mirrors this link in `index.html` rather than scraping
CSS from the marketing host. No external CSS from humblehouseauto.com
is loaded at runtime.

## Palette

| token | hex | role |
|---|---|---|
| `--hh-green` | `#29473b` | primary ink / headings on cream / nav text |
| `--hh-green-dark` | `#0e1a10` | hero / deepest accent |
| `--hh-gold` | `#c49e4b` | brand accent — buttons, chip background, focus ring |
| `--hh-gold-accent` | `#dbb04f` | lighter gold hover / hairline |
| `--hh-cream` | `#f8f5ee` | page background |
| `--hh-white` | `#ffffff` | surface |
| `--hh-text` | `#1a1a18` | body text (same as `--hh-body`) |
| `--hh-body` | `#1a1a18` | body text |
| `--hh-muted` | `#444444` | secondary text / meta |
| `--hh-border` | `#ddd6c8` | hairlines, card borders, table dividers |

## Typography scale

Pulled from the marketing site's declarations:

| element | family | size | weight | line-height | colour |
|---|---|---|---|---|---|
| body | Jost | 17px | 400 | 1.85 | `--hh-text` on `--hh-cream` |
| `h1` (hero) | Playfair Display | `clamp(36px, 5.5vw, 68px)` | 400 | 1.12 | `--hh-cream` on green |
| `h2` | Playfair Display | 30px | 400 | 1.2 | `--hh-green` |
| `h3` | Playfair Display | 28px | 400 | 1.3 | `--hh-cream` |
| nav / small cap link | Jost | 16px | 600 | 1 | `--hh-green` |
| meta / muted | Jost | 15px | 400 | 1.7 | `--hh-muted` |

**Uppercase convention**: nav links, buttons, section labels are
`text-transform: uppercase` with `letter-spacing: 0.08em` (nav) to
`0.2em` (btn-solid). Headings stay mixed case.

## Buttons

- Border radius: **2px** everywhere except cards (6px) and avatars
  (50%).
- All text in UPPERCASE, Jost, letter-spacing 0.14-0.2em.
- Two primary variants:

```css
.hh-btn-solid {
  background: var(--hh-gold);
  border: 1px solid var(--hh-gold);
  color: var(--hh-green);
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  padding: 16px 38px;         /* desktop CTA */
  border-radius: 2px;
}
.hh-btn-solid:hover { opacity: 0.86; }

.hh-btn-outline {
  border: 1px solid var(--hh-gold);
  color: var(--hh-gold);
  background: transparent;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  padding: 16px 38px;
  border-radius: 2px;
}
.hh-btn-outline:hover {
  background: var(--hh-gold);
  color: var(--hh-green);
}
```

Compact nav button (sidebar / toolbar): 8px 20px, letter-spacing 0.08em.

## Links

- Uppercase, 600, letter-spacing 0.08em, colour `--hh-green`.
- Hover: `--hh-gold`, no underline transition.
- Inline links in body copy may opt into sentence case; still coloured
  `--hh-green` and hover `--hh-gold`.

## Spacing feel

- Page background `--hh-cream`; cards `--hh-white` with `--hh-border`
  1px hairline and 6px radius.
- Body text runs at 17px / 1.85 — airy, lots of leading.
- Section padding on the marketing site is generous (padding-block
  6-8rem on content sections); ops shell adapts to 2rem / 2.5rem
  since it's dense tabular work.
- Shadows are not used on the marketing site. Elevations are
  implied by surface colour + the beige hairline.

## How this maps to the app's existing variables

The ops app uses generic variable names (`--color-background`,
`--color-foreground`, `--color-accent`, etc.). The HH tokens map to
those as follows (applied in `src/index.css` for HH-branded surfaces
only; builder pages override with their own `builder_brand` values):

| app variable | HH value |
|---|---|
| `--color-background` | `#f8f5ee` (cream) |
| `--color-surface` | `#ffffff` |
| `--color-surface-raised` | `#f2eee3` |
| `--color-foreground` | `#1a1a18` |
| `--color-muted` | `#444444` |
| `--color-border` | `#ddd6c8` |
| `--color-accent` | `#29473b` (green — primary ink on actions) |
| `--color-accent-light` | `#e9e1d4` (gold-tinted button background) |
| `--color-gold` | `#c49e4b` (new — brand accent for pills, focus) |
| `--font-display` | `'Playfair Display', Georgia, serif` |
| `--font-body` | `'Jost', 'Inter', system-ui, sans-serif` |
| `--radius-sm` | `2px` |
| `--radius-md` | `6px` |
| `--radius-lg` | `6px` |

Buttons keep the current sizing but adopt uppercase + gold on the
primary/solid variant; neutral chips and table rows keep the muted
cream aesthetic.
