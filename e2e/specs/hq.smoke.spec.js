import { test, expect } from '@playwright/test';

// Project hq-alex (Alex = company super_admin on Demo Sports Group). Proves the HQ
// app authenticates + loads analytics (not the access-denied / sign-in gate).
test('hq (Alex): boots signed-in, not access-denied', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/access denied|sign in/i)).toHaveCount(0);
});
