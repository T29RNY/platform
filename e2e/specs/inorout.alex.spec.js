import { test, expect } from '@playwright/test';

// Project inorout-alex (storageState = Alex). Consumer app, signed-in via injected
// session (no OTP). Alex: admin of squad "5-a-Side FC" (team_demo, multi_context on)
// + player of "Competitive FC", member of BOTH combat clubs (Demo Boxing Club →
// fight record; Demo Martial Arts → grading), class pass (5 left), 1 PT appointment.
// Club surfaces are path-routed with a ?club=<id> deep-link (the in-app switcher
// appends the same param), so we land deterministically on each club context.

const BOX = 'club_demo_box';
const MA = 'club_demo_ma';

test.describe('inorout — Alex: squad home + admin', () => {
  test('boots signed-in to the squad player view (no OTP/sign-in)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0);
    // squad player home: the IN-OR-OUT lockup + the bottom nav
    await expect(page.getByText('Live Board')).toBeVisible();
    await expect(page.getByRole('navigation').getByText('Admin', { exact: true })).toBeVisible();
  });

  test('squad admin panel is reachable (Alex is admin of 5-a-Side FC)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByText('Admin', { exact: true }).click();
    await expect(page.getByText('ADMIN PANEL')).toBeVisible();
    await expect(page.getByText('Make Teams')).toBeVisible();
    await expect(page.getByText('Input Result')).toBeVisible();
    // manage tiles: payments / squad / reminders / bibs
    await expect(page.getByText('Reminders')).toBeVisible();
  });

  test('Stats + Results squad surfaces render', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByText('Stats', { exact: true }).click();
    await expect(page.getByText('IO STATBOOK')).toBeVisible();
    await page.getByRole('navigation').getByText('Results', { exact: true }).click();
    await expect(page.getByText('Every game. Every moment.')).toBeVisible();
  });
});

test.describe('inorout — Alex: club member surfaces (multi-context)', () => {
  test('multi-context: both combat clubs are offered on the classes screen', async ({ page }) => {
    await page.goto('/classes');
    await expect(page.getByText('Demo Boxing Club · Adults')).toBeVisible();
    await expect(page.getByText('Demo Martial Arts · Adults')).toBeVisible();
  });

  test('classes timetable renders the seeded sessions + pass-credit balance', async ({ page }) => {
    await page.goto(`/classes?club=${BOX}`);
    await expect(page.getByText('5 class credits on your pass')).toBeVisible();
    await expect(page.getByText('Vinyasa Yoga').first()).toBeVisible();
    await expect(page.getByText('Junior Boxing').first()).toBeVisible();
    await expect(page.getByText('Open Sparring').first()).toBeVisible();
    // Alex's seeded bookings show as Booked; un-booked sessions offer Book
    await expect(page.getByText('Booked').first()).toBeVisible();
    await expect(page.getByText('Book', { exact: true }).first()).toBeVisible();
    // "Open to all" marks the open/free Junior Boxing
    await expect(page.getByText(/Open to all/)).toBeVisible();
  });

  test('fight record (boxing): W-L-D headline with sparring excluded', async ({ page }) => {
    await page.goto(`/profile?club=${BOX}`);
    await expect(page.getByText('FIGHT RECORD')).toBeVisible();
    // Alex's record: 2 wins, 1 loss, 0 draws (the sparring draw is NOT counted).
    const fr = page.locator('text=FIGHT RECORD').locator('xpath=..');
    await expect(fr.getByText('W', { exact: true })).toBeVisible();
    await expect(page.getByText('Sparring').first()).toBeVisible(); // sparring bout listed separately
    // seeded opponents render
    await expect(page.getByText('T. Walsh')).toBeVisible();
    await expect(page.getByText('H. Bauer')).toBeVisible();
  });

  test('grading (martial arts): belt progression renders', async ({ page }) => {
    await page.goto(`/profile?club=${MA}`);
    await expect(page.getByText('PROGRESSION')).toBeVisible();
    await expect(page.getByText(/Blue · 2 stripes/)).toBeVisible();
    await expect(page.getByText(/Adult Belt System/).first()).toBeVisible();
    await expect(page.getByText('Current')).toBeVisible();
  });

  test('safeguarding / consent fields render on the member profile', async ({ page }) => {
    await page.goto(`/profile?club=${BOX}`);
    await expect(page.getByText('ADDITIONAL NEEDS & CONSENTS')).toBeVisible();
    await expect(page.getByText('Emergency medical consent')).toBeVisible();
    await expect(page.getByText('PHOTO & IMAGE CONSENT')).toBeVisible();
    await expect(page.getByText('MEDICAL INFORMATION')).toBeVisible();
  });

  test('PT (/book): seeded upcoming appointment + bookable trainers', async ({ page }) => {
    await page.goto(`/book?club=${BOX}`);
    await expect(page.getByText('MY UPCOMING')).toBeVisible();
    await expect(page.getByText('Coach Mike').first()).toBeVisible();
    await expect(page.getByText('Coach Lara').first()).toBeVisible();
    await expect(page.getByText('£40.00').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' }).first()).toBeVisible();
  });

  test('membership pass (/m/token): status + class-pass balance + upcoming', async ({ page }) => {
    // Alex's boxing pass token (stable seed value).
    await page.goto('/m/m_755d25efcaa84394a39e8eb0f318320f');
    await expect(page.getByText('Demo Sports Centre').first()).toBeVisible();
    await expect(page.getByText('Full Adult · monthly')).toBeVisible();
    await expect(page.getByText('Active').first()).toBeVisible();
    await expect(page.getByText('10-Class Pass')).toBeVisible();
    await expect(page.getByText(/5 classes left/)).toBeVisible();
  });
});
