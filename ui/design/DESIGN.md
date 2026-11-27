# Factory dashboard: design spec

Status: design pass, ready for implementation to start.

- **Source of truth for the look:** the design canvas [Factory Dashboard](https://claude.ai/artifact/9cbReJAdvLneAy1vFKnejV) (private until shared). It holds the overview, factory board, job detail, a states sheet and a 390 px phone layout, each with a light/dark tweak.
- **Tokens, components and motion:** [`fd.css`](fd.css), a copy of the canvas's stylesheet. Port it as the app's base CSS.
- **`mockup.html`:** the first, plainer pass, kept for its interaction logic (routing, file dialog, sample data). Its look is superseded by the canvas.

Inputs: [`docs/reference-design.md`](../../docs/reference-design.md), [`docs/state-contract.md`](../../docs/state-contract.md) (version 1), and the SolidJS 2.0 docs at https://docs.solidjs.com (pages read are listed in §8.1). The owner chose **SolidJS** (latest stable, 2.0.x) after Effect UI turned out not to be on npm; §8 maps the design onto Solid.

---

## 1. Purpose and principles

One technical owner watches several local factories at once. The page answers three questions, in this order:

1. **Is anything blocked on me?** (needs-human, max rounds reached, unreadable factory)
2. **Is anything stuck?** (gate failing repeatedly, waiting on an author, factory stopped with open jobs)
3. **What is moving, and what did it cost?**

Principles:

- **Attention ranks above everything.** Blocked items come first on every page, as large decision cards that quote the question. A pulsing pill in the top bar counts them from any depth.
- **Readable at a glance.**
  - 14 px body, with big display numerals for the counts that matter.
  - One status color per meaning, used the same way on badges, rails, cards and charts.
  - Status is always glyph + word, never color alone: ▲ blocked, ◆ stuck, ? waiting on author, ● running, ✓ merged/pass, ✕ error/fail, ■ stopped, ○ idle.
- **Alive, not busy.** Motion signals state and draws the eye, and the design leans flashy (owner's request):
  - **Live things move:** ping dots and running stripes.
  - **Blocked things breathe:** glowing borders and a pulsing count.
  - **Data arrives with a stagger.** Nothing moves without a reason.
  - **Reduced motion is respected:** with the system setting to reduce motion on, everything is static.
- **Dark first.** The dark theme is the default, a "control room" style. Light is a full equivalent, not an afterthought.
- **Read-only.** The dashboard never writes a factory file. Actions show the command to run (`/factory feedback <id> "…"`) and link out to the issue or PR.
- **Files are the truth.** Each stage shows the file's `## Summary` bullets and opens the full file in one click.

## 2. Information architecture

```
All factories                      /                       registry.json + every project's jobs
└─ Factory <name>                  /f/<name>               one project's config.json + jobs/*
   └─ Job <job-id>                 /f/<name>/j/<job-id>    one job folder
      └─ File dialog               (modal, no route)       one file in the job folder
```

- **Navigation** is a breadcrumb in the top bar (`All / tidepool / local-dash-cooldown`). There is no sidebar, because the hierarchy is only three levels deep.
- **The top bar's "▲ N blocked on you" pill** counts the global "Your move" items and links to the overview from any page.
- **Routing** uses `@solidjs/router` with browser history; the local server falls back to `index.html` (§8). `hashHistory()` is the documented alternative if the app ever runs from `file://` or a desktop shell.
- **Route parameters:** `<name>` is the registry `name`, which is unique. `<job-id>` is the folder name (`gh-142`, `local-dash-cooldown`).

## 3. Screens

Each screen below names its canvas artboard.

### 3.1 App shell (all screens)

| Region | Content |
|---|---|
| Top bar, sticky, translucent with a backdrop blur | <ul><li>Brand mark (a slowly rotating four-status color wheel) + "Factories"</li><li>Breadcrumb</li><li>**Blocked pill:** coral, "▲ N blocked on you", breathing glow, hidden at 0</li><li>**Live indicator:** a ping dot with "Live · updated 4s ago". The dot turns red on a read error.</li><li>Theme toggle</li></ul> |
| Background | `--bg` with two faint radial glows, cyan top-right and coral top-left. They add depth and carry no data. |
| Main | `max-width: 1400px`, centered, padding 28 px (16 px under 900 px). Sections are 28 px apart. |

### 3.2 All factories: artboard "All factories"

From top to bottom:

1. **Head.** "All factories" (30 px display) and a muted line: "5 registered · 2 running · 7 jobs in flight", plus the registry path in mono.
2. **KPI row**, five tiles. Each has a 3 px top rule in its status color and a 36 px display numeral:
   - **Your move** (coral, glowing): blocked count
   - **Watch** (amber): stuck or waiting
   - **In flight** (cyan): across running factories
   - **Merged · 7 days** (mint): with the rejected count
   - **Spend · 7 days** (neutral): API-equivalent
3. **Your move.** A section title with a filled coral count, then **decision cards** in a 3-column grid, one per blocked item, oldest first. Ranking: unreadable, then max-rounds, then escalated. Each card:
   - **Border:** 1.5 px, a slowly rotating coral glow.
   - **Contents:** badge (`▲ Max rounds 3/3`, `▲ Escalated`, `✕ Unreadable`), factory, job id, title (18 px display), then **the question** in a coral-tinted box (15 px).
   - **Footer:** time waiting and cost, plus a filled primary action ("Decide →", "Review PR #388 →", "Open factory →").
   - **Command:** the exact command, in a mono "command chip" below the footer.
4. **Watch.** An amber-outlined list with one row per item: badge (`◆ Gate 3× fail`, `? Needs info`), factory · id · title, one line of reason, and on the right the time, cost and next step ("Watch round 3/4 →").
5. **Factories table.** Columns:
   - **Factory:** a 4 px status rail, name (17 px display), a kind chip (game, web, ops, tool), and the path and backlog.
   - **Status:** badge plus a sub-line, e.g. "3 of 3 slots · last write 4s ago" or "2 open jobs · quiet for 3d".
   - **Pipeline now:** the pipeline strip (§5): 4 segments (you · queue · build · review). A filled coral segment pulses when something needs you, amber means stuck, and cyan stripes move where jobs are running. A labelled legend sits under it, and an `aria-label` reads out the counts.
   - **Waiting on you:** count badges (▲ 1, ◆ 2).
   - **Merged 7d:** sparkline plus a 22 px numeral.
   - **Spend 7d:** 22 px numeral.
   - **Last activity.**

   Sort order: error, then attention, then stopped, then running, then idle. Rows rise in with a stagger.

### 3.3 One factory: artboard "One factory: tidepool"

1. **Head.** The name, a running badge with a ping dot, and a kind chip. Sub-line: path, backlog, merge mode, slots, last write.
2. **Stopped or idle banner** (only when not running). The violet stopped banner is drawn in the "States" artboard.
3. **KPI row:** Your move · Watch · In flight (n / concurrency) · Merged 7 days (with the median job time) · Spend 7 days (with spend on open jobs).
4. **Pipeline board: 4 phase columns, grouped by who acts next** (the contract's suggested grouping):

   | Column | Stages |
   |---|---|
   | **Needs you** | needs-human (column tinted coral) |
   | **Queue** | intake, needs-info |
   | **Building** | spec, build, gate |
   | **Review** | review, approve, merging |

   - Each column header shows its stages and a big count. An empty column shows "Nothing here".
   - **Job card:**
     - A **stage tag** (a cyan running stage carries a light sweep; needs-human is solid coral; needs-info is amber).
     - The id, a risk meter (1–3 bars + word), the title (16 px display), and surface chips.
     - Reviewer chips with model, each with a verdict dot: mint pass, amber changes, cyan blinking running.
     - A flag line when it needs attention ("▲ Max rounds reached: decide the cooldown", "◆ Gate failed 3× in a row").
     - A thin **progress bar** while in an active stage.
     - A footer with round pips (the last one coral at max), `R2/3`, ⏱ elapsed and cost.
   - Attention cards glow (coral ring, or amber for stuck) and lift on hover.
5. **Done table**, last 7 days: job, title, result badge, rounds, took, cost, when.

The 4-column board replaces the earlier 9-lane board. Lanes were mostly empty, and the stage still shows as the card's tag. A table view of open jobs stays available as a toggle in the app; it isn't drawn on the canvas.

### 3.4 One job: artboard "One job: local-dash-cooldown"

1. **Head.**
   - The id, a solid stage tag, risk, and surface chips.
   - The title (30 px display).
   - A sub-line with round n of max, ⏱ elapsed (+ waiting), cost, and the job folder.
   - Ghost buttons: "Backlog file ↗" / "Issue #n ↗", "PR #n ↗" / the branch.
2. **Decision banner** (when blocked).
   - A coral-tinted panel with a glowing edge and a breathing "!" tile.
   - Title: the reason in plain words ("Max rounds reached. Your call on the cooldown.").
   - The question, with the options in bold.
   - The command chips to run (`/factory feedback … "…"` runs round n+1, `/factory reject … "reason"`).
3. **Pipeline flow.** Eight round nodes joined by edges:
   - Done nodes are mint with ✓; mint edges carry a travelling light.
   - The current node is coral with a pulsing ring, labelled "needs you" when blocked.
   - Future nodes are numbered outlines.
   - The flow scrolls horizontally on narrow screens and keeps the current node in view.
4. **Two columns.** They wrap to one under about 1060 px.
   - **Timeline** (left). **Finished rounds fold to one line each**: `<details>` rows showing a chevron, "Round 1", a gate badge, review counts, a one-line takeaway and the duration. "Setup" folds intake and spec. The newest round is open.
     - Inside a round, each step has a status tile (✓ / ! / ✕), the name, the agent and model, verdict chips, and its duration.
     - Each step has a **file card**: file name in mono, "## Summary", "Open full file", and the bullets.
     - A failed gate shows the **tail of `gate-<round>.log`**, with failing lines in coral, plus "Open full log".
     - A running step shows skeleton lines.
   - **Side column** (right):
     - **Reviews by round:** a matrix with PASS (mint) / CHANGES (amber) / dashed "not run" pills, and a footnote for gate-failed rounds. Each pill opens that `review-<round>-<reviewer>.md`.
     - **Cost by agent:** horizontal bars that grow in, colored by kind (builder and spec-writer cyan, PASS reviewers mint, the CHANGES reviewer amber, intake violet), with the total as a big numeral and the API-equivalent footnote.
     - **Routing:** reviewer chips with models, and "From risk medium + surfaces … via config.json. Builder runs on opus."
5. **File dialog.** A native `<dialog>` opened with `showModal()` that renders the file as sanitized Markdown, or `.log` as text in a `<pre>`. The header holds the file name, folder, "Copy path" and "Close". Esc closes it, and focus returns to the opener.

### 3.5 States: artboard "States"

| State | Treatment |
|---|---|
| **Loading** (first load only) | A cyan "Loading" badge with a ping, shimmering skeleton KPI tiles and rows. Later refreshes never show this. |
| **Empty registry** | A slowly counter-rotating color-wheel tile with a factory icon, "No factories yet", one line pointing to the onboarding skill, and the registry path as a command chip. |
| **Stopped factory** | A violet banner: "infra-scripts stopped 3 days ago", why we think so (no job file changed), and the `/factory run` command. The stuck job cards are dimmed to 85 % but still readable. |
| **Read error** | A coral alert banner with a breathing ✕ tile, the parse error with file, line and column, what happens to the data on screen, a "Retry now" button, and a red live dot. |
| **Not found** | (not drawn) Same layout as Empty, with a link back to All factories. |

### 3.6 Phone: artboard "All factories at 390 px"

- **Top bar:** brand, live dot with age, and a compact blocked pill "▲ 3".
- **KPIs:** a 2×2 grid.
- **Your move:** stacked cards with a shortened question and a 44 px action button.
- **Watch:** rows stack into badge, title, then a one-line reason.
- **Factories:** cards with a status rail, badge, age and a one-line summary ("▲ 1 · ◆ 2 · 9 merged · $63.75").
- **Factory and job pages on a phone:** the board columns stack (empty ones hidden), the job's side column moves under the timeline, and the flow scrolls in its box. There is no horizontal page scroll.

## 4. Design tokens

Every token is defined in [`fd.css`](fd.css) on the `.fd` root:
- **Dark** is the default on `.fd`.
- **Light** is set by `.fd.t-light`.
- **Follow the system:** in the app, the theme toggle picks system / light / dark. System applies `t-light` when `prefers-color-scheme: light`.

### 4.1 Surfaces and text

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#090b10` | `#f3f5f9` | page |
| `--bg2` | `#0d1017` | `#eaeef5` | board columns, code chips, log background |
| `--surface` | `#121620` | `#ffffff` | cards, panels, tiles |
| `--surface2` | `#171c28` | `#f7f9fc` | hover, chips, file cards |
| `--line` / `--line2` | `#232a39` / `#313a4e` | `#dde2ec` / `#c6cddb` | borders / stronger borders, empty pips |
| `--text` | `#eef1f7` | `#121826` | body |
| `--muted` | `#a9b2c4` | `#4c5568` | secondary |
| `--faint` | `#8891a5` | `#5d667a` | labels, metadata |
| `--accent` | `#52c7ff` | `#0a64c2` | links, focus ring |
| `--glow` | ring + soft drop shadow | ring + light shadow | elevation for cards and panels |

### 4.2 Status

Each status has `--<s>` (text, icons, fills), `--<s>-bg` (tint) and `--<s>-line` (border). Text on a solid fill uses `--on-attn` / `--on-ok`.

| Status | Meaning | Dark | Light | Glyph |
|---|---|---|---|---|
| `attn` (coral) | blocked on you, unreadable, gate FAIL, high risk | `#ff6b6b` | `#c4302b` | ▲ ✕ |
| `warn` (amber) | stuck or waiting: gate streak, needs-info, CHANGES, medium risk | `#ffb547` | `#8f4f00` | ◆ ? ! |
| `run` (cyan) | active stage, live | `#52c7ff` | `#0a64c2` | ● |
| `ok` (mint) | merged, PASS, done step | `#3ddc97` | `#157246` | ✓ |
| `stale` (violet) | factory stopped with open jobs | `#b69cff` | `#6a4cc2` | ■ |
| `mute` (grey) | idle, rejected, not run | `#9aa3b5` | `#545d70` | ○ |
| `--on-attn` / `--on-ok` | text on solid coral / mint | `#1d0505` / `#06130d` | `#ffffff` / `#ffffff` | |

Dark tints are each status color at 12 % alpha over the surface. Light tints are solid (`#fdecea`, `#fff3dc`, `#e6f1fd`, `#e3f6ec`, `#f0ebfd`, `#eef0f4`).

### 4.3 Contrast (WCAG 2.1, computed)

Every text pairing is at least 4.5:1. The lowest is coral on its tint in light, at 4.83.

| Pair | Dark | Light |
|---|---|---|
| text / surface | 15.98 | 17.73 |
| muted / surface | 8.48 | 7.48 |
| faint / surface2 (worst neutral) | 5.38 | 5.46 |
| attn / attn tint | 5.59 | 4.83 |
| warn / warn tint | 8.19 | 5.81 |
| run / run tint | 7.55 | 5.08 |
| ok / ok tint | 8.10 | 5.29 |
| stale / stale tint | 6.46 | 5.26 |
| mute / mute tint | 5.90 | 5.79 |
| on-attn / attn (buttons, counts, current node) | 7.03 | 5.52 |
| on-ok / ok (done-node ✓) | 10.74 | 5.95 |
| count text on warn fill | 10.54 (`#1b1203`) | 6.39 (white) |

Why `--on-attn` and `--on-ok` exist:
- **Dark:** white on the dark-theme coral is only 2.9:1, so solid coral elements use near-black text there.
- **Light:** dark text on light-theme mint was 3.19:1, so done nodes use white there.

Decorative, under 3:1, and always paired with text that carries the meaning: the empty round pips, the dashed outline of a "not run" pill, the background glows, and the pipeline strip segments (their counts are in the `aria-label` and the legend).

### 4.4 Type, space, shape

| Token | Value |
|---|---|
| `--display` | Space Grotesk 500–700: headings, KPI numerals, card titles, factory names |
| `--ui` | Inter 400–800: body and controls |
| `--mono` | JetBrains Mono 400/600: ids, paths, models, commands, logs |
| Sizes | body 14 · small 12–13 · label 11.5 uppercase `.08em` · card title 16–18 · h2 19 · h1 30 (24 on phone) · KPI numeral 36 (30 on phone) · table numeral 22 |
| Numbers | `tabular-nums` wherever values line up |
| Spacing | 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 24 / 28 px. Section gap 28, card padding 14–18, grid gaps 12–16. |
| Radii | 6–7 badges and tags · 9–10 buttons and file cards · 12 job cards · 14–16 panels, tiles, columns · 999 pills |
| Fonts | Google Fonts `css2` (Inter, JetBrains Mono, Space Grotesk). Self-host them in the app, because it runs offline on localhost. |

### 4.5 Motion

All motion is CSS keyframes in `fd.css`. Under `prefers-reduced-motion: reduce`, every animation and transition is off.

| Element | Animation | Timing | Meaning |
|---|---|---|---|
| Live dot (`.ping`) | expanding ring fades out | 1.8 s loop | data is live (red: read failing) |
| Blocked pill, siren tile, needs-you strip segment | breathing coral halo | 2–2.4 s loop | blocked on you |
| Decision card border | conic coral gradient rotates (`@property --a`) | 5 s loop | your move |
| Current pipeline node | pulsing ring | 1.8 s loop | where the job is stuck |
| Done pipeline edges | light travels along the edge | 2.2 s loop | progress made |
| Running stage tag | light sweep | 1.8 s loop | agent working |
| Pipeline-strip running segment | diagonal stripes move | 1 s loop | jobs moving |
| Running reviewer dot | blink | 1.1 s loop | reviewer working |
| Brand mark / empty-state wheel | slow rotation | 8 s / 14 s | ambient |
| Cards, rows, KPI tiles | rise 10 px + fade in, staggered `.d1`–`.d5` (50–330 ms) | 0.5 s once | data arrived |
| Sparkline bars, cost bars, progress | grow from 0 | 0.7–1.1 s once | value |
| Job card hover | lift 2 px + shadow | 150 ms | clickable |
| Round chevron | rotates 90° on open | 200 ms | expanded |
| Skeleton | shimmer | 1.4 s loop | first load |

In the app, play the entrance animations **only on first render of an item**, not on every refresh. Otherwise each poll would re-animate the page. A card that changes column gets one rise.

## 5. Component inventory

Every component is a Solid function component styled with the classes in [`fd.css`](fd.css). No component library is used: the interactive pieces map onto native elements that already give keyboard, focus and ARIA behavior.

| Component | `fd.css` class | Native base | Variants / states |
|---|---|---|---|
| `TopBar` | `.topbar` `.brand` `.crumbs` | `<header>`, `<nav>` | blocked pill shown/hidden; live ok/error |
| `BlockedPill` | `.blocked-pill` | `<a>` | breathing |
| `LiveIndicator` | `.live` `.ping` | `<span>` | ok / run / attn |
| `ThemeToggle` | `.theme-btn` | `<button>` | system / light / dark |
| `KpiTile` | `.kpi` + `attn`/`warn`/`run`/`ok` | `<div>` in `role="group"` | top-rule color, glowing when attn |
| `SectionTitle` | `.sec-title` `.count` | `<h2>` | count filled coral / amber |
| `DecisionCard` | `.decision` > `.in`, `.q`, `.go`, `.cmd` | `<article>` + `<a>` | max-rounds / escalated / unreadable |
| `WatchList` / `WatchRow` | `.watch` `.watch-row` | `<a>` rows | gate streak / needs-info |
| `FactoryTable` → `FactoryCard` (phone) | `.ftable` `.fname` `.rail` | `<table>` / `<a>` | rail: attn / stale / line |
| `PipelineStrip` | `.pstrip` `.pseg` + `on-attn`/`on-warn`/`on-run` | `<div aria-label>` | per segment |
| `Sparkline` | `.spark` | `aria-hidden` | zero bars as a 2 px rule |
| `Badge` | `.badge` + `b-attn`/`b-warn`/`b-run`/`b-ok`/`b-stale`/`b-mute` | `<span>` | always glyph + word |
| `Chip` | `.chip` | `<span>` | surfaces, kind |
| `RiskMeter` | `.risk` + `low`/`medium`/`high` | `<span>` | 3 bars + word |
| `ReviewerChip` | `.rev` + `pass`/`changes`/`running` | `<span title>` | dot color, blink when running |
| `PhaseColumn` | `.col` (+ `attn`) `.col-head` | `<section>` | tinted when Needs you has jobs |
| `JobCard` | `.jcard` (+ `attn`/`warn`), `.stage-tag`, `.progress`, `.pips` | `<a>` | glow ring, hover lift |
| `ViewToggle` | (app) | 2 × `<button aria-pressed>` | Board / Table |
| `DecisionBanner` | `.banner.attn` `.siren` | `<section>` | blocked only |
| `StateBanner` | `.banner.stale` / `.banner.attn` | `<section role="status"/"alert">` | stopped / read error |
| `PipelineFlow` | `.flow` `.node` `.edge` | `<nav>` | node done / cur / future; edge done |
| `RoundGroup` | `.round` | `<details>`/`<summary>` | folded / open |
| `TimelineStep` | `.step` `.ic` | `<div>` | ok / warn / attn / run |
| `FileCard` | `.file` | `<div>` + `<button>` | summary / with log tail / running skeleton |
| `GateLogTail` | `.log` | `<pre>` | failing lines in `<b>` |
| `VerdictMatrix` | `.matrix` `.v` | `<table>` + `<button>` cells | pass / changes / skip / running |
| `CostBars` | `.bars` `.bar-row` `.bar` | `<div>` | color by kind |
| `FileDialog` | (app) | `<dialog>` + `showModal()` | markdown / log |
| `Skeleton` | `.skel` | `<span>` | widths |
| `EmptyState` | `.empty-ill` | `<section>` | registry empty / no open jobs / not found |

## 6. Interaction and state notes

**Data freshness**
- Live updates arrive by server-sent events from the reader, plus a safety-net poll every **5 s** while visible and 30 s while hidden (§8).
- The live indicator shows the age of the last successful read.

**Loading.** Skeletons appear on first load only. A refresh never blanks the page or re-plays entrance animations.

**Empty.**
- An empty registry gets the "No factories yet" panel.
- A factory with no open jobs gets "Nothing here" in each column.
- A clear "Your move" collapses to a mint one-liner: "✓ Nothing is blocked on you".

**Errors are scoped to what failed**
- **Registry unreadable**, before any good read: the full read-error state. After a good read, keep the data, turn the live dot red, and show the error banner above the content.
- **One factory unreadable** (path missing, bad `config.json`): it becomes a "Your move" card, because the owner must fix it, plus an `✕ Unreadable` table row. The other factories are unaffected.
- **One job unreadable:** skip it and retry. After 3 consecutive failures, show its card with an `✕ Unreadable` tag.

**Stale (factory stopped).** Show the violet banner, a violet rail and a "■ Stopped" badge. Cards stay readable, dimmed to 85 %.

**Attention ranking.** Unreadable, then max-rounds, then escalated, then gate streak, then needs-info; ties go to the oldest `stage_entered_at`.

**Folded rounds.** Every finished round folds to one line, and the newest round is open. The one-line takeaway is the first Summary bullet of the deciding file (the review that asked for CHANGES, or the failing gate).

**Change notices** (optional):
- When a job enters `needs-human`, or a factory turns stopped or unreadable between reads, the new decision card plays its rise and the blocked pill bumps once.
- Update the document title to "(3) Factories".
- Announce only blocked-count changes through a polite live region. The live indicator stays out of `aria-live`.

**Keyboard**
- Tab order: top bar, then decision cards (their action links), watch rows, then the table or board, in reading order.
- Rows, cards and columns' cards are links, so Enter opens them.
- `<summary>` toggles a round with Enter or Space.
- The dialog closes on Esc.

**Copy actions.** "Copy path" and command chips copy to the clipboard and show "Copied" for 1.5 s.

**Responsive**

| Width | Changes |
|---|---|
| ≥ 1100 px | 3 decision cards in a row, 5 KPI tiles, 4 board columns, job side column on the right |
| 900–1100 px | The job side column wraps below the timeline. |
| < 900 px | 2×2 KPI grid. Decision cards and board columns stack. Watch rows stack. The factories table becomes cards (phone artboard). Buttons are at least 44 px tall. There is no horizontal page scroll; the flow, strip and logs scroll in their own boxes. |

## 7. Accessibility review (WCAG 2.1 AA, on the canvas design)

| # | Finding | Criterion | Status |
|---|---|---|---|
| 1 | All text pairs ≥ 4.5:1 in both themes (§4.3) | 1.4.3 | pass |
| 2 | White on dark-theme coral was 2.9:1; dark text on light mint was 3.19:1 | 1.4.3 | fixed with `--on-attn` / `--on-ok` |
| 3 | Status conveyed by color | 1.4.1 | pass: glyph + word everywhere; the pipeline strip has a legend and an `aria-label` |
| 4 | Lots of motion | 2.3.3 (AAA), 2.2.2 | Every loop is subtle, under 3 flashes per second, and off under reduced motion. Loops are part of status, not content, so 2.2.2's pause control isn't required, but offer a "Calm mode" toggle anyway (open question Q7). |
| 5 | Live indicator would announce every update | 4.1.3 | Kept out of `aria-live`; only blocked-count changes are announced. |
| 6 | Clickable rows and cards | 2.1.1 | Each is a real `<a>`. |
| 7 | Folded rounds | 4.1.2 | Native `<details>`/`<summary>` exposes the expanded state. |
| 8 | Dialog focus | 2.4.3 | Native `showModal`; the app restores focus to the opener. |
| 9 | Focus visible | 2.4.7 | 2 px `--accent` outline, offset 2. |
| 10 | Target size | 2.5.8 | Desktop controls are ≥ 24 px; phone actions are 44 px. |
| 11 | Reflow | 1.4.10 | The phone layout has no horizontal page scroll. |
| 12 | Landmarks and tables | 1.3.1 | `header`, `nav`, `main`, `aside`, labelled sections; tables have captions and `scope`. |

Not tested: a real screen reader pass, and Windows high-contrast mode (the glows disappear there, which is fine).

## 8. Mapping onto SolidJS 2.0

> **Implementation status:** the first implementation lives in `ui/` (see `ui/README.md`). It runs on **Bun** (package manager, reader runtime, `bun test`) and can start at login through a macOS LaunchAgent (`bun run login:install`); the Node/npm and Vitest setup in §8.2 and §8.8 was replaced by that. It follows this section, with three decisions made against the installed Solid 2.0.4 types:
> - **Data in plain signals.** Data lives in plain signals filled by the provider's own fetch loop (SSE plus a backup poll), not in async memos or async stores. A failed read then keeps the last good data by construction, which settles S1.
> - **Keyed lists.** `<For keyed={(x) => x.id}>` keeps rows and cards stable across refetches, so entrance animations play once per item.
> - **Shared derivations.** `src/shared/` is imported by both the app and the reader, which uses Node's type stripping with explicit `.ts` imports.

### 8.1 Sources and versions

- **Versions** were checked on npm on 2026-11-27: `solid-js` 2.0.4 (`latest`; 1.x is `v1-latest` 1.9.20), `@solidjs/web` 2.0.4, `@solidjs/router` 2.0.1, `@solidjs/vite-plugin` 3.0.1, `vite` 8.4.0, and `@solidjs/testing-library` 0.8.10.
- **Docs read** (all at docs.solidjs.com):
  - getting-started/quick-start
  - getting-started/manual-setup
  - concepts/reactivity
  - concepts/stores
  - concepts/async-reactivity
  - concepts/components-and-jsx
  - guides/data-fetching-patterns
  - migration/data-fetching-from-solid-1
  - routing/solid-router/setup, /data, /route-definitions
  - reference/solid-router/router-factory
- **What 2.0 changes**, as those pages describe it, and which this section relies on:
  - `createResource`, `Suspense` and `ErrorBoundary` are gone. Async reads are memos that return promises. First loads are handled by `<Loading>`, failures by `<Errored>`, and refetches by `refresh(source)`.
  - Store setters take a draft callback.
  - Writes are batched, and tests call `flush()`.
  - Reading a signal in a component body is a one-time snapshot.

### 8.2 Toolchain

- **Setup:** manual Vite setup, the docs' "Manual setup" page, rather than the `basic` shape from `npm init solid@latest`. The app has three routes, so hand-written routes are simpler than start mode with file-system routing.
- **Node:** 20.19+ or 22.12+.
- **Language:** TypeScript, with `"jsx": "preserve"` and `"jsxImportSource": "@solidjs/web"`.
- **Entry:** `render(() => <App />, document.getElementById("root")!)` from `@solidjs/web`.

```
ui/
  package.json          solid-js@2.0.4 @solidjs/web@2.0.4 @solidjs/router@2.0.1 marked dompurify
                        dev: vite@8 @solidjs/vite-plugin@3 typescript vitest @solidjs/testing-library
  vite.config.ts        plugins: [solid()]; server.proxy "/api" → reader (dev only)
  index.html            <div id="root">
  src/
    index.tsx           render(); imports fd.css
    App.tsx             Router + ThemeProvider + FactoryDataProvider + TopBar + outlet
    routes.ts           createRouter({ routes })
    styles/fd.css       tokens, components and motion: copy of ui/design/fd.css (§4, §5)
    data/api.ts         fetch wrappers + types for the contract (§9)
    data/derive.ts      pure functions (§8.7), unit-tested
    data/FactoryData.tsx  context: registry + per-factory stores + live updates
    screens/Overview.tsx, Factory.tsx, Job.tsx, NotFound.tsx
    components/…        one file per row of §5
  server/
    reader.ts           local read-only HTTP server (§8.3)
```

`npm run dev` runs Vite and the reader together. `npm start` builds and runs only the reader, which then also serves `dist/`. Run `npm init solid@latest` and choose `bare` if a scaffold is wanted first, then apply the above.

### 8.3 The local reader: where the data comes from

A browser page cannot read `~/.claude/factory/registry.json` or the project folders, so the UI talks to a small **read-only Node server** in `ui/server/reader.ts`. It uses only `node:http`, `node:fs` and `node:path`.

- It binds to `127.0.0.1` only. There is no auth, so it must never listen on another interface.
- It reads only the registry and, for each registered `path`, files under `<path>/factory/`. Every other path gets a 404. Job ids and file names are checked against `^[a-z0-9-]+$` and the file patterns in the contract.

| Endpoint | Returns |
|---|---|
| `GET /api/registry` | contract §1 as-is, plus `exists: boolean` per project |
| `GET /api/factories/:name` | `{ config: ConfigSubset, jobs: JobJson[], readErrors: {id, message}[], lastWriteAt }`. A missing path or a bad `config.json` gives `200` with `status: "missing" \| "unreadable"`, not an HTTP error, so one broken factory can't fail the page. |
| `GET /api/factories/:name/jobs/:id` | `{ job, files: [{ name, summary: string[], verdicts: Record<string,string>, mtime }] }`. The server parses each file's `## Summary` bullets and `Key: VALUE` lines. |
| `GET /api/factories/:name/jobs/:id/files/:file` | `{ name, kind: "md" \| "log", text }` |
| `GET /api/factories/:name/jobs/:id/log/:round?tail=40` | `{ lines }` |
| `GET /api/events` | Server-sent events from `fs.watch` on the registry and each `factory/jobs/` tree. Each event is `{ type: "registry" }` or `{ type: "factory", name, jobId? }`, debounced to 250 ms. |

The contract's atomic writes mean the reader never serves half-written JSON. If a parse still fails, the reader reports it in `readErrors` and the UI retries on the next event or poll.

### 8.4 State

| Kind | Solid primitive | Contents |
|---|---|---|
| Registry | `createStore(async () => api.registry(), seed)` in `FactoryDataProvider` | The project list. The async store reconciles by key, so rows survive refreshes. |
| Per-factory snapshot | One `createStore(async () => api.factory(name), seed)` per registered name, created lazily inside the provider's owner and kept in a `Map` | Config subset, jobs, read errors. The overview and the factory screen share the same store, so a factory is fetched once and both screens stay in step. `jobs` is keyed by `id`, so `<For>` keeps job cards stable across refreshes. |
| Job detail | `createMemo(() => getJob(props.params.name, props.params.id))`, with `getJob = query(api.job, "job")` from `@solidjs/router` | Fetched only while a job page is open. `query` dedupes identical calls. |
| File and log contents | `createMemo(() => openFile() && getFile(name, id, openFile()))` | Loaded when the dialog opens. |
| Clock | `createSignal(Date.now())`, updated each second in `onSettled` | Drives every "4s ago". Provided through `ClockContext`. |
| Theme | `createSignal<"system" \| "light" \| "dark">`, read from and written to `localStorage` in try/catch | A `createEffect` applies it to `document.documentElement.dataset.theme`. |
| Screen UI state | Signals local to the screen | Factory: `layout` (`"board" \| "table"`). Job: `openFile` (`string \| null`), `expandedRounds` (`Set<number>`). |
| Derived | `createMemo` over the stores | Attention lists, sort order, run state, throughput, stage durations, the review matrix (§8.7). Derived values are never stored. |

**Live updates** are owned by `FactoryDataProvider`:

```tsx
onSettled(() => {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "registry") refresh(registry);
    else { const f = factories.get(ev.name); if (f) refresh(f); if (ev.jobId) revalidate(getJob.key); }
  };
  // Fallback and safety net: poll every 5 s while visible, every 30 s while hidden.
  let timer = setInterval(tick, 5_000);
  const onVis = () => { clearInterval(timer); timer = setInterval(tick, document.hidden ? 30_000 : 5_000); };
  document.addEventListener("visibilitychange", onVis);
  return () => { es.close(); clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
});
```

- `refresh(source)` is the documented way to rerun an async memo or store. The guide's polling example is `setInterval(() => refresh(stats), 30_000)` inside `onSettled`.
- A plain `refresh` is quiet: the old data stays up and the new value swaps in. This matches the rule "a refetch never blanks the page".
- `lastReadAt` and `lastError` signals in the provider feed the poll indicator. `isPending(() => …)` can show a spinner if one is ever wanted.

### 8.5 Loading, errors and empty states

- **First load:** each screen wraps its data in `<Loading fallback={<SkeletonTable/>}>`. The docs say the fallback shows on the first load only, and later updates keep the old content up.
- **Errors are scoped.** Each factory row and section, and the job page, sits in its own `<Errored fallback={(err, reset) => <ScopedError error={err()} onRetry={reset} />}>`. A failure in one factory replaces only that row.
- **Expected failures are data, not exceptions.** A missing path, a bad config or an unreadable job arrives as fields in the JSON (`status`, `readErrors`), and the UI renders them as the §6 error states. `<Errored>` is only for the unexpected, such as the reader being unreachable.
- **Keeping the last good data:** see open question S1.
- **Empty:** registry `projects: []` shows the empty state; no open jobs shows "No open jobs".

### 8.6 Routes and components

```ts
export const Router = createRouter({
  routes: [
    { path: "/", component: lazy(() => import("./screens/Overview")) },
    { path: "/f/:name", component: lazy(() => import("./screens/Factory")) },
    { path: "/f/:name/j/:id", component: lazy(() => import("./screens/Job")) },
    { path: "*404", component: lazy(() => import("./screens/NotFound")) },
  ],
});
```

- Screens read `props.params.name` and `props.params.id`.
- Links are plain `<a href>`, built with the router's `paths` helpers where they fit.
- Browser history is the default. The reader serves `index.html` for unknown non-`/api` paths.

```
<Router>                                  routes.ts
└─ App
   ├─ ThemeProvider, ClockContext          theme signal, 1 s clock
   ├─ FactoryDataProvider                  registry store, factory store map, SSE + poll, lastReadAt/lastError
   ├─ TopBar                               BlockedPill (memo over all factory stores), PollStatus, ThemeToggle
   └─ outlet
      ├─ Overview      <Loading>   KpiRow · DecisionCard* (Your move) · WatchList · FactoryTable | FactoryCard* (phone)
      ├─ Factory       <Loading>   StateBanner · KpiRow · ViewToggle · Board→PhaseColumn→JobCard | JobTable · DoneTable
      └─ Job           <Loading>   JobHeader · DecisionBanner · PipelineFlow
                                   Timeline → RoundGroup(<details>) → TimelineStep → FileCard(+GateLogTail)
                                   VerdictMatrix · CostBars · RoutingPanel · FileDialog
```

**Component rules**
- **Props are read inside JSX or memos**, never destructured at the top of a component. A top-level read is a one-time snapshot in Solid 2.0.
- **Lists use `<For each={…}>`**, keyed by identity, which the async stores keep stable.
- **Conditionals use `<Show>` and `<Switch>`/`<Match>`.**
- **Presentational components** (`Badge`, `Chip`, `RiskMeter`, `ReviewerChip`, `RoundPips`, `Sparkline`) take plain props and hold no state.
- **`FileDialog`** holds a ref to the `<dialog>`. A `createEffect` calls `showModal()` when `openFile()` becomes non-null and `close()` when it becomes null. The `close` event sets `openFile(null)` and returns focus to the opener.
- **Markdown is untrusted.** Stage files can quote issue text, which anyone could have written. Render with `marked` and then `DOMPurify.sanitize`, and only then set `innerHTML`. Never inject unsanitized HTML. `.log` files render as text in a `<pre>`.
- **Copy buttons** call `navigator.clipboard.writeText`, then show "Copied" for 1.5 s through a local signal.

### 8.7 Pure derivations (`data/derive.ts`, unit-tested)

| Function | From the contract | Rule |
|---|---|---|
| `attentionKind(job)` | `stage`, `waiting_on`, `note`, `verdicts`, `round`, `max_rounds` | `needs-human` and `round >= max_rounds` and the last verdict was CHANGES or FAIL → `max-rounds`. `needs-human` and `verdicts.approve[round] === "ESCALATE"` → `escalated`. Any other `needs-human` → `escalated`, with `note` as the reason (e.g. a merge problem). `needs-info` → `needs-info`. A gate streak of 2 or more while active → `gate`. |
| `gateFailStreak(job)` | `verdicts.gate` | Number of consecutive `FAIL` at the highest rounds. |
| `attentionQuestion(job, files)` | Summary of `approve-<round>.md` (escalated); `note` + the last CHANGES reviewer's Summary (max-rounds); Summary of `intake.md` (needs-info); Summary of `gate-<round>.md` (gate) | The quoted line in attention rows. The overview needs it for every attention job, so the reader includes `attention: { question }` in `/api/factories/:name` for jobs in an attention state. |
| `runState(factory)` | `job.updated_at`, `stage` | See open question Q1. Interim: **running** if any active-stage job has `updated_at` within 15 min. **Stopped** if active-stage jobs exist but none was updated in 15 min. **Idle** if there are no active-stage jobs. **Error** if unreadable. |
| `throughput7d` | `history[]` entries with `stage: "merged"` | Count per day for 7 days (sparkline), plus a total. |
| `spend7d` | `cost.usd` of jobs whose `updated_at` falls in the window | Approximate: the contract has no per-day cost. |
| `stageDurations(job)` | `history[]` | Gaps between consecutive entries; the current stage runs to now. |
| `reviewMatrix(job)` | `verdicts.review`, `verdicts.gate`, `reviewers` | A reviewer missing in a round where the gate passed and the stage is `review` → running. Gate FAIL in that round → not run. |

### 8.8 Tests

- **Unit tests** for `derive.ts` (Vitest), using fixture `job.json` files. Port the sample data (mockup.html's `factories`/`jobs` arrays; the canvas uses the same jobs) into real `registry.json` / `job.json` fixture folders under `ui/test/fixtures/`.
- **Component tests** with `@solidjs/testing-library`, calling `flush()` after state changes as the 2.0 docs say. Cases:
  - blocked rows render first;
  - a stopped factory shows the banner;
  - a gate-fail step shows the log tail;
  - a verdict cell opens the dialog;
  - a refresh with a moved job moves the card between lanes without remounting the others.
- **Reader tests:** path-traversal attempts (`../`, absolute paths, ids outside `[a-z0-9-]`) return 404, and the server binds to 127.0.0.1 only.

## 9. State-contract alignment

The contract arrived during the design pass, and the mockup was revised to match it:

- Job ids are `gh-<n>` and `local-<stem>`.
- Reviewer names come from config (`code-reviewer`, `gameplay-reviewer`). The UI shows them without `-reviewer` and keeps the full name in tooltips and file names.
- File names are `intake.md`, `spec.md`, `build-<r>.md`, `gate-<r>.md` + `.log`, `review-<r>-<reviewer>.md`, `approve-<r>.md`.
- There is no route file. Routing is read from `job.reviewers`, and the reason from `risk` and `surfaces`.
- A gate FAIL starts a new round (re-entering `build` increments `round`), so the reviewer matrix shows "not run" for gate-failed rounds.
- Cost is `cost.by_agent` (USD per agent name), with no per-agent time. Time comes from `history[]`.
- `needs-human` without an approver file shows `job.json · note`.

Remaining assumptions the contract does not settle:

1. **Run state and heartbeat.** The contract has no "factory is running" signal, so stopped versus idle versus running is inferred from `updated_at` (§8.6). This was requested from the factory session (Q1).
2. **Model per fixed agent** comes from `job.models` (e.g. `builder: opus`), and per reviewer from `reviewers[].model`. The aliases are shown, not `model_id`.
3. **Escalation question text** is in the Summary of `approve-<round>.md`. The contract doesn't define a dedicated question field.
4. **7-day spend** is approximate (whole-job cost attributed to `updated_at`).
5. **`issue.url` for local backlogs** is null, so the link opens the backlog file. Opening a local file from a browser needs the reader process (`vscode://` or a "Copy path" fallback).

## 10. Critique summary

**First pass** (`mockup.html`):
- Blocked items read first, and the question is quoted inline.
- One status system everywhere.

Fixes made during that pass:
- split attention into "Your move" and "Watch";
- collapsed empty lanes;
- fixed narrow-width overflow;
- made the job side panel sticky.

**Redesign** (the canvas). The owner asked for something flashier, animated and easier to read:
- **Decision cards instead of rows.** The question and the exact command are on the card, so most decisions don't need a click.
- **A KPI row with big numerals** gives the five numbers that matter, readable from across a room.
- **A 4-phase board instead of 9 lanes.** Fewer, fuller columns, grouped by who acts next. The precise stage moved to a tag.
- **A pipeline strip per factory** in the overview, so you can see where work sits without opening the factory.
- **Folded rounds** keep a 3-round job readable. This was a first-pass recommendation, now drawn.
- **Cost as bars**, so the expensive agent stands out.
- **Motion is tied to meaning** (§4.5) and switches off under reduced motion.

Open recommendations:
- A "Calm mode" toggle (Q7).
- Cap "Your move" at 6 cards with "Show all n" once more than 10 factories are registered.
- A per-factory filter for the overview when many factories are registered.

## 11. Open questions

### Product and contract (for the owner or the factory session)

- **Q1. Run state.** Can the orchestrator write `factory/run.json` (`{pid, started_at, heartbeat_at, concurrency}`), refreshed every 30 s while `/factory run` is active? Without it, "stopped" is a guess from `updated_at`. (A note asking for this was left for the factory session in the shared notes folder.)
- **Q2. Throughput and spend history.** Should merged and rejected jobs be kept, or summarized, so 7-day and 30-day numbers survive job-folder cleanup? Does the factory ever delete job folders?
- **Q3. Gate streak threshold.** Is "failing repeatedly" two consecutive FAILs (the mockup) or three?
- **Q4. Reader process.** The design uses a localhost-only, read-only Node reader (§8.3). Is that acceptable, or should the dashboard ship as a desktop shell (e.g. Tauri or Electron, with `hashHistory()`) instead?
- **Q5. Opening files.** Should "Backlog file" and "Open full file" also offer "Open in editor" (`vscode://file/…`)?
- **Q6. Scope of actions.** The dashboard is read-only by design. Should it ever run `/factory feedback` or `reject` itself? That needs a write path and confirmation UI, and the contract only allows `factory/bin/job` to write.
- **Q7. Calm mode.** Should there be a toggle that keeps colors but stops the ambient loops (rotating borders, breathing, stripes) for all-day use, separate from the system's reduced-motion setting?

### SolidJS points to verify at implementation

These are things the Solid 2.0 docs pages read did not settle.

- **S1. Rejected `refresh`.** Does a rejected `refresh(store)` keep the previous value, or does it throw into the nearest `<Errored>`? The design wants the last good data kept. If `refresh` throws, catch it in the fetcher: return the previous value and set `lastError`.
- **S2. Per-argument query invalidation.** `revalidate(key)` matches keys by prefix. It's unclear whether a per-argument key (one job) is exposed. The fallback is to revalidate `getJob.key`, which is cheap because only the open job is cached.
- **S3. Testing library.** `@solidjs/testing-library` is at 0.8.10, and its Solid 2.0 support isn't stated on the pages read. Check its peer dependencies before adding it.
- **S4. `produce`.** It doesn't appear in the 2.0 store docs. This design doesn't need it: draft setters and `reconcile` cover every case.
- **S5. Markdown.** Solid has no built-in Markdown rendering. `marked` + `DOMPurify` is a recommendation, not a docs pattern.
