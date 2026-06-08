# In or Out — Design Briefs (handoff to Claude Design)

Read this file first. It explains the product, what these briefs are, and exactly what
to deliver back. The four surface briefs alongside it (`venue.md`, `hq.md`, `league.md`,
`display.md`) are each self-contained — you do not need access to any codebase to design
from them.

---

## What In or Out is

In or Out runs amateur/recreational football leagues for sports venues. A **venue** (a
sports centre with one or more pitches) hosts one or more **leagues**; each league runs
**seasons**, and a season contains **competitions** (round-robin tables and/or knockout
cups). Teams register, fixtures are generated and scheduled onto pitches, referees are
assigned, results and live match events (goals, cards, subs) are recorded, and standings
update from those results.

There are four operator/audience-facing surfaces, each its own small web app. You are
designing all four:

| Brief | Surface | Audience | Device |
|---|---|---|---|
| `venue.md` | **Venue dashboard** | The venue operator who runs the day-to-day | Phone **and** desktop |
| `hq.md` | **HQ dashboard** | A multi-venue company's head-office admins | Desktop (mobile-tolerant) |
| `league.md` | **League dashboard** | A league organiser running fixtures/results | Phone **and** desktop |
| `display.md` | **Display / TV board** | The public, on a wall-mounted TV in reception | 1920×1080 TV, read from 3–6 m |

These are separate apps and can look distinct. They serve very different jobs (a one-
handed phone operator vs a glance-from-across-the-room TV vs a data-dense admin desktop),
so don't force a single template across them — design each for its own audience and device.

---

## What each brief contains

Every brief follows the same structure so you can scan it:

- A **surface header**: product context, who uses it, the device/context, how the user
  gets in (auth/launch), and the overall app shell (navigation + global states).
- One **screen block** per screen, each with:
  - **Purpose** — what the screen is for.
  - **Audience / role** — who uses it; any role-gated variations.
  - **Data shown** — every entity and field that appears, named.
  - **States** — loading / empty / error / populated, plus conditional variants.
  - **Interactions** — every control and what it does (modals described inline).
  - **Real-time** — whether it updates live, polls, or only refreshes on demand.
- A **Data contract appendix** — the actual shape of the data behind each screen (field
  names + meaning). Use these field names. Lay out the *real* data, not lorem ipsum.

---

## The handoff contract — what to deliver back

1. **Presentational UI only.** These apps are built with **Vite + React + plain CSS**
   (CSS files, CSS custom properties — no Tailwind, no component library). Deliver React
   components (`.jsx`) plus CSS. Plain semantic HTML/CSS prototypes are also fine if that
   suits your process — they'll be ported.

2. **No data, no backend.** Do not fetch anything, call any API, or implement auth.
   Every component takes its data as **props** whose names match the field names in that
   brief's data contract. Assume the data arrives ready-made.

3. **Design every state, not just the happy path.** Each screen lists its loading /
   empty / error / populated and conditional states. All of them need a design — the
   empty states and error states especially (they're where operators spend stressful
   moments). Don't skip them.

4. **You have a free hand on the look.** These briefs deliberately carry **no** colours,
   fonts, spacing, or brand rules. The visual language is yours to invent. Two practical
   asks only:
   - Respect the **device/context** of each surface (a phone operator, a 1080p TV read
     from across a room, a dense admin desktop).
   - Keep components **prop-driven and presentational** so the look can be re-skinned to
     house tokens on the way in without rewiring logic.

5. **Realistic content.** Use the field names and plausible sample values from the data
   contract so layouts are stress-tested against real data shapes (long team names, zero
   states, six simultaneous live matches, a 12-row table, etc.).

That's it. Design freely; just cover every screen, every field, and every state, and keep
the components fed by props.
