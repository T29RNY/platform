import { useState, useRef } from "react";
import { supabase } from "@platform/supabase";
import { EnvelopeSimple, PaperPlaneTilt, User } from "@phosphor-icons/react";

const BASE_URL = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.host}`
  : "https://www.in-or-out.com";

function JoinStyles() {
  return (
    <style>{`
      .join-shell {
        min-height: 100dvh;
        width: 100%;
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: max(28px, env(safe-area-inset-top)) 20px max(28px, env(safe-area-inset-bottom));
        background: var(--bg);
        color: var(--t1);
        font-family: "DM Sans", sans-serif;
      }

      .join-shell--checking {}

      .join-orb {
        position: absolute;
        width: 220px;
        height: 220px;
        border-radius: 999px;
        filter: blur(54px);
        opacity: 0.32;
        pointer-events: none;
      }

      .join-orb--green {
        top: 12%;
        left: -120px;
        background: rgba(61, 220, 106, 0.28);
      }

      .join-orb--red {
        top: 8%;
        right: -130px;
        background: rgba(255, 64, 64, 0.22);
      }

      .join-orb--gold {
        bottom: -110px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(232, 160, 32, 0.24);
      }

      .join-inner {
        width: 100%;
        max-width: 410px;
        position: relative;
        z-index: 2;
      }

      .join-brand {
        display: flex;
        justify-content: center;
        align-items: baseline;
        font-family: "Bebas Neue", sans-serif;
        font-size: clamp(64px, 17vw, 92px);
        line-height: 0.9;
        letter-spacing: 0.045em;
        color: var(--t1);
        text-transform: uppercase;
        user-select: none;
      }

      .join-brand--small {
        font-size: clamp(32px, 10vw, 44px);
        letter-spacing: 0.07em;
        margin-bottom: 48px;
      }

      .join-brand--quiet {
        animation: joinQuietPulse 1.8s ease-in-out infinite;
      }

      .join-brand__green {
        color: var(--green);
        text-shadow: 0 0 24px rgba(61, 220, 106, 0.48);
      }

      .join-brand__red {
        color: var(--red);
        text-shadow: 0 0 24px rgba(255, 64, 64, 0.42);
      }

      @keyframes joinQuietPulse {
        0%, 100% { opacity: 0.62; transform: scale(0.985); }
        50%       { opacity: 1;    transform: scale(1);     }
      }

      .join-auth-card {
        width: 100%;
        text-align: center;
      }

      .join-invite-label {
        font-family: "DM Sans", sans-serif;
        font-weight: 300;
        font-size: 14px;
        color: var(--t2);
        margin: 32px 0 6px;
        letter-spacing: 0.04em;
      }

      .join-invite-title {
        font-family: "Bebas Neue", sans-serif;
        font-size: clamp(32px, 9vw, 44px);
        line-height: 1;
        letter-spacing: 0.045em;
        font-weight: 400;
        color: var(--gold);
        text-transform: uppercase;
        margin: 0 0 36px;
        text-shadow: 0 0 28px rgba(232, 160, 32, 0.22);
      }

      .join-google-btn {
        width: 100%;
        min-height: 56px;
        border-radius: 14px;
        border: 1px solid rgba(232, 160, 32, 0.4);
        background: var(--s1);
        color: var(--t1);
        font-family: "DM Sans", sans-serif;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease, opacity 160ms ease;
      }

      .join-google-btn:active  { transform: scale(0.98); }
      .join-google-btn:disabled { opacity: 0.48; cursor: not-allowed; }

      .join-divider {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 20px 0;
        width: 100%;
      }

      .join-divider-line {
        flex: 1;
        height: 0.5px;
        background: rgba(242, 240, 234, 0.12);
      }

      .join-divider-text {
        font-family: "DM Sans", sans-serif;
        font-size: 11px;
        font-weight: 300;
        color: var(--t2);
        letter-spacing: 0.08em;
      }

      .join-email-link {
        background: transparent;
        border: none;
        color: var(--gold);
        font-family: "DM Sans", sans-serif;
        font-size: 14px;
        font-weight: 400;
        text-decoration: underline;
        text-underline-offset: 4px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        padding: 8px 10px;
      }

      .join-email-form {
        display: grid;
        gap: 14px;
        width: 100%;
        margin-top: 18px;
        animation: joinReveal 180ms ease-out both;
      }

      .join-field {
        min-height: 56px;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 16px;
        border-radius: 14px;
        background: var(--s1);
        border: 1px solid rgba(208, 204, 194, 0.17);
        color: var(--t2);
        transition: border-color 160ms ease, box-shadow 160ms ease;
      }

      .join-field:focus-within {
        border-color: rgba(232, 160, 32, 0.78);
        box-shadow: 0 0 0 3px rgba(232, 160, 32, 0.10);
      }

      .join-field input {
        width: 100%;
        min-width: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--t1);
        font-family: "DM Sans", sans-serif;
        font-size: 16px;
        font-weight: 400;
        -webkit-appearance: none;
        appearance: none;
      }

      .join-field input::placeholder {
        color: var(--t2);
        opacity: 0.64;
      }

      .join-secondary-btn {
        width: 100%;
        min-height: 56px;
        border-radius: 14px;
        border: 1px solid rgba(232, 160, 32, 0.28);
        background: var(--s2);
        color: var(--gold);
        font-family: "DM Sans", sans-serif;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease, opacity 160ms ease;
      }

      .join-secondary-btn:disabled { opacity: 0.48; cursor: not-allowed; }

      .join-email-link--muted {
        color: var(--t2);
        opacity: 0.72;
        text-decoration: none;
        margin-top: 4px;
      }

      .join-sent-box {
        width: 100%;
        margin-top: 32px;
        text-align: center;
      }

      .join-sent-title {
        font-family: "Bebas Neue", sans-serif;
        font-size: 28px;
        letter-spacing: 0.06em;
        color: var(--gold);
        margin: 0 0 12px;
      }

      .join-sent-body {
        font-family: "DM Sans", sans-serif;
        font-weight: 300;
        font-size: 14px;
        color: var(--t2);
        line-height: 1.5;
        margin: 0 0 12px;
      }

      .join-sent-email {
        color: var(--t1);
        font-weight: 400;
      }

      .join-sent-warn {
        font-family: "DM Sans", sans-serif;
        font-weight: 300;
        font-size: 12px;
        color: var(--t2);
        opacity: 0.6;
        line-height: 1.5;
        margin: 0 0 20px;
      }

      .join-error {
        margin: 16px 0 0;
        color: var(--red);
        font-family: "DM Sans", sans-serif;
        font-size: 13px;
        line-height: 1.45;
      }

      @keyframes joinReveal {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0);    }
      }

      @media (max-width: 380px) {
        .join-shell  { padding-left: 16px; padding-right: 16px; }
        .join-brand  { font-size: clamp(58px, 16vw, 78px); }
        .join-brand--small { font-size: 34px; }
      }
    `}</style>
  );
}

function BrandMark({ size = "large", quiet = false }) {
  const cls = "join-brand"
    + (size === "small" ? " join-brand--small" : "")
    + (quiet ? " join-brand--quiet" : "");
  return (
    <div className={cls}>
      <span className="join-brand__green">I</span>
      N OR{" "}
      <span className="join-brand__red">O</span>
      UT
    </div>
  );
}

function JoinShell({ children, checking = false }) {
  return (
    <main className={"join-shell" + (checking ? " join-shell--checking" : "")}>
      <div className="join-orb join-orb--green" />
      <div className="join-orb join-orb--red" />
      <div className="join-orb join-orb--gold" />
      <div className="join-inner">{children}</div>
    </main>
  );
}

function CheckingState() {
  return (
    <JoinShell checking>
      <BrandMark quiet />
    </JoinShell>
  );
}

function SignInStep({ team, onGoogle }) {
  const [email,     setEmail]     = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [sent,      setSent]      = useState(false);
  const [sending,   setSending]   = useState(false);
  const [authError, setAuthError] = useState(null);

  const handleEmailSignIn = async () => {
    if (!email.trim()) return;
    setSending(true); setAuthError(null);
    try {
      const returnTo = encodeURIComponent(window.location.href);
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${BASE_URL}/auth/callback?returnTo=${returnTo}` },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setAuthError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <JoinShell>
      <div className="join-auth-card">
        <BrandMark />
        <p className="join-invite-label">
          You've been invited to join
        </p>
        <h1 className="join-invite-title">
          {team?.name || "your team"}
        </h1>

        {sent ? (
          <div className="join-sent-box">
            <p className="join-sent-title">Check your email</p>
            <p className="join-sent-body">
              We sent a sign-in link to{" "}
              <span className="join-sent-email">{email}</span>
            </p>
            <p className="join-sent-warn">
              The link expires after one use. If it
              doesn't work, return to your invite link
              and try again.
            </p>
            <button
              type="button"
              className="join-email-link"
              onClick={() => { setSent(false); setEmail(""); }}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="join-google-btn"
              onClick={onGoogle}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
              </svg>
              Continue with Google
            </button>
            <div className="join-divider">
              <span className="join-divider-line" />
              <span className="join-divider-text">or</span>
              <span className="join-divider-line" />
            </div>

            {!emailOpen ? (
              <button
                type="button"
                className="join-email-link"
                onClick={() => setEmailOpen(true)}>
                Use email instead
              </button>
            ) : (
              <div className="join-email-form">
                <div className="join-field">
                  <EnvelopeSimple size={20} weight="thin" aria-hidden="true" />
                  <input
                    id="join-email"
                    type="email"
                    value={email}
                    placeholder="Email address"
                    autoComplete="email"
                    inputMode="email"
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleEmailSignIn(); }}
                    disabled={sending}
                  />
                </div>
                <button
                  type="button"
                  className="join-secondary-btn"
                  onClick={handleEmailSignIn}
                  disabled={sending || !email.trim()}>
                  <PaperPlaneTilt size={18} weight="thin" aria-hidden="true" />
                  {sending ? "Sending..." : "Send magic link"}
                </button>
                <button
                  type="button"
                  className="join-email-link join-email-link--muted"
                  onClick={() => setEmailOpen(false)}
                  disabled={sending}>
                  Back to Google sign in
                </button>
                {authError && (
                  <p className="join-error" role="alert">{authError}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </JoinShell>
  );
}

export default function JoinTeam({
  team, authUser, onNameSubmit, loading,
  error, prefillName, checking
}) {
  if (!authUser) return (
    <>
      <JoinStyles />
      <SignInStep team={team} onGoogle={() => {}} />
    </>
  );

  if (checking) return (
    <>
      <JoinStyles />
      <CheckingState />
    </>
  );

  return (
    <>
      <JoinStyles />
      <JoinShell>
        <BrandMark />
      </JoinShell>
    </>
  );
}
