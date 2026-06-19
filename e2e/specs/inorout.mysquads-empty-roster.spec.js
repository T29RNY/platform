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
// This test pins the bug deterministically with three stubs:
//   1. admin team-state → is_self stripped on every row, forcing the
//      "no self row resolves" condition (myId falls back to squad[0]).
//   2. player_get_teams_by_token → [] — the pre-fix path (wrong/empty token)
//      yields no squads, so pre-fix renders "Not part of any other squads yet"
//      and the assertion FAILS (reproducing the bug).
//   3. player_get_teams → Alex's two squads — the post-fix auth path, which
//      surfaces Competitive FC.
// Stubbing also removes the live-auth.uid() dependency that makes the raw RPCs
// flaky under repeated runs.

const ALEX_SQUADS = [
  { token: 'p_demo_alex_token', team_id: 'team_demo', team_name: '5-a-Side FC',
    player_name: 'Alex Demo', player_nickname: null, is_vice_captain: false,
    is_team_admin: true, disabled: false },
  { token: 'p_dc_alex_token', team_id: 'team_dc_fc', team_name: 'Competitive FC',
    player_name: 'Alex Demo', player_nickname: null, is_vice_captain: false,
    is_team_admin: false, disabled: false },
];

test.describe('inorout — MySquads lists other squads on the admin route (regression)', () => {
  test('signed-in viewer gets their squads from auth identity, not the matchday squad', async ({ page }) => {
    // 1. Force "no self row resolves" — strip is_self from every squad row.
    await page.route('**/rest/v1/rpc/get_team_state_by_admin_token', async (route) => {
      const res = await route.fetch();
      let body;
      try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
      if (Array.isArray(body?.squad)) body.squad = body.squad.map(p => ({ ...p, is_self: false }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    // 2. Pre-fix path (wrong/empty matchday token) returns nothing.
    await page.route('**/rest/v1/rpc/player_get_teams_by_token', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    // 3. Post-fix path (auth identity) returns Alex's squads.
    await page.route('**/rest/v1/rpc/player_get_teams', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALEX_SQUADS) });
    });

    await page.goto('/admin/admin_demo');

    // Dismiss any guided-tour / modal overlay open on first paint.
    await page.keyboard.press('Escape').catch(() => {});

    // Expand the MY SQUADS accordion.
    const toggle = page.getByText('MY SQUADS', { exact: true });
    await expect(toggle).toBeVisible();
    await toggle.click();

    // The OTHER squad (Competitive FC) must appear; the empty-state copy must not.
    await expect(page.getByText('Competitive FC')).toBeVisible();
    await expect(page.getByText('Not part of any other squads yet')).toHaveCount(0);
  });
});
