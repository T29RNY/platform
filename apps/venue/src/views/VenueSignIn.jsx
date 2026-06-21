import React, { useState } from "react";
import { supabase } from "@platform/core/storage/supabase.js";

// Venue console sign-in (mig 237 staff logins). Auth-method parity with the
// consumer app (Phase 0e): Google + Apple OAuth, email magic-link, and the
// existing email/password — so a multi-role human never needs different
// credentials per app. On success the Supabase session is persisted and App's
// onAuthStateChange takes over (claim invites → whoami → dashboard).
// Apple logo — currentColor so it inherits the button text colour (no hex).
const APPLE_SVG = (
  <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M17.05 12.04c-.03-2.86 2.34-4.23 2.44-4.3-1.33-1.95-3.41-2.21-4.15-2.24-1.77-.18-3.45 1.04-4.35 1.04-.89 0-2.27-1.01-3.74-.99-1.92.03-3.69 1.12-4.68 2.84-2 3.46-.51 8.58 1.43 11.39.95 1.38 2.08 2.92 3.56 2.87 1.43-.06 1.97-.92 3.7-.92 1.72 0 2.21.92 3.72.89 1.54-.03 2.51-1.4 3.45-2.79 1.09-1.6 1.54-3.15 1.56-3.23-.03-.02-2.99-1.15-3.02-4.55zM14.2 4.38c.79-.96 1.32-2.29 1.18-3.62-1.14.05-2.52.76-3.33 1.72-.73.85-1.37 2.21-1.2 3.51 1.27.1 2.57-.65 3.35-1.61z"/>
  </svg>
);

export default function VenueSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const google = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  };

  const apple = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  };

  const magicLink = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) { setError(error.message); setBusy(false); }
    else { setSent(true); setBusy(false); }
  };

  const passwordSignIn = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Wrong email or password."
          : error.message,
      );
      setBusy(false);
    }
    // On success, App's auth listener swaps to the dashboard — no further work here.
  };

  return (
    <div className="token-screen">
      <div className="token-card">
        <div className="brand-row">
          <div className="mark">io</div>
          <div className="wm">In or Out</div>
        </div>
        <h1>Venue console</h1>
        {sent ? (
          <>
            <p>We sent a sign-in link to <strong>{email}</strong>. Tap it to continue — no password needed.</p>
            <button className="btn" type="button" onClick={() => { setSent(false); setEmail(""); }}>
              Use a different email
            </button>
          </>
        ) : (
        <>
        <p>Sign in to manage your venue.</p>

        <button className="btn btn-apple" type="button" onClick={apple}>
          {APPLE_SVG}
          Continue with Apple
        </button>

        <button className="btn btn-google" type="button" onClick={google}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" />
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" />
            <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" />
            <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z" />
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider"><span>or</span></div>

        <form className="auth-form" onSubmit={passwordSignIn}>
          <input
            className="input"
            type="email"
            placeholder="Email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <button className="btn btn-link" type="button" onClick={magicLink} disabled={busy || !email.trim()}>
          Email me a sign-in link instead
        </button>
        </>
        )}

        {error && <div className="banner banner-warn" style={{ marginTop: 16 }}>{error}</div>}
      </div>
    </div>
  );
}
