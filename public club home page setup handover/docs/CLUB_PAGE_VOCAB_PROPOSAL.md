# Club Page — Discipline Vocabulary & Default Sections (PROPOSAL for operator approval)

Companion to the public club page designs. Distinguishes **what exists today** from **net-new copy/spec
to lock**. Goal: the public page and the member app share **one source** (`disciplineLabels.js`), extended
with copy-only additions (no migration).

---

## 1. What is REAL today (baseline — do not redesign)

`disciplineLabels.js` (locked, s144) contains only:

| key | values |
|---|---|
| `sessionsTab` | "Sessions" (all) |
| `classesTab` | "Classes" (all) |
| `trainTab` | "Train" (all) |
| `bookCta` | "Book" (all) — a class/PT booking CTA, **not** club-join |
| `rankWord` | `null` (football, boxing, other) · "Level" (gym, yoga, dance, fitness) · "Grade" (martial_arts) |
| `hasGrading` | **martial_arts only** |
| `hasFightRecord` | **boxing only** |
| `hasPT` | gym, boxing, martial_arts, fitness |

Locked rules: **football is the default and must stay byte-identical.** Boxing progression is a **fight
record, not belts.** Belts/grades are **martial-arts only.** `getDisciplineLabels(d) → LABEL_MAPS[d] || DEFAULT`.

The booleans are the reliable **"show this block?"** signals — design blocks off them, not off invented strings.

---

## 2. PROPOSED additions (net-new copy — approve, then add to the same file)

The public page needs a few nouns the member app never did. Proposed as new optional keys on each
`LABEL_MAPS` entry (pure copy, one-line edits, no migration). Unset → falls back to the generic column.

| proposed key | football *(default — unchanged)* | gym | boxing | martial_arts | yoga / dance | fitness | other |
|---|---|---|---|---|---|---|---|
| `liveNowLabel` | Match on now | Session on now | Class on now | Class on now | Class on now | Session on now | On now |
| `eventNoun` | Match | Session | Class | Class | Class | Session | Session |
| `participantNoun` | Players | Members | Fighters | Students | Members | Members | Members |
| `standingsLabel` *(derive from flags)* | League table | Leaderboard | Fight record | Grading & belts | — | Leaderboard | — |
| `joinCtaLabel` | Play for us | Join the gym | Start boxing | Join the dojo | Join us | Join the gym | Join us |

Notes:
- `standingsLabel` can be **derived**, not stored: football → league table (only football has fixtures +
  `venue_get_standings`); `hasFightRecord` → fight record; `hasGrading` → grading & belts; `rankWord==="Level"`
  → reliability leaderboard; else omit. Storing it is optional sugar.
- `joinCtaLabel` is **club-join** (distinct from the existing `bookCta` "Book", which is class/PT booking).
- **Reliability / availability** ("most reliable", attendance %) is identical for every discipline — it's the
  one headline stat that needs no discipline-specific data. It is our differentiator; keep it universal.

---

## 3. PROPOSED default sections per discipline (net-new — does not exist anywhere today)

No `defaultSections` map exists. Proposed: when a club picks a discipline, pre-enable this ordered set
(every block still independently toggle/reorder by the club — modular rule). Driven by `clubs.discipline`
+ the real `has*` flags.

| block | football | gym | boxing | martial_arts | yoga | dance | fitness | other |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Hero | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Identity band | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Fixtures / results | ✓ | – | – | – | – | – | – | – |
| League table | ✓ | – | – | – | – | – | – | – |
| Class timetable | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Grading / belts *(hasGrading)* | – | – | – | ✓ | – | – | – | – |
| Fight record *(hasFightRecord)* | – | – | ✓ | – | – | – | – | – |
| PT / Train *(hasPT)* | – | ✓ | ✓ | ✓ | – | – | ✓ | – |
| Teams / squads | ✓ | – | – | – | – | – | – | – |
| People / reliability board | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| News | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sponsors | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Join / get involved | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| About / contact | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`✓` for Grading/Fight record/PT = the real `has*` flag. Fixtures/table = football-only (real). Everything
else is a design proposal — **please confirm**.

---

## 4. Open decisions for the operator

1. Approve the **proposed keys** in §2 (or amend the copy) so they can be added to `disciplineLabels.js`.
2. Approve the **default-sections map** in §3 — especially: do yoga/dance get a "people/reliability" board,
   or is that overreach where there's no competitive frame?
3. Confirm **unknown/`other`** falls back to the generic column + a safe section set (Hero, Timetable, News,
   Sponsors, Join, About) — no crash, no empty page.
4. Net-new backend still outstanding (unchanged from prior flag): grassroots `club_fixtures` live feed,
   club-team **league table** computation, **surname-hiding / minor** flag for public names, and a
   **supporter/follow** concept. The vocabulary work above is copy-only; these are the real builds.
