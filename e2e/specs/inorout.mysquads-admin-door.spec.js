import { test, expect } from '@playwright/test';

// Project inorout-alex (storageState = Alex). Regression for the "admin loses admin
// by walking through the wrong door" bug:
//
//   Every squad-switcher surface hardcoded /p/<playerToken>. On a /p/ route isAdmin
//   is NEVER derived from team_admins — only a vice-captain's flag unlocks the Admin
//   tab (App.jsx: setIsAdmin(true) fires solely on /demoadmin and /admin/<token>).
//   So a team_admin who is not also a VC tapped their squad in My Squads and landed
//   on a route that silently stripped their admin. The two landing paths already
//   routed admins to /admin/<token>; the switchers never got the rule.
//
// Fix: every squad row resolves through lib/squadDestination.js — /admin/<adminToken>
// when the viewer admins that team, else /p/<playerToken>.
//
// Modelled on Alex's REAL shape, which reproduces the operator's own case exactly:
//   5-a-Side FC (team_demo)  — team_admin, NOT vice-captain  → must open the ADMIN door
//   Competitive FC (team_dc_fc) — plain player                → must stay on the PLAYER door
// Stubbed rather than live so the test pins the routing rule itself and does not
// depend on auth.uid() timing (see the sibling empty-roster spec for the same idiom).

const ALEX_SQUADS = [
  { token: 'p_demo_alex_token', team_id: 'team_demo', team_name: '5-a-Side FC',
    player_name: 'Alex Demo', player_nickname: null, is_vice_captain: false,
    is_team_admin: true, disabled: false, is_competitive: false },
  { token: 'p_dc_alex_token', team_id: 'team_dc_fc', team_name: 'Competitive FC',
    player_name: 'Alex Demo', player_nickname: null, is_vice_captain: false,
    is_team_admin: false, disabled: false, is_competitive: true },
];

// Alex admins 5-a-Side FC only — the get_my_admin_teams row shape (snake_case).
const ALEX_ADMIN_TEAMS = [
  { team_id: 'team_demo', team_name: '5-a-Side FC', admin_token: 'admin_demo' },
];

async function stubSquads(page, adminTeams) {
  await page.route('**/rest/v1/rpc/player_get_teams', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALEX_SQUADS) });
  });
  await page.route('**/rest/v1/rpc/get_my_admin_teams', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(adminTeams) });
  });
}

// Land on Competitive FC's PLAYER route, so 5-a-Side FC renders as a tappable
// "other squad" row rather than the non-interactive CURRENT block.
async function openMySquads(page) {
  await page.goto('/p/p_dc_alex_token');
  await page.keyboard.press('Escape').catch(() => {});
  const toggle = page.getByText('MY SQUADS', { exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();
}

test.describe('inorout — My Squads opens an admin\'s squad at the admin door', () => {
  test('a team_admin (not VC) tapping their squad lands on /admin/<token>, keeping admin', async ({ page }) => {
    await stubSquads(page, ALEX_ADMIN_TEAMS);
    await openMySquads(page);

    const row = page.getByText('5-a-Side FC', { exact: true });
    await expect(row).toBeVisible();
    await row.click();

    // THE FIX: the admin door. Pre-fix this was /p/p_demo_alex_token, where the
    // Admin tab silently vanished because /p/ never derives isAdmin from team_admins.
    await page.waitForURL('**/admin/admin_demo');
    expect(page.url()).toContain('/admin/admin_demo');
    expect(page.url()).not.toContain('/p/p_demo_alex_token');
  });

  test('a plain player tapping the same squad still lands on /p/ — no admin leak', async ({ page }) => {
    // Same squads, but the viewer admins nothing (get_my_admin_teams → []).
    await stubSquads(page, []);
    await openMySquads(page);

    const row = page.getByText('5-a-Side FC', { exact: true });
    await expect(row).toBeVisible();
    await row.click();

    // No admin token → the player door, exactly as before the fix. This is the
    // canary: the fix must never hand the admin door to a non-admin.
    await page.waitForURL('**/p/p_demo_alex_token');
    expect(page.url()).toContain('/p/p_demo_alex_token');
    expect(page.url()).not.toContain('/admin/');
  });
});
