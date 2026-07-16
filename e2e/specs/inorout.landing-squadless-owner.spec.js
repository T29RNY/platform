import { test, expect } from '@playwright/test';
import { STORAGE_KEY } from '../lib/auth.mjs';

// Project inorout-alex. Landing-router regression: a signed-in owner with a /hub
// hat but ZERO casual destinations must land on /hub, not the "paste your player
// link" welcome screen.
//
// WHY THIS SPEC FAKES TWO RPCs. superadmin_create_club (mig 578) writes a venue +
// venue_admins + club and NO member_profile/squad/team_admins, so a brand-new club
// owner is squad-less AND guardian-less — a shape NEITHER demo user has: Alex has
// squads (homeScreenType 'multi') and Sam is a guardian ('parent'), and both reach
// /hub down other arms, MASKING this bug entirely. Rather than seed a live-DB user
// (Hard Rule 15 — never mutate the demo seed), we stub ONLY the two RPCs whose
// EMPTINESS is that owner's defining condition and let the REAL get_my_world resolve
// Alex's REAL hats. That drives the real router over the real hat resolution.
//
// ⚠️ 127.0.0.1, NOT localhost: App.jsx:137 short-circuits hostname==="localhost" to
// the {type:"admin", token:"local"} dev backdoor, so the landing router — the thing
// under test — never runs there. The config's storageState targets the localhost
// origin, so the session is injected by hand below for the 127.0.0.1 origin.
//
// This needs the dev server to answer on IPv4, and a bare `npm run dev` binds [::1]
// ONLY — so 127.0.0.1 is refused and this spec SKIPS itself (see the guard below)
// rather than failing red for an environment reason. To actually run it:
//   npm run dev --prefix apps/inorout -- --host 127.0.0.1
// One 127.0.0.1-bound server serves BOTH origins (localhost falls back to IPv4), so
// that same server still satisfies every localhost-based inorout spec — no second
// port, no second server. (Binding IPv4 by default would also un-skip
// inorout-alex/inorout-sam/tokens in qa-suite.sh, which probes 127.0.0.1:5173 and
// therefore currently skips all three — tracked in BUGS.md, deliberately not fixed
// here: it surfaces 7 pre-existing reds that are nothing to do with this fix.)
const ORIGIN = 'http://127.0.0.1:5173';

const EMPTY_RELATIONSHIPS = { squads: [], club_memberships: [], guardian_of: [] };

// Reuse the session the config's storageState already minted for this project.
async function signInAtLoopback(page, context) {
  const state = await context.storageState();
  const origin = state.origins.find((o) => o.origin.includes('5173'));
  const token = origin?.localStorage.find((e) => e.name === STORAGE_KEY)?.value;
  expect(token, 'minted Alex session must be present in storageState').toBeTruthy();
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [STORAGE_KEY, token],
  );
}

// The landing router redirects during load, which aborts the initial navigation —
// an expected hand-off, not a failure. The URL/DOM assertions are the real signal.
async function gotoLanding(page) {
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
}

// Make the signed-in user squad-less + guardian-less + casual-admin-less.
async function stubSquadless(page) {
  await page.route('**/rest/v1/rpc/get_user_relationships', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_RELATIONSHIPS) }),
  );
  await page.route('**/rest/v1/rpc/get_my_admin_teams', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
}

test.describe('inorout — squad-less hub-eligible owner lands on /hub (regression)', () => {
  // Skip (never fail) when the dev server isn't answering on IPv4. A bare
  // `npm run dev` binds [::1] only, so an otherwise-correct checkout would show 3
  // reds for a pure environment reason — and a test that cries wolf gets ignored,
  // taking the real regression signal with it. Skipping states the reason instead.
  test.beforeAll(async () => {
    try {
      const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      test.skip(true, `inorout dev server not reachable on ${ORIGIN} — this spec needs an IPv4 listener. Start it with: npm run dev --prefix apps/inorout -- --host 127.0.0.1`);
    }
  });

  test('0 squads + 0 admin teams + a real /hub hat → /hub, not the welcome screen', async ({ page, context }) => {
    await signInAtLoopback(page, context);
    await stubSquadless(page);

    await gotoLanding(page);

    // The fix: routed to the /hub role home rather than stranded on the welcome
    // screen with the switcher silently holding the hat. Poll the URL rather than
    // waitForURL(): the shell immediately redirects again onto the resolved hat
    // (/hub → /hub/tonight?ctx=…&hat=operator), and that second navigation aborts a
    // pending waitForURL. toHaveURL auto-retries, so it is immune to the hand-off.
    await expect(page).toHaveURL(/\/hub/, { timeout: 20_000 });
    await expect(page.getByText("You're not in a team yet.", { exact: false })).toHaveCount(0);
  });

  // The DF-owner shape specifically. Alex's real world (above) resolves an OPERATOR
  // hat off a real facility; Danny's resolves a CLUB_ADMIN hat instead, because
  // superadmin_create_club mints a venueless club shell (origin 'self_serve' + a
  // club_id) whose operator hat nav.js:52 deliberately suppresses — his ONLY hat
  // comes from world.admin_clubs. Different code path into the same hubEligible, so
  // it gets its own case. The payload is copied verbatim from a live get_my_world()
  // for venue v_ffff5528a0 (the real DF club), not invented.
  test('club-admin-only hat (the venueless self_serve club shell) → /hub', async ({ page, context }) => {
    await signInAtLoopback(page, context);
    await stubSquadless(page);
    await page.route('**/rest/v1/rpc/get_my_world', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          admin_roles: [{ name: 'DF Sports Coaching', role: 'owner', type: 'venue_admin',
            origin: 'self_serve', club_id: 'club_df_sports_coaching', entity_id: 'v_ffff5528a0' }],
          admin_clubs: [{ name: 'DF Sports Coaching', role: 'owner',
            club_id: 'club_df_sports_coaching', venue_id: 'v_ffff5528a0' }],
          coaching: [], guardian_of: [], ref_assignments: [], club_memberships: [],
        }),
      }));

    await gotoLanding(page);

    await expect(page).toHaveURL(/\/hub/, { timeout: 20_000 });
    await expect(page.getByText("You're not in a team yet.", { exact: false })).toHaveCount(0);
  });

  test('0 destinations and NO hub hat → welcome screen (casual path unchanged)', async ({ page, context }) => {
    await signInAtLoopback(page, context);
    await stubSquadless(page);
    // No hats resolve → hubEligible false. This is BOTH the genuinely team-less
    // casual user AND the get_my_world-error fail-safe: must fall through to the
    // welcome screen (reachable sign-out / delete — App Store 2.1(a) + 5.1.1(v)),
    // never /hub's spinner, which waits on myWorld and would hang.
    await page.route('**/rest/v1/rpc/get_my_world', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }),
    );

    await gotoLanding(page);

    await expect(page.getByText("You're not in a team yet.", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/hub/);
  });
});
