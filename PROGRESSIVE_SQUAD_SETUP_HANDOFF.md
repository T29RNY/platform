# Progressive Squad Setup — build handoff

> **Trigger (paste to build):**
> `/loop /dev-loop PROGRESSIVE_SQUAD_SETUP_HANDOFF.md`
>
> Plan gate: batched · Merge mode: per-phase

---

## WHAT IT IS

Today, creating a new squad is **one long scrolling form** ([apps/inorout/src/onboarding/steps/CreateTeam.jsx](apps/inorout/src/onboarding/steps/CreateTeam.jsx)) — seven field clusters (squad name, game day, kickoff, players needed, venue + city, price, bibs) all visible at once. For a first-time, non-technical organiser on a phone, that wall of fields reads as *"this is a lot of work"* before a single tap — and that perception, not the actual time, is what drives abandonment of the single most important top-of-funnel step in the product. The form even apologises for itself in its own copy ("This takes a few minutes — and it's the most you'll ever do").

This turns that one form into a **progressive, one-decision-per-screen wizard**: lead with the easy, committing question (your squad's name), then reveal the rest one screen at a time with forward/back navigation, an honest progress bar, and a final review-and-create screen. The psychological win is the point — a shorter *first* action and a sense of momentum, with the heavy fields deferred and skippable.

**Nothing about the data layer changes.** The flow still ends in a single `createTeam` RPC call and the exact same `/admin/<token>` redirect; the wizard only re-slices *how the fields are collected* before that one call. The `createTeam` RPC already accepts everything-but-the-name as defaults/null, so the data layer already supports "create with just a name." Pure frontend, no migration, no RPC change — and it ships **dark/CLEAR** to live App Store users via the Capacitor web bundle with no native rebuild.

---

## LOCKED DECISIONS

These are the assumed product calls. Confirm or adjust at the human review before building.

1. **Step order (commitment-first):** ① Squad name → ② Game day + kickoff → ③ Players needed → ④ Venue + city → ⑤ Price → ⑥ Bibs → ⑦ Review & create. Name first because typing your squad's name is the moment of ownership; defaults make ②③⑥ confirm-and-continue (near-zero effort), so the *felt* work is "name it, optionally say where, set a price."
2. **Only the name is a hard gate.** Continue on step ① is disabled until non-empty (mirrors today's `nameValid`). Every screen after the name is defaulted or skippable — a determined user can tap through to Review and create with just a name. This is the deliberate safety valve for the top-of-funnel metric; a thin-but-created squad beats an abandoned form.
3. **Venue (step ④) gets an explicit "Skip — add later".** Unlike day/players, an empty venue has no meaningful default, so a visible Skip removes the "am I stuck?" doubt. The "you can change this later under Admin → Match Settings" reassurance appears on skippable screens, not just at the end.
4. **Price (step ⑤) keeps its rule but softens it:** an explicit **"No charge"** button (NOT "Free game" — that reads like a giveaway/that someone else pays) sets price to 0 *and* clears the existing zero-ack in one tap, alongside normal numeric entry — converting the most error-prone interaction in the current form into two clean buttons.
5. **Review screen recovers the lost overview.** A read-only summary of all answers, each row tappable to jump back and edit, plus the existing reassurance copy and the **Create my squad** CTA. The server-error block lives here (this is where `createTeam` fires).
6. **Validation is on-next, never on-blur.** Only steps ① and ⑤ validate; both block forward progress with an inline message in the existing `Field` error slot. No scolding mid-thought as the keyboard dismisses.
7. **Wizard navigation is in-memory React state on the bare `/create` route — no per-step URL change, no `history.pushState`.** This protects the sign-in return-to flow (which stashes `/create`) and keeps the final hard `window.location.replace` as the single, clean navigation event into `/admin/<token>`.
8. **An on-screen "Back" control is mandatory on every step ≥ ②.** **In or Out is native-app-only now (no PWA) — see `reference_native_app_only_no_pwa`.** The native iOS WKWebView has no browser chrome and no edge-swipe-back, so an in-app Back button is the *only* way back; field state lives above the steps so back/forward never loses entries.
9. **The submit path is frozen.** `submitTeam` — the `createTeam` call, the 10-second `SetupLoadingScreen` floor, the `ioo_just_created` sessionStorage stash, and `window.location.replace('/admin/<token>?just_created=1')` — stays byte-for-byte unchanged. The wizard only changes *when the final Continue becomes Create*. (The redirect still lands the user + renders the SquadReady overlay correctly, so it's frozen here. Note: its *original* hard-replace justification was the iOS-PWA manifest-at-parse-time install — now legacy, since there's no PWA. Whether it can be simplified to client-side routing is a **separate** future cleanup, explicitly out of scope for this refactor.)

**Open questions for the operator (none block the build — defaults above stand if unanswered):**
- **Bibs as its own screen, or folded into Review?** It's a trivial binary changeable later; folding it into Review saves a screen. *(Default: own step ⑥, as locked above.)*
- **Progress count:** count the Review screen (7 of 7) or treat it as an un-counted summary (6 input steps)? *(Default: 6 input steps + un-counted review.)*
- **Step transitions:** plain instant swaps, or animated slide/fade? *(Default: plain in PR1; animation is PR2 polish.)*
- **Global "Skip the rest, set it up later" shortcut after step ①?** Maximises completion but produces thinner squads. *(Default: NOT included — individual per-step skips already make the fast path fast; measure step drop-off first.)*

---

## KEY AUDIT FACTS

Load-bearing facts established during scope — don't re-derive.

- **All flow state already lives in the [useOnboarding](apps/inorout/src/onboarding/hooks/useOnboarding.js) hook**, lifted above `CreateTeam`. `index.jsx` renders `<Onboarding authUser={…} />`; **App.jsx passes no onboarding state down**, so the App.jsx pure-state-wrapper hard rule is *not in play* — App.jsx is not edited.
- **`CreateTeam` is fed every field by prop** ([index.jsx:16-31](apps/inorout/src/onboarding/index.jsx#L16-L31)). Because field state is already lifted, **stepping back/forward preserves every value for free** — no state lifting needed.
- **The submit/redirect chain is the single load-bearing path.** [useOnboarding.js:31-83](apps/inorout/src/onboarding/hooks/useOnboarding.js#L31-L83): one `createTeam` call → `MIN_DISPLAY = 10000`ms loader → `sessionStorage.setItem('ioo_just_created', …)` → `window.location.replace('/admin/<token>?just_created=1')`. **Freeze this block** — it lands the new admin on their squad and triggers the SquadReady celebration overlay. (Historically the *hard* replace existed so `index.html`'s inline manifest script could inject a per-install PWA manifest at parse time; **In or Out is native-app-only now — no PWA — so that reason is legacy.** That manifest code still physically exists but its install path is dead. Don't refactor the redirect here regardless; it works, and changing it is a separate decision.)
- **`SquadReady` in onboarding is effectively dead in the create flow** — the redirect fires before `setStep(2)`; SquadReady renders as a `?just_created=1` overlay inside `AdminView` post-redirect. Leave both branches alone.
- **Architecture decision:** add a `subStep` index (+ `goNext`/`goBack`/`furthestStep`) to `useOnboarding` driving static per-step view fragments fed the same existing props — **NOT** a data-driven generic step-renderer (the controls are too heterogeneous: text, two-up grid, selects, the bespoke `VenueField` autocomplete, the bibs toggle, the number+ack price field; and `config.js` holds flat copy/defaults, not JSX descriptors). Do **not** overload the existing `step` (1=create / 2=ready) — `subStep` is separate.
- **Reuse in place:** `ProgressBar`, `Field`, `FInput`, `FSelect` already exist in `CreateTeam.jsx`. Wire `ProgressBar` to real `subStep` (it currently hardcodes `current={1} total={3}` — misleading and dies with this change). Only extract `Field`/`FInput`/`FSelect` to a shared file *if* steps are split into separate files; otherwise leave them.
- **Latent bug the refactor exposes — fix it in PR1:** `VenueField` ([CreateTeam.jsx:149-264](apps/inorout/src/onboarding/steps/CreateTeam.jsx#L149-L264)) has a 400ms debounce + a 3s-abort fetch but **no cleanup effect**. In the monolith it lived for the whole form so it never mattered; on its own step it will `setSuggestions` after unmount if the user navigates away mid-fetch (React unmounted-set-state warning + wasted request). Add `useEffect` cleanup clearing `debounceRef` and aborting the in-flight controller.
- **No migration, no RPC, no SQL.** Next free migration is **458** but unused here. `ephemeral-verify`, `rpc-security-sweep`, `schema-sync`, `check-db-schema`/`check-rpc-*` all **N/A**.
- **Hygiene:** onboarding files use CSS vars only (no hex) — keep it that way (only `#60A0FF`/`#FF6060` ever allowed); any new icon (e.g. a Back chevron) must be Phosphor `weight="thin"`; `console.error` only.
- **Ship-safety: CLEAR.** Post-auth squad creation, not login; touches no auth/native plumbing. Reaches live App Store users (native app v1.0(8), WKWebView on `app.in-or-out.com`) via the web bundle — no rebuild, no Apple resubmission, no review-freeze re-arm — *provided* it touches none of `index.html` / `api/manifest.js` / `capacitor.config.ts` / the submit redirect. If any of those gets edited, it flips to PROTECTED.

---

## ROADMAP — PRs in dependency order

### PR #1 — Wizard shell + step navigation (TIER-2, ship-safety CLEAR, effort M)
Re-slice the existing field clusters across the locked step order into per-step view fragments inside `CreateTeam.jsx`, fed the same hook props. Add `subStep`/`goNext`/`goBack`/`furthestStep` to `useOnboarding` (existing `step` untouched). Add a `WizardShell` wrapper: on-screen **Back** (Phosphor `weight="thin"`) + `ProgressBar` driven by real `subStep` + a per-step **Continue** that gates on per-step validation (name non-empty on ①; price entered/no-charge on ⑤) and, on the final step, calls the **frozen** `submitTeam` verbatim. Add the "No charge" button on the price step and the explicit "Skip — add later" on the venue step. Add the Review & create screen. Fix the `VenueField` debounce/abort cleanup leak. Same styling, same inputs, **the whole `submitTeam` chain — `createTeam` call + the `MIN_DISPLAY=10000` `SetupLoadingScreen` floor + the `ioo_just_created` stash + the `/admin/<token>` redirect — byte-for-byte unchanged**, all navigation in-memory on bare `/create` (no URL change per step). Component homes in the new shell: the IN/OR/OUT brand header renders on step ① only; the `FSelect` `▾` glyph stays inside `FSelect`; `Field`/`FInput`/`FSelect` stay in `CreateTeam.jsx` unless steps are split into separate files.
- Gates: build · hygiene (each edited .jsx) · casual-regression (touches `apps/inorout/src/` — expect a clean no-op, run it anyway) · Playwright end-to-end on `127.0.0.1` (load `/create`, step through every screen, assert Back preserves entered values, submit on final step, **assert post-submit URL is `/admin/<token>?just_created=1` and the SquadReady overlay renders**) · 🚦 **real-iPhone native-app walk (Hard Rule 13)** before merge.
- **Done-check:** A first-time user can create a squad through the multi-step flow, Back/forward preserves all values, and submit lands on `/admin/<token>?just_created=1` with the SquadReady celebration — identical to today's end state.

### PR #2 — Per-step polish (TIER-1, ship-safety CLEAR, effort S–M)
Per-step titles/subtitles sourced from `config.js`, refined progress bar (step title beside the dots), brand header on step ① only (or a slimmed persistent header), and optional slide/fade transitions between steps. Auto-focus the input on text steps; set `enterkeyhint`/`inputmode` per step so Return advances; pin the Continue CTA above the keyboard with `env(safe-area-inset-bottom)`. No logic change.
- Gates: build · hygiene · Playwright visual smoke (each step renders, transitions don't trap focus or break Back/Next) · eyeball vs prototype · 🚦 real-iPhone keyboard/transition walk advisory.
- **Done-check:** The wizard reads as a polished, branded, one-thumb flow; transitions and per-step copy in place; no regression to PR #1 behaviour.

---

## GATES the loop must stop at

- 🚦 **PR #1 — real-iPhone native-app walk (Hard Rule 13), human, before merge.** In or Out is native-app-only (no PWA — see `reference_native_app_only_no_pwa`); build/hygiene/desktop-Playwright cannot see a "Continue tap does nothing" bug or a broken flow in the WKWebView. Required walk **inside the native app** (and/or a preview build): sign in → `/create` → step the whole wizard (in-app Back works on every step — there is no edge-swipe-back — and values persist) → Create → ~10s loader → land on `/admin/<token>?just_created=1` with the SquadReady overlay → confirm the keyboard doesn't hide Continue on any step → venue autocomplete dropdown not clipped within its step → safe-area top/bottom insets render correctly around the notch and home indicator.
- 🚦 **Plan gate (batched):** confirm the locked step order + the four open questions before EXECUTE.
- No tier-3 surface is touched. No migration to apply, no RLS/money/auth change, no live-DB write — nothing to auto-apply.

---

## DONE

Creating a new squad is a progressive, one-decision-per-screen flow that leads with the squad name, defers and allows skipping the heavier fields, shows honest per-step progress with working Back navigation, ends in a review-and-create screen, and lands on the **exact same** `/admin/<token>?just_created=1` state with the SquadReady celebration — verified by a real-iPhone native-app walk. No migration, no RPC change, ships dark/CLEAR to live App Store users.

---

## Related
- Builds on the existing onboarding in [apps/inorout/src/onboarding/](apps/inorout/src/onboarding/).
- Hard Rule 13 (real-device test) — now a native-app walk, not a PWA install. See `CLAUDE.md` + MEMORY `reference_native_app_only_no_pwa`.
- Native wrap status (App Store v1.0(8) live, web-bundle delivery) — MEMORY `project_native_app_wrap`.
