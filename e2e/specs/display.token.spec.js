import { test, expect } from '@playwright/test';

// Project display-token (baseURL = display app, NO auth). The reception display is
// unlocked by a venue display_token (URL) + a numeric PIN. demo_venue:
// token = demo_venue_display_token, PIN = 1234. After unlock it shows the live
// "Matchday Wall" driven by the seeded league fixtures.
const TOKEN = 'demo_venue_display_token';
const PIN = '1234';

test('reception display: token accepted → PIN gate → live matchday wall', async ({ page }) => {
  await page.goto(`/?token=${TOKEN}`);
  // token valid → PIN entry (not an error screen)
  await expect(page.getByText('ENTER PIN')).toBeVisible();
  for (const d of PIN.split('')) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
  // unlocked → the seeded venue's live wall
  await expect(page.getByText('DEMO SPORTS CENTRE')).toBeVisible();
  await expect(page.getByText('MATCHDAY WALL · RECEPTION')).toBeVisible();
});
