import { test, expect } from '@playwright/test';

// Project inorout-alex (storageState = Alex). Proves session injection signs the
// user into the CONSUMER app without the OTP screen. Alex is a member of both
// combat clubs + a squad admin + player.
test('inorout (Alex): boots signed-in, no sign-in prompt', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // We injected a session → the app must NOT show the Google/OTP sign-in entry.
  await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0);
});

test('inorout (Alex): member profile route resolves', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('networkidle');
  // Not bounced to a sign-in/welcome route.
  await expect(page).not.toHaveURL(/sign\s*in|welcome/i);
});
