import { test, expect } from '@playwright/test';

// Project venue-sam (storageState = Sam, venue STAFF on demo_venue with
// caps_grant = {booking_settings} only — no owner/manager powers). Proves the
// capability gating: booking-related surfaces ARE available, but the Access /
// manage-logins surface is gated away. (Money + membership mutations remain
// visible in the UI but are enforced server-side by the cap-aware admin_* RPCs —
// see venue staff logins epic. We assert the client-visible gate here and do NOT
// fire denied mutations against the live demo DB.)

const navNames = (page) =>
  page.getByRole('navigation').getByRole('button').allInnerTexts();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operations', level: 1 })).toBeVisible();
});

test.describe('venue console — Sam (staff, booking caps only)', () => {
  test('identity: signed in as staff, not owner', async ({ page }) => {
    await expect(page.getByText('staff', { exact: true })).toBeVisible();
    await expect(page.getByText('tarny+family@lettrack.co.uk')).toBeVisible();
    // the owner-only role chip must not be shown for Sam
    await expect(page.getByText('owner', { exact: true })).toHaveCount(0);
  });

  test('GATE: the Access / manage-logins surface is hidden for staff', async ({ page }) => {
    const names = (await navNames(page)).map((t) => t.trim());
    expect(names).not.toContain('Access');
    // owner had Access in the same nav; staff must not.
    await expect(
      page.getByRole('navigation').getByRole('button', { name: 'Access', exact: true })
    ).toHaveCount(0);
  });

  test('booking surfaces ARE available to staff', async ({ page }) => {
    await page.getByRole('navigation').getByRole('button', { name: 'Bookings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add booking' })).toBeVisible();
    await expect(page.getByText('Schedule').first()).toBeVisible();
  });

  test('GATE: class management is server-denied for staff (insufficient_role)', async ({ page }) => {
    await page.getByRole('navigation').getByRole('button', { name: 'Classes', exact: true }).click();
    // The cap-aware RPC refuses the staff role → the view surfaces the denial.
    await expect(page.getByText(/insufficient_role|Couldn.t load classes/i).first()).toBeVisible();
  });

  test('staff can still read the membership directory', async ({ page }) => {
    await page.getByRole('navigation').getByRole('button', { name: 'Memberships', exact: true }).click();
    await expect(page.getByText('Active members')).toBeVisible();
    await expect(page.getByText('Alex Demo').first()).toBeVisible();
  });
});
