import { test, expect } from '@playwright/test';

// Project inorout-sam (storageState = Sam, guardian of junior Charlie). Proves the
// guardian/junior context resolves in the consumer app.
test('inorout (Sam): boots signed-in, no sign-in prompt', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0);
});
