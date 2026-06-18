import { test, expect } from '@playwright/test';

// Project venue-alex (storageState = Alex, venue owner). Proves session injection
// authenticates the operator app + the seeded class data renders.
test.describe('venue console (Alex = owner)', () => {
  test('boots signed-in as owner', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
    await expect(page.getByText('owner', { exact: true })).toBeVisible();
  });

  test('Classes shows the seeded sessions', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Classes' }).click();
    await expect(page.getByText('Junior Boxing').first()).toBeVisible();
    await expect(page.getByText('Vinyasa Yoga').first()).toBeVisible();
  });
});
