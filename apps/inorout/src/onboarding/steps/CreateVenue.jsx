import { useState, useRef } from "react";
import { CaretLeft, MapPin, ArrowSquareOut } from "@phosphor-icons/react";
import { selfServeCreateVenue } from "@platform/core/storage/supabase.js";

// Self-serve VENUE creation — the "shell now, configure later" step (epic Decision #6).
// A venue operator setting hours + pitches + payouts is a laptop job, so the native app
// captures only the committing minimum (name + contact email) via self_serve_create_venue
// (mig 484), which binds the creator as the venue's first venue_admins owner, then hands
// off to the apps/venue web console under Phase-0e SSO (Decision #1). v1 accepts one
// re-auth on the console (same account resolves via the owner row) — the deep-link is a
// plain navigation, not a token pass (the master venue_admin_token is never handed to a
// self-serve client).
//
// Self-contained by design: it owns its own state and calls the core wrapper directly
// rather than threading through useOnboarding, so the shared casual create hook stays
// byte-identical (casual-regression safety).

const VENUE_APP_BASE = import.meta.env.VITE_VENUE_APP_URL || "https://venue.in-or-out.com";

const EMAIL_RE = /^[^@]+@[^@]+\.[^@]+$/;

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block", marginBottom: 18 }}>
      <div style={{
        fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--t2)",
        marginBottom: 8,
      }}>
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--t2)", marginTop: 6 }}>
          {hint}
        </div>
      )}
    </label>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "var(--s2)", border: "1px solid var(--border-subtle)",
  borderRadius: "var(--r)", padding: "13px 14px",
  color: "var(--t1)", fontFamily: "var(--font-body)", fontSize: 16,
};

export default function CreateVenue({ authUser, onBack }) {
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState(authUser?.email || "");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [created, setCreated] = useState(null); // { venue_id } once the shell exists
  const savingRef = useRef(false);

  const pageStyle = { padding: "calc(28px + env(safe-area-inset-top)) 20px calc(40px + env(safe-area-inset-bottom))", minHeight: "100dvh" };

  const nameOk  = name.trim().length >= 2;
  const emailOk = EMAIL_RE.test(email.trim());
  const canSubmit = nameOk && emailOk && !loading;

  const friendly = (e) => {
    const m = e?.message || "";
    if (/self_serve_venue_cap_reached/.test(m)) return "You've reached the limit of 3 venues still awaiting verification. Finish setting one up first.";
    if (/venue_name_required|venue_name_too_long/.test(m)) return "Please enter a valid venue name.";
    if (/contact_email_invalid/.test(m)) return "Please enter a valid contact email.";
    if (/auth_required/.test(m)) return "Please sign in again to create a venue.";
    return "Something went wrong creating your venue. Please try again.";
  };

  const submit = async () => {
    if (savingRef.current || !canSubmit) return;
    savingRef.current = true;
    setLoading(true); setError(null);
    try {
      const data = await selfServeCreateVenue({
        name: name.trim(),
        contactEmail: email.trim(),
      });
      setCreated({ venue_id: data?.venue_id ?? null });
    } catch (e) {
      console.error("selfServeCreateVenue failed", e);
      setError(friendly(e));
    } finally {
      setLoading(false);
      savingRef.current = false;
    }
  };

  // ── Success hand-off ───────────────────────────────────────────────────────
  if (created) {
    return (
      <div style={pageStyle}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16, marginTop: 40 }}>
          <MapPin size={48} weight="thin" color="var(--gold)" />
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 30, letterSpacing: 0.6, margin: 0 }}>
            {name.trim()} is ready
          </h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 15, lineHeight: 1.5, color: "var(--t2)", maxWidth: 320, margin: 0 }}>
            You're the owner. Finish setting up — pitches, opening hours, leagues and
            payouts — on the venue console. It works best on a computer. Sign in with
            this same account and your venue will be waiting.
          </p>
          <a
            href={VENUE_APP_BASE}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8,
              background: "var(--gold)", color: "var(--bg)", textDecoration: "none",
              fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600,
              borderRadius: "var(--r)", padding: "13px 22px",
            }}
          >
            Open venue console <ArrowSquareOut size={18} weight="thin" />
          </a>
        </div>
      </div>
    );
  }

  // ── The shell form ─────────────────────────────────────────────────────────
  return (
    <div style={pageStyle}>
      <button
        type="button"
        onClick={onBack}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, background: "none",
          border: "none", color: "var(--t2)", fontFamily: "var(--font-body)",
          fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 24,
        }}
      >
        <CaretLeft size={16} weight="thin" /> Back
      </button>

      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32, letterSpacing: 0.6, margin: "0 0 6px" }}>
        Set up your venue
      </h1>
      <p style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--t2)", margin: "0 0 24px" }}>
        Just the name to get started. You'll add pitches, hours and everything else on
        the venue console next.
      </p>

      <Field label="Venue name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Riverside Powerleague"
          maxLength={120}
          style={inputStyle}
        />
      </Field>

      <Field label="Contact email" hint="Where we'll reach you about this venue.">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoCorrect="off"
          style={inputStyle}
        />
      </Field>

      {error && (
        <div style={{
          fontFamily: "var(--font-body)", fontSize: 13, color: "var(--danger, #FF6060)",
          margin: "4px 0 16px",
        }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        style={{
          width: "100%", boxSizing: "border-box",
          background: canSubmit ? "var(--gold)" : "var(--s2)",
          color: canSubmit ? "var(--bg)" : "var(--t2)",
          border: canSubmit ? "none" : "1px solid var(--border-subtle)",
          borderRadius: "var(--r)", padding: "15px 16px",
          fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 600,
          cursor: canSubmit ? "pointer" : "default", marginTop: 8,
        }}
      >
        {loading ? "Creating…" : "Create venue →"}
      </button>
    </div>
  );
}
