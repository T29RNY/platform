// e2e auth — mint Supabase sessions for the demo users and build Playwright
// storageState that authenticates EVERY app. All apps share one Supabase client
// with default persistence, so the session lives in localStorage under the same
// key for every origin — inject it and the app boots signed-in (no UI login,
// no OTP). See DEMO_USERS.md for the accounts.

export const SUPABASE_URL = 'https://ktvpzpnqbwhooiaqrigm.supabase.co';
export const SUPABASE_REF = 'ktvpzpnqbwhooiaqrigm';
// anon/publishable key — public by design (already shipped in every app bundle).
export const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0dnB6cG5xYndob29pYXFyaWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzODIyMjEsImV4cCI6MjA5Mzk1ODIyMX0.xgboGTm1O9dOI17UhlxyqcuJ8ZUYqHJusNwcgYeVoxk';
export const STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`;

// Dev-server origins per app (ports from each app's `npm run dev`).
// NOTE: league + hq both default to 5177 — run one at a time if testing both.
export const ORIGINS = {
  inorout: 'http://localhost:5173',
  clubmanager: 'http://localhost:5174',
  superadmin: 'http://localhost:5175',
  venue: 'http://localhost:5176',
  hq: 'http://localhost:5177',
  ref: 'http://localhost:5180',
  display: 'http://localhost:5181',
};

// The two cross-role demo accounts (mig 364/365).
export const USERS = {
  // Alex: platform superadmin · HQ super_admin · venue owner · squad admin ·
  // casual+competitive player · member of both combat clubs.
  alex: { email: 'tarny+demo@lettrack.co.uk', password: 'DemoBoss1!' },
  // Sam: plain member (paused) · guardian of a junior · venue staff (booking caps) · player.
  sam: { email: 'tarny+family@lettrack.co.uk', password: 'DemoFam2!' },
};

// Mint a session via the GoTrue password grant. Returns the session object whose
// shape IS exactly what supabase-js persists to localStorage
// ({access_token, token_type, expires_in, expires_at, refresh_token, user, ...}).
export async function mintSession(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login failed for ${email}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Build a Playwright storageState injecting the session for every app origin
// (localStorage is per-origin, so include them all → one state file per user
// works against any app).
export function storageStateFor(session, origins = Object.values(ORIGINS)) {
  const value = JSON.stringify(session);
  return {
    cookies: [],
    origins: origins.map((origin) => ({
      origin,
      localStorage: [{ name: STORAGE_KEY, value }],
    })),
  };
}
