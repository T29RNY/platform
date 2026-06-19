import { test, expect } from '@playwright/test';

// Project tokens (no auth — the /m/<pass_token> route renders from the public
// token). Regression for e2e finding #2: a paused membership pass with no
// frozen_until (an indefinite hold) rendered "Frozen until 1 Jan 1970" because
// fmtDate(null) → new Date(null) → the Unix epoch. Sam's seeded pass is paused
// with frozen_until = null (paid £30/monthly). Post-fix: label drops to "Frozen"
// and no epoch date is shown.

const SAM_PAUSED_PASS = 'm_8289db16b6ef4386abaf39c294a828cd';

test.describe('inorout — paused MemberPass hides the null freeze date (regression)', () => {
  test('paused pass with no frozen_until shows "Frozen", never the 1970 epoch', async ({ page }) => {
    await page.goto(`/m/${SAM_PAUSED_PASS}`);

    // The pass renders with the Frozen status.
    await expect(page.getByText('Frozen').first()).toBeVisible();

    // The bogus epoch date must NOT appear, nor the "Frozen until" label (no date).
    await expect(page.getByText('1970')).toHaveCount(0);
    await expect(page.getByText('Frozen until')).toHaveCount(0);

    // The price line still renders.
    await expect(page.getByText(/£30\/monthly/)).toBeVisible();
  });
});
