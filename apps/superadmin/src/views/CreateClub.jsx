import React, { useState } from "react";
import { superadminCreateClub } from "@platform/core/storage/supabase.js";

// DF Sports Onboarding — PR #2. Operator-led venueless-club onboarding.
// A platform admin mints a facility-less club (e.g. a coaching academy) here
// by calling superadmin_create_club (mig 578). One atomic call provisions a
// shell venue (origin='self_serve') + a clubs row + the club_venues link + an
// OWNER INVITE by email. The owner does NOT get a token/dashboard URL to share
// (unlike a venue) — they become the club admin automatically when they sign in
// with the invited email. Mirrors the Venues.jsx create-form pattern.

const SPORT_OPTIONS = [
  { value: "football", label: "Football" },
  { value: "cricket", label: "Cricket" },
  { value: "basketball", label: "Basketball" },
  { value: "netball", label: "Netball" },
  { value: "hockey", label: "Hockey" },
];

const ERROR_LABEL = {
  not_platform_admin: "You are not a platform admin.",
  club_name_required: "Club name is required.",
  club_name_too_long: "Club name is too long (max 120 characters).",
  club_name_unusable: "Club name must contain at least one letter or number.",
  owner_email_invalid: "Owner email is invalid.",
  club_id_taken: "A club with this name already exists — pick a different name.",
};

function copyToClipboard(text) {
  if (!text) return;
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch((err) => {
      console.error("[create-club] clipboard write failed", err);
    });
  }
}

export default function CreateClub() {
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [shortName, setShortName] = useState("");
  const [sport, setSport] = useState("football");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function reset() {
    setName("");
    setOwnerEmail("");
    setShortName("");
    setSport("football");
    setResult(null);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const data = await superadminCreateClub({
        name: name.trim(),
        ownerEmail: ownerEmail.trim(),
        shortName: shortName.trim() || null,
        sport,
      });
      setResult(data);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div>
        <div className="section">
          <h2 style={{ margin: 0, marginBottom: 12 }}>Club created ✓</h2>

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Owner access</h3>
            <p className="muted" style={{ marginBottom: 6 }}>
              An owner invite has been created for{" "}
              <code className="mono">{result.owner_email}</code>. There is no
              link or token to send — the owner becomes the club admin
              automatically the first time they sign in with that email address.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code
                className="mono"
                style={{ flex: 1, padding: "8px 10px", background: "#0f0f12", borderRadius: 6, wordBreak: "break-all" }}
              >
                {result.owner_email}
              </code>
              <button onClick={() => copyToClipboard(result.owner_email)}>Copy</button>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 13, display: "grid", gap: 4 }}>
              <div>Club ID: <code className="mono">{result.club_id}</code></div>
              <div>Venue ID: <code className="mono">{result.venue_id}</code></div>
              <div>
                Owner invite:{" "}
                <span className="pill" style={{ padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "#3a3410", color: "#e8cf5a" }}>
                  {result.owner_status || "invited"}
                </span>
              </div>
              <div>Status: {result.verification_status} · {result.origin === "self_serve" ? "Self-serve" : result.origin}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={reset}>Create another club</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section">
        <h2 style={{ margin: 0, marginBottom: 4 }}>Create club</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Operator-led onboarding for a facility-less club (e.g. a coaching
          academy). Creates the club, its home shell, and an owner invite. The
          owner claims admin access by signing in with the email below — no
          token to share.
        </p>

        {error && (
          <div className="error" style={{ marginBottom: 12 }}>
            {ERROR_LABEL[error] || `Error: ${error}`}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14, maxWidth: 560 }}>
          <label className="field">
            <span>Club name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="DF Sports Coaching"
              required
            />
          </label>

          <label className="field">
            <span>Owner email</span>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="danny@dfsportscoaching.co.uk"
              required
            />
          </label>

          <label className="field">
            <span>Short name <span className="muted">(optional)</span></span>
            <input
              type="text"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="DF Sports"
            />
          </label>

          <label className="field">
            <span>Sport</span>
            <select value={sport} onChange={(e) => setSport(e.target.value)}>
              {SPORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create club"}
            </button>
            <button type="button" onClick={reset} disabled={submitting}>
              Reset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
