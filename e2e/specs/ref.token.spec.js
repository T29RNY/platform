import { test, expect } from '@playwright/test';

// Project ref-token (baseURL = ref app, NO auth). The referee interface opens from
// a per-fixture ref_token. This is the seeded "Competitive FC v Demo Athletic"
// allocated fixture (status=allocated → Pre-match screen). The token is a stable
// seed value in the demo DB.
const REF_TOKEN = 'c3a26d39-cd04-4ac9-a003-cf8dc7d52f3d';

test('referee: token opens the pre-match screen with both seeded squads', async ({ page }) => {
  await page.goto(`/?token=${REF_TOKEN}`);
  await expect(page.getByText('Pre-match')).toBeVisible();
  await expect(page.getByText('Kick-off', { exact: true })).toBeVisible();
  // both squads load from the seed
  await expect(page.getByText('Competitive FC')).toBeVisible();
  await expect(page.getByText('Demo Athletic')).toBeVisible();
});
