import { test, expect } from '@playwright/test';

// Project inorout-alex (storageState = Alex). Regression for the MySquads bug
// found in the session-153 e2e sweep:
//
//   MySquads derived its squad list from a token taken from the matchday squad
//   (PlayerView: `squad.find(p => p.id === myId)?.token`). On the admin route
//   (/admin/<token>), when no squad row resolves to the signed-in admin
//   (is_self requires an auth.uid() match the token route may not carry), myId
//   falls back to squad[0] and that token belongs to the WRONG player — so
//   MySquads loaded squad[0]'s squads (or none) and rendered "Not part of any
//   other squads yet", hiding every squad the actual viewer belongs to.
//
// Fix (MySquads.jsx): a signed-in viewer's list comes from auth.uid() via
// player_get_teams, NOT the matchday-squad token.
//
// SESSION 154 follow-up (this file): that switch had a knock-on — player_get_teams
// did NOT return is_competitive (only the token RPC did), so the purple LEAGUE
// pill stopped rendering for signed-in users. Migration 367 brings the auth RPC
// to parity. The second test below pins that the LEAGUE pill is column-driven:
// stub the RPC WITHOUT is_competitive (the pre-367 shape) → no pill; WITH it → pill.
//
// The regression test pins the bug deterministically with three stubs:
//   1. admin team-state → is_self stripped on every row, forcing the
//      "no self row resolves" condition (myId falls back to squad[0]).
//   2. player_get_teams_by_token → [] — the pre-fix path (wrong/empty token)
//      yields no squads, so pre-fix renders "Not part of any other squads yet"
//      and the assertion FAILS (reproducing the bug).
//   3. player_get_teams → Alex's two squads — the post-fix auth path, which
//      surfaces Competitive FC.
// Stubbing also removes the live-auth.uid() dependency that makes the raw RPCs
// flaky under repeated runs.

// Two squads. 5-a-Side FC (team_demo) matches currentTeamId on /admin/admin_demo,
// so it renders as the CURRENT block. Competitive FC (team_dc_fc) is the OTHER
// squad — is_competitive:true → LEAGUE pill, is_team_admin:true → ADMIN pill.
const ALEX_SQUADS = [
  { token: 'p_demo_alex_token', team_id: 'team_demo', team_name: '5-a-Side FC',
    player_name: 'Alex Demo', player_nickname: null, is_vice_captain: false,
    is_team_admin: true, disabled: false, is_competitive: false },
  { token: 'p_dc_alex_token', team_id: 'team_dc_fc', team_name: 'Competitive FC',
    player_name: 'Alex Demo', player_nickname: null, is_vice_captain: false,
    is_team_admin: true, disabled: false, is_competitive: true },
];

// Strip is_self from every admin team-state row → forces myId to fall back to
// squad[0], the condition that made the pre-fix token path resolve wrong/empty.
async function stubAdminStateNoSelf(page) {
  await page.route('**/rest/v1/rpc/get_team_state_by_admin_token', async (route) => {
    const res = await route.fetch();
    let body;
    try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    if (Array.isArray(body?.squad)) body.squad = body.squad.map(p => ({ ...p, is_self: false }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  // Pre-fix path (wrong/empty matchday token) returns nothing.
  await page.route('**/rest/v1/rpc/player_get_teams_by_token', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

async function openMySquads(page) {
  await page.goto('/admin/admin_demo');
  // Dismiss any guided-tour / modal overlay open on first paint.
  await page.keyboard.press('Escape').catch(() => {});
  const toggle = page.getByText('MY SQUADS', { exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();
}

test.describe('inorout — MySquads lists other squads on the admin route (regression)', () => {
  test('signed-in viewer gets their squads from auth identity, not the matchday squad', async ({ page }) => {
    await stubAdminStateNoSelf(page);
    // Post-fix path (auth identity) returns Alex's squads WITH is_competitive (mig 367 shape).
    await page.route('**/rest/v1/rpc/player_get_teams', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALEX_SQUADS) });
    });

    await openMySquads(page);

    // The OTHER squad (Competitive FC) must appear; the empty-state copy must not.
    await expect(page.getByText('Competitive FC')).toBeVisible();
    await expect(page.getByText('Not part of any other squads yet')).toHaveCount(0);

    // Every pill MySquads renders must be correct on the auth path:
    //   LEAGUE  ← is_competitive on Competitive FC (the mig-367 parity column)
    //   ADMIN   ← is_team_admin on Competitive FC (the other-squad row)
    //   CURRENT ← team_id === currentTeamId on 5-a-Side FC
    await expect(page.getByText('LEAGUE',  { exact: true })).toBeVisible();
    await expect(page.getByText('ADMIN',   { exact: true })).toBeVisible();
    await expect(page.getByText('CURRENT', { exact: true })).toBeVisible();
  });

  test('LEAGUE pill is column-driven: pre-367 RPC shape (no is_competitive) renders no pill', async ({ page }) => {
    await stubAdminStateNoSelf(page);
    // Pre-367 shape: identical rows but with is_competitive omitted entirely.
    const PRE_367 = ALEX_SQUADS.map(({ is_competitive, ...rest }) => rest);
    await page.route('**/rest/v1/rpc/player_get_teams', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRE_367) });
    });

    await openMySquads(page);

    // Squad still lists (Competitive FC visible, ADMIN pill still there) but with
    // no is_competitive column the LEAGUE pill is absent — exactly the s154 regression.
    await expect(page.getByText('Competitive FC')).toBeVisible();
    await expect(page.getByText('ADMIN', { exact: true })).toBeVisible();
    await expect(page.getByText('LEAGUE', { exact: true })).toHaveCount(0);
  });
});
