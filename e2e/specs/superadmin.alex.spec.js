import { test, expect } from '@playwright/test';

// Project superadmin-alex (Alex = platform_admin). Proves the platform-admin gate
// passes for the demo power-user and every analytics tab renders. The Create-squad
// form is asserted to render only — NOT submitted (would create a real team).

const tab = (page, name) =>
  page.getByRole('button', { name, exact: true }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('access denied', { exact: false })).toHaveCount(0);
});

test.describe('superadmin — Alex (platform_admin)', () => {
  test('gate passes: live activity feed renders', async ({ page }) => {
    await tab(page, 'Activity').click();
    await expect(page.getByText('LIVE ACTIVITY')).toBeVisible();
  });

  test('Engagement: platform engagement metrics', async ({ page }) => {
    await tab(page, 'Engagement').click();
    await expect(page.getByText('APP OPENS').first()).toBeVisible();
    await expect(page.getByText('TOTAL ACTIONS').first()).toBeVisible();
    await expect(page.getByText('By feature')).toBeVisible();
  });

  test('Health: activation funnel + notification reach', async ({ page }) => {
    await tab(page, 'Health').click();
    await expect(page.getByText('Activation funnel')).toBeVisible();
    await expect(page.getByText('Notification reach')).toBeVisible();
  });

  test('Teams: platform squad directory with seeded teams', async ({ page }) => {
    await tab(page, 'Teams').click();
    await expect(page.getByText('Competitive FC').first()).toBeVisible();
    await expect(page.getByText('Demo Athletic').first()).toBeVisible();
    await expect(page.getByText('JOIN CODE')).toBeVisible();
  });

  test('Create squad: form renders (not submitted)', async ({ page }) => {
    await tab(page, 'Create squad').click();
    await expect(page.getByText('SQUAD NAME')).toBeVisible();
    await expect(page.getByText('ORGANISER EMAIL')).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: 'Create squad' })).toBeVisible();
  });
});
