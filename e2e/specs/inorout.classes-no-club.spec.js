import { test, expect } from '@playwright/test';

// Project inorout-alex (storageState = Alex, member of BOTH combat clubs).
// Regression for e2e finding #1: a member of 2+ clubs opening /classes with no
// ?club= param has no club selected yet (the chips are the selector). Pre-fix,
// ClassesScreen rendered "No venue linked to this club yet." — conflating the
// no-club-selected state with a club that genuinely has no venue. Post-fix it
// shows a no-selection prompt and never the misleading no-venue copy.

test.describe('inorout — /classes no-club-selected copy (regression)', () => {
  test('multi-club member with no ?club= sees a select-a-club prompt, not "no venue"', async ({ page }) => {
    await page.goto('/classes');

    // Both club chips are present (the selector).
    await expect(page.getByText('Demo Boxing Club · Adults')).toBeVisible();
    await expect(page.getByText('Demo Martial Arts · Adults')).toBeVisible();

    // No club chosen yet → the no-selection prompt, NOT the no-venue copy.
    await expect(page.getByText('Select a club above to see its class timetable.')).toBeVisible();
    await expect(page.getByText('No venue linked to this club yet.')).toHaveCount(0);
  });

  test('selecting a club then renders its timetable (no stale no-venue copy)', async ({ page }) => {
    await page.goto('/classes');
    await page.getByText('Demo Boxing Club · Adults').click();
    // Seeded timetable renders for the selected club's venue.
    await expect(page.getByText('Select a club above to see its class timetable.')).toHaveCount(0);
    await expect(page.getByText('No venue linked to this club yet.')).toHaveCount(0);
  });
});
