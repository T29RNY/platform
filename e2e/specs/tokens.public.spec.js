import { test, expect } from '@playwright/test';

// Project tokens (baseURL = inorout, NO storageState → a genuinely signed-out
// browser). Proves the anonymous token entry points + that auth-gated routes gate.
const PLAYER_TOKEN = 'p_demo_alex_token';      // Alex on 5-a-Side FC
const ALEX_PASS = 'm_755d25efcaa84394a39e8eb0f318320f'; // Alex boxing membership pass

test('player token route (/p/…) renders the squad view without login', async ({ page }) => {
  await page.goto(`/p/${PLAYER_TOKEN}`);
  // anon token → straight into the squad, no OTP / Google gate
  await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0);
  await expect(page.getByText('Live Board')).toBeVisible();
});

test('membership pass route (/m/…) renders the pass without login', async ({ page }) => {
  await page.goto(`/m/${ALEX_PASS}`);
  await expect(page.getByText('Demo Sports Centre').first()).toBeVisible();
  await expect(page.getByText('Full Adult · monthly')).toBeVisible();
  // membership status renders for the anon pass holder (personal class-pass
  // balances are intentionally NOT exposed without a login).
  await expect(page.getByText('Active').first()).toBeVisible();
});

test('NEGATIVE: an auth-gated route (/classes) gates a signed-out visitor', async ({ page }) => {
  await page.goto('/classes');
  // no session → the member classes screen must not render; a sign-in gate appears
  await expect(page.getByText('Demo Boxing Club · Adults')).toHaveCount(0);
  await expect(
    page.getByText(/sign in|continue with google|verify|enter.*code/i).first()
  ).toBeVisible();
});
