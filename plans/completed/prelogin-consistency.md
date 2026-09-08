# Pre-login consistency: unify sub-pages to the new homepage design

**Status:** Complete. Implemented 2026-09-07 — all four phases. Not yet
verified live by the operator beyond this session's own dev-server checks.
**Created:** 2026-09-07  
**Scope:** All pre-login pages — the 10 dusk sub-pages, the educators page, and auth surfaces

## Implementation notes (2026-09-07)

All four phases shipped in one pass:
- **Phase 1:** `Header.tsx` gained a `variant="homepage" | "subpage"` prop
  (subpage uses `MARKETING_NAV_LINKS` with active-page underline); `Footer.tsx`
  and `CTASection.tsx` needed no changes. All 10 sub-pages + `CompareTemplate`
  swapped to the shared Header/Footer/CTASection. `DuskHeader.tsx`,
  `DuskFooter.tsx`, `DuskCTASection.tsx` deleted once unused.
- **Phase 2:** Every sub-page and its section components converted from dusk
  tokens to the monochrome literals (`#000`, `rgba(0,0,0,x)`, `--font-serif`).
  `/try` was left with its internal `TryItFlow`/`MiniHouseResult` untouched
  per the plan's own note — only its wrapper changed.
- **Phase 3:** `/educators` migrated off the old `Header`/`Footer`/`CTASection`
  and `SheetStrip` (removed) onto the shared marketing components; all 6
  `Educator*Section` components recolored to monochrome. `.btn-primary`/
  `.btn-secondary`/`.eyebrow`/`.h2`/`.text-link` global classes were left
  alone (still amber, still used post-login) — pre-login-only usages were
  replaced with local inline monochrome styles instead.
- **Phase 4:** Auth pages (`login`, `forgot-password`, `reset-password`,
  `AuthCard`) went with **Option A** (fully white, bordered card on white).
  Added `authButtonStyle`/`authButtonSecondaryStyle` to `AuthCard.tsx` for the
  same reason — auth-only monochrome buttons, sitewide `.btn-primary` amber
  classes untouched. Dead `.dusk-page`/`.paper-card`/`.dusk-card`/
  `.dusk-rule-line` CSS and the fully-unreferenced `--dusk-*`/
  `--standard-cool*` tokens removed from `dusk-theme.css`/`globals.css`; the
  constellation keyframes stayed (recolored to monochrome) since
  `Constellation.tsx` still uses them. CTA copy normalized to "Sign in" /
  "Try it free" everywhere touched.

**Decisions made without asking, judged low-risk/reversible:**
- The Constellation diagram was recolored to monochrome (black nodes, thin
  gray path, gray→black resolve/retry pulses, subtle black node glow) and its
  numbered badge simplified to match `HowItWorksTeaser`'s plain-number style,
  rather than rebuilt as a new "structural diagram on paper" from scratch —
  the plan flagged the latter as optional, highest-effort work.
- Sub-page headers ended up with a single "Sign in" CTA (no header-level
  "Try it" pill), matching the homepage header exactly. This drops a
  low-friction "try without an account" entry point that every sub-page
  header used to carry — worth a second look if conversion from sub-pages
  matters.
- The "What to add to the homepage" section (FAQ teaser, social proof,
  before/after comparison, footer/nav content gaps) was **not** implemented —
  it's new content, not a consistency fix, and out of scope for this pass.
- Three pre-existing orphaned components (`SocialProof.tsx`,
  `DiagramTeaser.tsx`, `components/marketing/TryFlow.tsx`) were left alone —
  flagged as a separate cleanup task rather than deleted inline.

---

## Analysis: what exists now

The homepage redesign (commit `1b0f09d`) introduced a clean white monochrome
design. The 10 sub-pages still use the dark "dusk constellation" theme. The
educators page uses the original parchment theme. The auth pages are a broken
hybrid (white header on dusk body). That gives us **three competing visual
systems** across a surface that visitors navigate as one site.

### The three systems, side by side

| Attribute | Homepage (new) | Sub-pages (dusk) | Educators (parchment) |
|---|---|---|---|
| Background | `#fff` white | `#060814` navy | `#F7F6F2` parchment |
| Display font | Instrument Serif 400 | Fraunces 500 | Fraunces 500 |
| Body font | System sans | Inter Tight | Inter Tight |
| Accent | Black `#000` | Amber `#F2B021` | Amber `#F2B021` |
| Eyebrow color | `rgba(0,0,0,0.3)` | Amber | Amber text-safe |
| Logo | House SVG + sans text | SVG LogoMark + Fraunces | SVG LogoMark + Fraunces |
| CTA button | Black pill (r999) | Amber r8 | Amber r8 |
| Header nav | 3 anchor links | 5 page links | 4 page links |
| Max-width | 1024px | 1200px | 1200px |
| Footer | 1-line minimal | Multi-column groups | Multi-column groups |
| Components | Header, Footer, CTASection | DuskHeader, DuskFooter, DuskCTASection | Header (old), Footer (old), CTASection (old) |

### Specific inconsistencies

1. **Auth pages are visually broken.** `AuthCard` imports the new white
   `Header` but wraps in `.dusk-page` — white header on dark navy body.
2. **CompareTemplate is also broken.** Imports new white `Header`/`Footer` but
   wraps in `.dusk-page` — same white-on-dark mismatch.
3. **Jarring transition.** Clicking any link from the homepage drops into a
   completely different visual world (white → dark navy).
4. **Three different logos.** Simple house SVG (homepage), LogoMark component
   (dusk pages), LogoMark (educators/old pages).
5. **Different heading fonts.** Instrument Serif on the homepage, Fraunces on
   every other page.
6. **Inconsistent CTA language.** "Sign in" (homepage), "Log in" (dusk header),
   "Try it free" (old header), "Try it instantly" (dusk header).
7. **Nav link mismatch.** Homepage header has 3 anchor links; dusk header has 5
   page links; old header has 4 page links.
8. **Different content widths.** Homepage caps at 1024px; everything else at
   1200px.

---

## Decisions to make

### Design direction

The homepage redesign is the new direction. Sub-pages should converge toward it:
white background, Instrument Serif headings, black/gray monochrome palette,
minimal footer, compact 1024px width. The dusk and parchment themes retire from
pre-login pages.

### What to keep from the homepage

- White background, black text, `rgba(0,0,0,x)` opacity scale for grays
- Instrument Serif for display headings (`--font-serif`)
- House SVG icon + sans-serif wordmark for the logo
- Black pill button for primary CTA, outlined for secondary
- 1024px max-width
- Minimal single-line footer
- Thin `rgba(0,0,0,0.08)` section dividers
- Uppercase eyebrows in `rgba(0,0,0,0.3)`

### What to adapt for sub-pages

The homepage's anchor nav works because the homepage is a single scroll. Sub-
pages need a **page-aware header** — still white and monochrome, but with links
to `/how-it-works`, `/examples`, `/educators`, `/faq` (real routes, not
anchors), and an active-page indicator.

The homepage's CTA band (solid black, centered) works well as the universal
pre-login CTA and can stay.

### Educators page

Currently the one page using the old parchment system with a completely
different Header, Footer, CTA, and SheetStrip. It should migrate to the same
white system as the other sub-pages. The content sections
(`EducatorHeroSection`, etc.) will need their colors updated from parchment/ink
tokens to the new monochrome tokens.

### Auth pages (login, forgot-password, reset-password)

Currently a broken hybrid. The white card-on-dark-background layout is
interesting but doesn't match the new direction. Two options:

- **Option A:** White page, white card — fully monochrome, matching the
  homepage. The card is a bordered container on white, not a floating "paper"
  on dark.
- **Option B:** Keep the centered card layout but on a very subtle off-white
  or light gray background — still in the monochrome family.

Recommend **Option A** for consistency.

### Try It page

Currently wraps TryItFlow in a dusk page with a parchment main area. The flow
component uses light tokens and was intentionally left as a "lit page" on the
dusk background. In the new system it sits directly on white — simpler and more
consistent.

### Legal pages (privacy, terms)

Currently dusk-themed. The LegalArticle component renders markdown in a
light-on-dark or light-on-light style. These should simply wrap in the new
white system — the legal content already assumes a light surface.

---

## The plan: four phases

### Phase 1 — Unified header, footer, and CTA

**Goal:** One shared chrome for all pre-login pages.

1. **Evolve the homepage Header** to support both anchor nav (homepage) and
   page nav (sub-pages). Add a prop like `variant="homepage" | "subpage"` that
   switches which nav links render. The subpage variant shows: How it works,
   Examples, Educators, FAQ, with active-page highlighting (a subtle underline
   or bold weight, monochrome — not amber).
2. **Evolve the homepage Footer** — keep the minimal single-line layout. Ensure
   it links Privacy, Terms, Contact.
3. **Evolve the homepage CTASection** — already generic with props. No change
   needed; it becomes the sole pre-login CTA.
4. **Update every sub-page** to import from `components/marketing/Header`,
   `Footer`, and `CTASection` (the new white versions) instead of the Dusk
   versions.
5. **Delete** `DuskHeader.tsx`, `DuskFooter.tsx`, `DuskCTASection.tsx` once
   nothing imports them.
6. **Delete** the old `components/Header.tsx`, `components/sections/Footer.tsx`,
   `components/sections/CTASection.tsx` if no post-login pages still use them
   (they may — check first; if so, they stay).

**Files touched:**
- `components/marketing/Header.tsx` — add variant prop + page nav
- `components/marketing/Footer.tsx` — minor (already correct)
- All 10 sub-page `page.tsx` files — swap imports
- `components/marketing/CompareTemplate.tsx` — already imports new, fix wrapper
- `components/auth/AuthCard.tsx` — already imports new, fix wrapper
- Delete 3 Dusk component files

### Phase 2 — Page bodies: dusk → white

**Goal:** Every sub-page renders on a white background with monochrome text.

1. **Remove `className="dusk-page"`** from every pre-login page wrapper.
   Replace with `style={{ background: '#fff', color: '#000' }}` (matching
   homepage) or a shared CSS class like `.marketing-page`.
2. **Replace dusk color tokens** in each page's inline styles:
   - `var(--dusk-ink)` → `#000`
   - `var(--dusk-ink-mid)` → `rgba(0,0,0,0.5)`
   - `var(--dusk-ink-subtle)` → `rgba(0,0,0,0.3)` or `rgba(0,0,0,0.35)`
   - `var(--dusk-rule)` → `rgba(0,0,0,0.08)`
   - `var(--dusk-rule-soft)` → `rgba(0,0,0,0.06)`
   - `var(--amber)` eyebrows → `rgba(0,0,0,0.3)` (monochrome)
   - `var(--dusk-card)` → white with subtle border
3. **Replace Fraunces heading styles** with Instrument Serif:
   - `fontFamily: 'var(--font-display)'` → `fontFamily: 'var(--font-serif)'`
   - `fontWeight: 500` → `fontWeight: 400`
4. **Convert `.dusk-card`** instances to monochrome cards: white background,
   `rgba(0,0,0,0.08)` border, no blur/backdrop-filter.
5. **Handle content-heavy components** that are embedded in sub-pages
   (Constellation diagram, ExampleGrid, FaqGroupsSection, etc.) — these need
   their own color migration or a contained approach.

**Pages in scope (in order of complexity):**
- `/privacy`, `/terms` — simplest (just wrapper + LegalArticle)
- `/contact` — wrapper + inline cards
- `/story` — wrapper + section components
- `/faq` — wrapper + section components
- `/compare` — wrapper + table
- `/compare/[slug]` — CompareTemplate
- `/examples` — wrapper + ExampleGrid
- `/examples/[slug]` — wrapper + ReadOnlyHouse
- `/how-it-works` — most complex (Constellation diagram, tables, details)
- `/try` — wrapper + TryItFlow

### Phase 3 — Educators page migration

**Goal:** Bring `/educators` from the parchment system into the white system.

1. **Replace Header, SheetStrip, Footer, CTASection** with the unified
   marketing versions.
2. **Update section components** (`EducatorHeroSection`,
   `EducatorProblemSection`, `EducatorClassroomSection`,
   `EducatorDifferenceSection`, `EducatorCollabSection`,
   `EducatorTrustSection`) — migrate from parchment/ink tokens to monochrome.
3. **Remove the SheetStrip** — the new design has no sheet strip concept.

### Phase 4 — Auth pages + cleanup

**Goal:** Clean auth surface and dead code removal.

1. **Update `AuthCard.tsx`** — remove `.dusk-page` wrapper, render on white.
   The form card becomes a bordered container on white instead of a paper-card
   floating on dark.
2. **Remove `.paper-card`** class usage if nothing else needs it.
3. **Audit and remove dead dusk tokens** from `globals.css` and
   `dusk-theme.css` — only tokens still referenced by post-login pages
   survive. The constellation animation CSS stays only if the `/how-it-works`
   Constellation diagram still uses it.
4. **Clean up font loading** — if Fraunces is no longer used on any pre-login
   page, verify post-login pages still need it before removing.
5. **Normalize button/CTA copy**: settle on "Sign in" (not "Log in") and
   "Try it free" or "Try it →" (not "Try it instantly") across all pages.

---

## What to add to the homepage

The homepage redesign is strong as a single-page scroll. A few additions would
strengthen the pre-login surface as a whole:

### Content gaps on the homepage

1. **FAQ teaser.** The homepage links to How it works, Examples, and Educators
   — but not FAQ. A compact "Common questions" section before the CTA (3–4
   questions as expandable rows, linking to the full FAQ) would reduce bounce
   for visitors who haven't committed yet.

2. **Social proof / trust signal.** The origin section names John Trapasso and
   the Paul–Elder framework, which is good credibility. But there's no signal
   of actual usage — no "used by X classrooms" or even a single teacher quote.
   When real testimonials exist, a short quote card between the Educators
   teaser and Origin section would anchor the credibility.

3. **"What you get" comparison.** The homepage explains *how* it works but
   doesn't contrast it against what people are currently doing (just asking
   ChatGPT). A single before/after — "ChatGPT gives you an answer; this gives
   you the reasoning" — as a compact visual comparison would crystallize the
   value prop faster than the three-pillar "Why" section does alone.

### Navigation gaps

4. **Footer links.** The homepage footer is ultra-minimal (Privacy, Terms,
   Contact). Once the sub-pages unify, the footer should also link to FAQ and
   Story — these are discoverable from the dusk footer today but invisible on
   the homepage.

5. **Header nav for sub-pages.** Once the header gains a sub-page variant, the
   FAQ link should be in the nav. The current dusk header has it; the homepage
   header doesn't.

---

## Risk: the Constellation diagram

The interactive Constellation on `/how-it-works` is the most complex component
in the pre-login surface. It's deeply tied to the dusk visual system — dark
background, amber nodes, cool-teal standard marks, glow animations. Migrating
it to monochrome is a significant design challenge:

- The diagram's visual identity *is* the dusk palette (glowing amber nodes on
  dark navy).
- On a white background, glows don't read; the "constellation" metaphor breaks.
- The animation CSS (`dusk-theme.css`) targets dusk-specific class names.

**Recommendation:** Redesign the diagram for the white system rather than
mechanically swapping colors. On white, it could become a clean line diagram
with black nodes, thin connecting lines, and black/gray check marks — still
interactive, but the "constellation in a night sky" metaphor gives way to a
"structural diagram on paper" metaphor that matches the homepage's tone. This
is the single highest-effort item in Phase 2 and could be split into its own
sub-phase.

---

## Out of scope

- Post-login pages (dashboard, build, classroom, profile) — these keep their
  existing parchment/ink system.
- The educators page's *content* — only its chrome and color tokens change, not
  what it says.
- SEO metadata — stays as-is; only visual presentation changes.
- The dusk palette tokens in `globals.css` — they stay until Phase 4 confirms
  nothing references them.
