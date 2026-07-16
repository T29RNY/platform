import { test, expect } from '@playwright/test';

// Project venue-alex (storageState = Alex, venue OWNER of demo_venue). Covers mig 589's
// desktop half: the cohort modal's school-year / age either-or band picker.
//
// STRICTLY READ-ONLY — it opens the modal, toggles, and closes without ever saving.
// Two reasons, both load-bearing:
//   1. Hard Rule 15 / parity-test-policy — never write to the demo seed.
//   2. The save path CANNOT pass until mig 589 is applied: the wrapper now sends
//      p_school_year_min/max and the live RPC is still 389's 7-arg form, so a save
//      would 404. The write path is proven by 589's ephemeral-verify (19/19) instead;
//      this spec proves the half an EV cannot see — that the form actually renders.

const nav = (page, name) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true }).first();
const chip = (page, name) => page.getByRole('button', { name, exact: true }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operations', level: 1 })).toBeVisible();
  await nav(page, 'Memberships').click();
  // Structure is a tab nested inside the "Club" group — selecting the group first is
  // what surfaces it (MEMBERSHIP_GROUPS, MembershipsView.jsx:139).
  await chip(page, 'Club').click();
  await chip(page, 'Structure').click();
});

test.describe('cohort bands — school year vs age (mig 589)', () => {
  test('the new-cohort modal offers school year OR age, never both', async ({ page }) => {
    await chip(page, '+ Age group').click();
    await expect(page.getByRole('heading', { name: /New age group/ })).toBeVisible();

    // Default is Age, so today's behaviour is unchanged for an operator who ignores this.
    await expect(chip(page, 'School year')).toBeVisible();
    await expect(chip(page, 'Age')).toBeVisible();
    await expect(page.getByPlaceholder('Min')).toBeVisible();

    // Switching to school year swaps the inputs — and the age inputs must GO, because a
    // row carrying both bands is exactly what mig 589 rejects (band_conflict).
    await chip(page, 'School year').click();
    await expect(page.getByPlaceholder('Min')).toHaveCount(0);
    await expect(page.getByPlaceholder('Max')).toHaveCount(0);

    // Reception=0 and the pre-school sentinel must both be offerable — Tots is
    // school_year_max = -1, which no age band can express.
    // Scope to the modal: the Structure tab has its own club-picker <select>, so a bare
    // page.locator('select').first() grabs THAT, not this form's.
    const from = page.locator('.modal-body select').first();
    await expect(from.locator('option', { hasText: 'Reception' })).toHaveCount(1);
    await expect(from.locator('option', { hasText: 'Pre-school' })).toHaveCount(1);
    await expect(from.locator('option', { hasText: 'Year 6' })).toHaveCount(1);

    // ...and back again, without saving.
    await chip(page, 'Age').click();
    await expect(page.getByPlaceholder('Min')).toBeVisible();
    await chip(page, 'Cancel').click();
  });

  test('season rollover still promotes age cohorts, and never a year group', async ({ page }) => {
    // The rollover button is gated on cohorts.length > 0, so it only appears AFTER the
    // cohort read resolves — assert on it directly and let Playwright retry rather than
    // counting it once (an early count() reads 0 and silently skips the whole test).
    const rollover = chip(page, 'Season rollover');
    await expect(rollover).toBeVisible();
    await rollover.click();
    await expect(page.getByRole('heading', { name: 'Season rollover' })).toBeVisible();

    // REGRESSION: every demo cohort is age-banded, so the existing "7–8 → 8–9 yrs"
    // promotion chip must still render — this is the half of SeasonRolloverModal that
    // mig 589 must not disturb.
    await expect(page.locator('.chip', { hasText: /→ .* yrs$/ }).first()).toBeVisible();

    // ...and the automatic-rollover chip must NOT appear, because no demo cohort is
    // year-banded. NOTE: the positive case (a year cohort defaults OFF and shows the
    // auto chip) is NOT covered here — no school-year cohort exists on any seed yet, and
    // Hard Rule 15 forbids creating one against demo data. It lands with P2c/mig 590,
    // which gives DF real year cohorts to walk.
    await expect(page.getByText('moves up on its own each 1 Sep')).toHaveCount(0);
    await chip(page, 'Cancel').click();
  });
});
