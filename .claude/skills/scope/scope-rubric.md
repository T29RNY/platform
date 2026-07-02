# scope — judge rubric (tunable)

The fresh-context JUDGE scores the synthesised scope against the 11 lenses below,
0–5 each, then runs the deterministic gates. The worker that wrote the scope is
NEVER the grader (L4). Edit thresholds here without touching the skill.

## Per-lens scoring (0–5)

| # | Lens | 5 = excellent | 0 = absent |
|---|------|---------------|------------|
| ① | **Target user(s) / jobs-to-be-done** | Each affected persona named (casual player, team admin, guardian/U18, referee, venue operator, club manager, league admin); the job each one is hiring this for is explicit; "wow" defined per persona | No user named; feature described in the abstract |
| ② | **Technical / architecture** | Reuses existing mechanics over new systems; every Supabase call routed through `packages/core/storage/supabase.js`; data flow + state ownership explicit; App.jsx state wrappers stay pure setters | Invents a parallel system that ripples into working screens |
| ③ | **Security & RLS** | Every write is a SECURITY DEFINER RPC; `auth.uid()` / token trust correct; REVOKE from named roles (not just PUBLIC); `search_path` pinned; fire-and-forget RPCs INSERT audit_events; single overload | Direct client writes assumed; trusts client-passed identity |
| ④ | **UI/UX** | Screens + flows named; optimistic UI + revert-on-error; double-fire guard on saves; empty/error/loading states covered | "Add a button" with no flow |
| ⑤ | **Data model / DB & migrations** | New tables/columns/indexes specified; next free migration number detected from `rls_migrations/` (NOT memory); additive-param discipline; schema-sync flagged for any rename/drop; `_down.sql` named | Columns invented; migration number guessed |
| ⑥ | **Design-system fit** | tokens.css vars only; Bebas Neue headings / DM Sans body; Phosphor weight="thin"; only #60A0FF / #FF6060 hardcoded; matches the source design file | Off-system colours/fonts; templated default look |
| ⑦ | **Platform surface** | Web/PWA today vs native-capable (Capacitor; `apps/inorout/ios-plugins/...`); push / HealthKit / camera / offline needs named; **dark-ship strategy** if it touches a live surface; App-Store review-freeze awareness | Ignores native + freeze; ships a half-feature live |
| ⑧ | **Safety & compliance (In or Out)** | Under-18 handling via `member_profiles.dob`; consent toggle where data is shared; UK-GDPR delete-cascade wired into `delete_my_account*`; special-category (health) data flagged; App-Store privacy answers | No U18 guard; shares data with no consent |
| ⑨ | **Best-practice / latest patterns** | WebSearch used to confirm the current-2026 approach (not stale memory); cites what it checked | Repeats an outdated pattern with no check |
| ⑩ | **Future-proofing / extensibility** | Additive RPC params; downstream consumers recorded in RPCS.md (HR#14); cross-app reuse considered; return-shape changes mapped to consumers (HR#12) | One-off that breaks the next consumer |
| ⑪ | **Effort / risk & phase-split** | Split into independently-shippable PRs in dependency order; each tier-tagged (1/2/3) + ship-safety (CLEAR/PROTECTED); gates named; the smallest dark-safe slice goes first | One giant PR; no tier/gate tags |

## Deterministic gates (run every round — a gate FAIL caps the score regardless of lens marks)

1. **Reality check — everything named must exist.**
   - Files: Read / Grep confirm each named file exists.
   - Tables/columns: `bash skills/scripts/check-db-schema.sh <table>` /
     `bash skills/scripts/check-schema-column.sh <table> <col>`.
   - RPCs: `bash skills/scripts/check-references.sh "<rpc>" --rpc`.
   - Migration number: highest `NNN` in `rls_migrations/*.sql` (Glob) + 1.
     Any plan that names a non-existent table/RPC, or reuses a taken migration
     number, **fails the round** — re-derive against the repo before re-scoring.
2. **Manifest structure** — `bash skills/scripts/check-manifest.sh <emitted file>`
   must PASS (all sections, ≥1 tier-tagged + gated PR, trigger prompt embedded).
3. **Methodology coherence** — every tier-3 touch (migration / RLS / money / auth /
   outward) is tagged 🚦 and routed to a human/Mac/Apple gate, never auto-applied.
4. **SWEEP present** — the emitted handoff carries a `MISSED / OPPORTUNITY /
   FUTURE-PROOF / WOW` section (checked by `check-manifest.sh`) with a real answer to
   each of the four questions, not a placeholder or a restatement of an existing lens
   finding. Missing or thin on ANY of the four **fails the round** — this section is
   mandatory on every scope regardless of size (SKILL.md step 6), no exception for a
   small/single-PR scope.

## Stop conditions (the "as good as it'll get" decision · L9)

Stop iterating and EMIT when **any** holds:
- **Bar cleared:** every lens ≥ 4/5 **AND** overall ≥ **46/55** (≈ 0.84) **AND** all
  deterministic gates PASS, OR
- **Plateau:** overall score delta < **2 points** for **2 consecutive rounds**
  (further refinement isn't materially improving it), OR
- **Hard cap:** **4 rounds**.

Log each round: `round N · overall X/55 · lens lows: [..] · gates: PASS/FAIL`.
On a plateau or cap stop with any lens < 4, the plain-English review MUST name that
weak lens as a known limitation — never present a thin lens as solved.
