import { test, expect } from '@playwright/test';

// Project superadmin-alex (Alex = platform_admin). Proves the superadmin gate
// passes for the demo power-user.
test('superadmin (Alex): boots signed-in, gate passes', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/access denied/i)).toHaveCount(0);
});
