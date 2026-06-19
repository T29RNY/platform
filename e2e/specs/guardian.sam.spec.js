import { test, expect } from '@playwright/test';

// Project inorout-sam (storageState = Sam). Sam: plain player of "5-a-Side FC",
// GUARDIAN of junior Charlie Carter (DOB 20 May 2014), club member of Demo Boxing
// Club but PAUSED, no other active club. Covers the guardian/family + paused-member
// + safeguarding surfaces. Charlie pass token + Sam paused-pass token are stable seed
// values. No mutations are fired against the live demo DB.

const CHARLIE_PASS = 'm_a77b55effc084e05a9d846e9bc5080d3';
const SAM_PAUSED_PASS = 'm_8289db16b6ef4386abaf39c294a828cd';

test.describe('inorout — Sam: guardian / family', () => {
  test('boots signed-in (no OTP) to the squad player home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0);
    await expect(page.getByText('Live Board')).toBeVisible();
  });

  test('guardian home (/parent-home) lists the child Charlie', async ({ page }) => {
    await page.goto('/parent-home');
    await expect(page.getByText("Set your children's availability")).toBeVisible();
    await expect(page.getByText('Charlie Carter')).toBeVisible();
  });

  test('profile shows the guardian → child link + consent surfaces', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByText('MY CHILDREN')).toBeVisible();
    await expect(page.getByText('Charlie Carter')).toBeVisible();
    await expect(page.getByText('DOB: 20 May 2014')).toBeVisible();
    // safeguarding/consent on the guardian's own profile
    await expect(page.getByText('ADDITIONAL NEEDS & CONSENTS')).toBeVisible();
    await expect(page.getByText('PHOTO & IMAGE CONSENT')).toBeVisible();
  });

  test('child safeguarding edit surfaces medical / allergies / collectors', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByText('Charlie Carter')).toBeVisible();
    // open the child's edit form (second Edit on the page = the child's)
    await page.getByText('Edit', { exact: true }).last().click();
    await expect(page.getByText('MEDICAL INFORMATION').last()).toBeVisible();
    await expect(page.getByText('Allergies')).toBeVisible();
    await expect(page.getByText('Medical conditions')).toBeVisible();
    await expect(page.getByText('Authorised collectors')).toBeVisible();
  });

  test("child's membership pass renders (Junior · Active)", async ({ page }) => {
    await page.goto(`/m/${CHARLIE_PASS}`);
    await expect(page.getByText('Charlie Carter')).toBeVisible();
    await expect(page.getByText('Junior · monthly')).toBeVisible();
    await expect(page.getByText('Active').first()).toBeVisible();
  });

  test("PAUSED membership shows the Frozen state on Sam's pass", async ({ page }) => {
    await page.goto(`/m/${SAM_PAUSED_PASS}`);
    await expect(page.getByText('Sam Carter')).toBeVisible();
    await expect(page.getByText('Full Adult · monthly')).toBeVisible();
    // paused membership → surfaced as "Frozen" (negative/edge state)
    await expect(page.getByText('Frozen').first()).toBeVisible();
  });
});
