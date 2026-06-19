import { test, expect } from '@playwright/test';

// Project hq-alex (Alex = company super_admin on "Demo Sports Group"). Proves the
// HQ intelligence app authenticates + the three surfaces render the seeded company
// (2 venues: Demo Sports Centre [North] + Demo Arena South; 9 teams; classes feed
// into the utilisation "spaces activity" block).

const tab = (page, name) =>
  page.getByRole('button', { name, exact: true }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Demo Sports Group')).toBeVisible();
});

test.describe('HQ — Alex (super_admin)', () => {
  test('Dashboard: company identity + venue health', async ({ page }) => {
    await expect(page.getByText('SUPER_ADMIN')).toBeVisible();
    await expect(page.getByText('Demo Sports Centre').first()).toBeVisible();
    await expect(page.getByText('Demo Arena South').first()).toBeVisible();
    await expect(page.getByText('VENUE HEALTH')).toBeVisible();
  });

  test('Utilisation: spaces-activity block counts the seeded classes', async ({ page }) => {
    await tab(page, 'Utilisation').click();
    await expect(page.getByRole('heading', { name: 'Utilisation' }).or(page.getByText('Utilisation').first())).toBeVisible();
    // classes feed the non-pitch "spaces activity" line
    await expect(page.getByText(/Spaces activity/)).toBeVisible();
    await expect(page.getByText(/classes/).first()).toBeVisible();
    await expect(page.getByText('BY VENUE')).toBeVisible();
  });

  test('Analytics: overview + venue comparison + incidents', async ({ page }) => {
    await tab(page, 'Analytics').click();
    await expect(page.getByText('VENUE COMPARISON')).toBeVisible();
    await expect(page.getByText('AVG/GAME')).toBeVisible();
    await expect(page.getByText('OPEN INCIDENTS')).toBeVisible();
    // both seeded venues in the comparison table
    await expect(page.getByText('Demo Sports Centre').first()).toBeVisible();
    await expect(page.getByText('Demo Arena South').first()).toBeVisible();
  });
});
