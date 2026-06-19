import { test, expect } from '@playwright/test';

// Project venue-alex (storageState = Alex, venue OWNER of demo_venue "Demo Sports
// Centre"). Asserts the deep feature seed (migs 363–366) renders across every
// operator surface + a happy-path interaction + an owner-only capability is present.
// Seed ground-truth: members Sarah Mitchell, Daniel Okafor, Priya Sharma, Tom
// Whitfield, Linda Crawford, Leo Bennett (13), Grace Adeyemi, Marcus Reid, Alex Demo,
// Sam Carter (paused), Charlie Carter (12). Clubs: Demo Boxing Club, Demo Martial Arts.

const nav = (page, name) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true }).first();
const subtab = (page, name) =>
  page.getByRole('button', { name, exact: true }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operations', level: 1 })).toBeVisible();
});

test.describe('venue console — Alex (owner)', () => {
  test('Operations: owner role + seeded ops tiles render', async ({ page }) => {
    // (a) seeded/identity renders
    await expect(page.getByText('owner', { exact: true })).toBeVisible();
    await expect(page.getByText('tarny+demo@lettrack.co.uk')).toBeVisible();
    // ops tiles
    await expect(page.getByRole('button', { name: /Tonight/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Outstanding £/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Issues/ })).toBeVisible();
    // (b) the operations board shows the seeded league fixtures + results
    await expect(page.getByRole('heading', { name: 'Recent results' })).toBeVisible();
  });

  test('Payments: ledger totals + class/PT charges render', async ({ page }) => {
    await nav(page, 'Payments').click();
    await expect(page.getByText('Outstanding', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Collected', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Collection rate')).toBeVisible();
    // tab filters present
    await expect(subtab(page, 'Unpaid')).toBeVisible();
    await expect(subtab(page, 'Paid')).toBeVisible();
    // (a) seeded class (£8.00 yoga) + PT (£40.00) charges land in the ledger
    await expect(page.getByText('£8.00').first()).toBeVisible();
    await expect(page.getByText('£40.00').first()).toBeVisible();
  });

  test('Classes: seeded schedule (open/free, members-only, paid, sparring)', async ({ page }) => {
    await nav(page, 'Classes').click();
    await expect(page.getByText('Vinyasa Yoga').first()).toBeVisible();
    await expect(page.getByText('Junior Boxing').first()).toBeVisible();
    await expect(page.getByText('Spin Class').first()).toBeVisible();
    await expect(page.getByText('Open Sparring').first()).toBeVisible();
    // pricing / payment modes from the seed
    await expect(page.getByText('£8.00 · Prepay').first()).toBeVisible();
    await expect(page.getByText('Free · Pay at door').first()).toBeVisible();
    // spaces
    await expect(page.getByText('Studio 1').first()).toBeVisible();
    await expect(page.getByText('Mat Room').first()).toBeVisible();
  });

  test('Classes: session detail shows the age roster youngest-first + check-in', async ({ page }) => {
    await nav(page, 'Classes').click();
    await page.getByText('Junior Boxing').first().click();
    // (a) the seeded mixed-age roster renders, youngest first (Leo 13 before Daniel 30)
    await expect(page.getByText('Leo Bennett')).toBeVisible();
    await expect(page.getByText('Age 13')).toBeVisible();
    await expect(page.getByText('Daniel Okafor')).toBeVisible();
    const dialog = page.locator('text=Attendees').locator('xpath=..');
    const leoY = await page.getByText('Leo Bennett').boundingBox();
    const danY = await page.getByText('Daniel Okafor').boundingBox();
    expect(leoY.y).toBeLessThan(danY.y); // youngest-first ordering
    // (b) operator check-in control is available on the session
    await expect(page.getByRole('button', { name: 'Check in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark completed' })).toBeVisible();
  });

  test('Classes: packages tab shows the seeded passes', async ({ page }) => {
    await nav(page, 'Classes').click();
    await subtab(page, 'Packages').click();
    await expect(page.getByText('10-Class Pass')).toBeVisible();
    await expect(page.getByText('5-Class Yoga Pass')).toBeVisible();
  });

  test('Memberships: combat-club members + summary + per-member grading/fight controls', async ({ page }) => {
    await nav(page, 'Memberships').click();
    await expect(page.getByText('Active members')).toBeVisible();
    await expect(page.getByText('Alex Demo').first()).toBeVisible();
    await expect(page.getByText('Charlie Carter').first()).toBeVisible();
    await expect(page.getByText('Daniel Okafor').first()).toBeVisible();
    // pending membership request from QR self-signup
    await expect(page.getByText('Marcus Reid').first()).toBeVisible();
    // per-member operator controls (gym vertical: fight record + grading)
    await expect(page.getByRole('button', { name: 'Fight record' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Award grade' }).first()).toBeVisible();
  });

  test('Memberships → Grading: seeded belt ladders surface (mig 366 link)', async ({ page }) => {
    await nav(page, 'Memberships').click();
    await subtab(page, 'Grading').click();
    await expect(page.getByText('Adult Belt System')).toBeVisible();
    await expect(page.getByText('Junior Belt System')).toBeVisible();
    await expect(page.getByText('White').first()).toBeVisible();
    await expect(page.getByText('Black · 9★')).toBeVisible();
  });

  test('Memberships → Club: both combat clubs surface (mig 366 link)', async ({ page }) => {
    await nav(page, 'Memberships').click();
    await subtab(page, 'Club').click();
    await expect(page.getByText('Demo Boxing Club')).toBeVisible();
    await expect(page.getByText('Demo Martial Arts')).toBeVisible();
    // safeguarding config surface present
    await expect(page.getByText(/SAFEGUARDING FIELDS/i).first()).toBeVisible();
  });

  test('Trainers: seeded PT trainers + members-only gating flag', async ({ page }) => {
    await nav(page, 'Trainers').click();
    await expect(page.getByText('Coach Mike')).toBeVisible();
    await expect(page.getByText('Coach Lara')).toBeVisible();
    await expect(page.getByText('£40.00').first()).toBeVisible();
    await expect(page.getByText('Members only').first()).toBeVisible();
  });

  test('Trainers → Appointments: seeded upcoming appointments', async ({ page }) => {
    await nav(page, 'Trainers').click();
    await subtab(page, 'Appointments').click();
    await expect(page.getByText('Daniel Okafor')).toBeVisible();
    await expect(page.getByText('Alex Demo')).toBeVisible();
    await expect(page.getByText('Coach Mike').first()).toBeVisible();
  });

  test('Room hire: pending enquiry + confirmed hire with held deposit', async ({ page }) => {
    await nav(page, 'Room hire').click();
    await expect(page.getByText('Acme Corp')).toBeVisible();
    await expect(page.getByText('Corporate away day · 30 attending')).toBeVisible();
    await expect(page.getByText(/Birthday party · 25/)).toBeVisible();
    await expect(page.getByText('Held').first()).toBeVisible();
    // (b) operator confirm control on the enquiry
    await expect(page.getByRole('button', { name: 'Confirm' }).first()).toBeVisible();
  });

  test('Spaces: all four seeded spaces incl. enquiry-only', async ({ page }) => {
    await nav(page, 'Spaces').click();
    await expect(page.getByText('Studio 1')).toBeVisible();
    await expect(page.getByText('Main Hall')).toBeVisible();
    await expect(page.getByText('Mat Room')).toBeVisible();
    await expect(page.getByText('Function Room')).toBeVisible();
    await expect(page.getByText('Enquiry only').first()).toBeVisible();
  });

  test('Bookings: pitch schedule + seeded cancellations log', async ({ page }) => {
    await nav(page, 'Bookings').click();
    await expect(page.getByText('Main Pitch').first()).toBeVisible();
    await expect(page.getByText('Side Pitch').first()).toBeVisible();
    // cancellations log w/ seeded refund entries
    await expect(page.getByText('Cancellations')).toBeVisible();
    await expect(page.getByText(/Full refund/).first()).toBeVisible();
  });

  test('Customers: venue customers/teams directory renders', async ({ page }) => {
    await nav(page, 'Customers').click();
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expect(page.getByText('Alpha United').first()).toBeVisible();
  });

  test('Staff: officials + venue staff directory', async ({ page }) => {
    await nav(page, 'Staff').click();
    await expect(page.getByText('Venue staff')).toBeVisible();
    await expect(page.getByText('Jordan Avery')).toBeVisible();
    await expect(page.getByText('Casey Boone')).toBeVisible();
  });

  test('Access: owner sees both admins + the full capability matrix', async ({ page }) => {
    await nav(page, 'Access').click();
    await expect(page.getByText('demo@in-or-out.com')).toBeVisible();
    await expect(page.getByText('family@in-or-out.com')).toBeVisible();
    // owner has the money-reversal capability surface (gated away for staff)
    await expect(page.getByText('Reverse money').first()).toBeVisible();
    await expect(page.getByText(/Booking settings/).first()).toBeVisible();
  });

  test('Equipment: catalogue + asset value', async ({ page }) => {
    await nav(page, 'Equipment').click();
    await expect(page.getByText('Bib set (12)')).toBeVisible();
    await expect(page.getByText('Asset value')).toBeVisible();
    await expect(page.getByText('£825.00')).toBeVisible();
  });

  test('Leagues + Table: competition surfaces load', async ({ page }) => {
    await nav(page, 'Leagues').click();
    await expect(page.locator('main')).toBeVisible();
    await nav(page, 'Table').click();
    await expect(page.locator('main')).toBeVisible();
  });

  test('QR codes: operator QR surface loads', async ({ page }) => {
    await nav(page, 'QR codes').click();
    await expect(page.locator('main')).toBeVisible();
  });
});
