import React, { useState, useEffect, useCallback } from "react";
import {
  superadminCreateVenue,
  superadminListVenues,
  superadminSetVenueVerification,
} from "@platform/core/storage/supabase.js";

// Phase 2 (League Mode) — Cycle 2.1 operator-led venue onboarding.
// Every operator-led venue is created here by a platform admin via this form.
// Venue Setup Wizard W5 adds the self-serve monitoring surface below: the
// new-signup ALERT list (superadmin_list_venues) + the rejected TAKEDOWN /
// restore override (superadmin_set_venue_verification) — trust-but-monitor,
// Decision #5.

const STATUS_LABEL = {
  verified: "Live",
  pending: "Pending",
  rejected: "Removed",
};

function VenueList() {
  const [venues, setVenues] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await superadminListVenues();
      setVenues(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(venueId, status) {
    if (busyId) return;
    setBusyId(venueId);
    setError(null);
    try {
      await superadminSetVenueVerification({ venueId, status });
      await load();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  if (venues === null && !error) {
    return (
      <div className="section">
        <h2 style={{ margin: 0, marginBottom: 8 }}>Venues</h2>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="section">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h2 style={{ margin: 0, marginBottom: 4 }}>Venues &amp; new sign-ups</h2>
        <button onClick={load} disabled={!!busyId}>Refresh</button>
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
        Newest first. Self-serve sign-ups appear here the moment they’re created —
        going live is automatic once the owner completes setup. Use Remove to take a
        venue down; Restore to reinstate.
      </p>

      {error && <div className="error" style={{ marginBottom: 12 }}>Error: {error}</div>}

      {venues && venues.length === 0 && <p className="muted">No venues yet.</p>}

      <div style={{ display: "grid", gap: 8 }}>
        {(venues || []).map((v) => (
          <div key={v.venue_id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600 }}>
                {v.name || "(unnamed)"}{" "}
                <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                  {v.city ? `· ${v.city}` : ""}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                <span>{v.origin === "self_serve" ? "Self-serve" : "Operator-led"}</span>
                {" · "}
                <span>{v.bookable_count || 0} bookable</span>
                {v.contact_email ? <> · <code className="mono">{v.contact_email}</code></> : null}
              </div>
            </div>
            <span
              className="pill"
              style={{
                padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: v.verification_status === "verified" ? "#123d24"
                  : v.verification_status === "rejected" ? "#3d1212" : "#3a3410",
                color: v.verification_status === "verified" ? "#5fd48b"
                  : v.verification_status === "rejected" ? "#ff8080" : "#e8cf5a",
              }}
            >
              {STATUS_LABEL[v.verification_status] || v.verification_status}
            </span>
            {v.verification_status === "rejected" ? (
              <button disabled={busyId === v.venue_id} onClick={() => setStatus(v.venue_id, "pending")}>
                {busyId === v.venue_id ? "…" : "Restore"}
              </button>
            ) : (
              <button disabled={busyId === v.venue_id} onClick={() => setStatus(v.venue_id, "rejected")}>
                {busyId === v.venue_id ? "…" : "Remove"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const FORMAT_OPTIONS = [
  "5-a-side",
  "6-a-side",
  "7-a-side",
  "8-a-side",
  "9-a-side",
  "11-a-side",
];

const DAY_OPTIONS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

function copyToClipboard(text) {
  if (!text) return;
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch((err) => {
      console.error("[venues] clipboard write failed", err);
    });
  }
}

function originUrl(path) {
  if (typeof window === "undefined") return path;
  return window.location.origin.replace("platform-superadmin", "platform-clubmanager") + path;
}

export default function Venues() {
  const [name, setName] = useState("");
  const [operatorEmail, setOperatorEmail] = useState("");
  const [sport, setSport] = useState("football");
  const [createLeague, setCreateLeague] = useState(true);
  const [leagueName, setLeagueName] = useState("");
  const [leagueFormat, setLeagueFormat] = useState("5-a-side");
  const [leagueDay, setLeagueDay] = useState("2");
  const [leagueKickoff, setLeagueKickoff] = useState("19:30");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function reset() {
    setName("");
    setOperatorEmail("");
    setSport("football");
    setCreateLeague(true);
    setLeagueName("");
    setLeagueFormat("5-a-side");
    setLeagueDay("2");
    setLeagueKickoff("19:30");
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
      const firstLeague = createLeague
        ? {
            name: leagueName.trim() || `${name.trim()} League`,
            format: leagueFormat,
            day_of_week: leagueDay,
            default_kickoff: leagueKickoff,
          }
        : null;
      const data = await superadminCreateVenue({
        name: name.trim(),
        operatorEmail: operatorEmail.trim(),
        sport,
        firstLeague,
      });
      setResult(data);
    } catch (err) {
      const msg = err?.message || String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const venueUrl = originUrl(result.venue_url);
    const leagueUrl = result.league_url ? originUrl(result.league_url) : null;
    return (
      <div>
        <div className="section">
          <h2 style={{ margin: 0, marginBottom: 12 }}>Venue created ✓</h2>

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Venue dashboard URL</h3>
            <p className="muted" style={{ marginBottom: 6 }}>
              Share this with the venue operator. It is the venue admin's
              entry point to the dashboard.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code className="mono" style={{ flex: 1, padding: "8px 10px", background: "#0f0f12", borderRadius: 6, wordBreak: "break-all" }}>
                {venueUrl}
              </code>
              <button onClick={() => copyToClipboard(venueUrl)}>Copy</button>
            </div>
            <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              <div>Venue ID: <code className="mono">{result.venue_id}</code></div>
              <div>Token: <code className="mono">{result.venue_token}</code></div>
            </div>
          </div>

          {leagueUrl && (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>League /join/ URL</h3>
              <p className="muted" style={{ marginBottom: 6 }}>
                Share this with team admins so they can register their team
                into the league.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code className="mono" style={{ flex: 1, padding: "8px 10px", background: "#0f0f12", borderRadius: 6, wordBreak: "break-all" }}>
                  {leagueUrl}
                </code>
                <button onClick={() => copyToClipboard(leagueUrl)}>Copy</button>
              </div>
              <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                <div>League ID: <code className="mono">{result.league_id}</code></div>
                <div>League Code: <code className="mono">{result.league_code}</code></div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={reset}>Create another venue</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <VenueList />
      <div className="section">
        <h2 style={{ margin: 0, marginBottom: 4 }}>Create venue</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Operator-led onboarding. Creates the venue, generates the admin
          token, optionally creates a first league with a /join/ code.
        </p>

        {error && (
          <div className="error" style={{ marginBottom: 12 }}>
            {error === "not_platform_admin"
              ? "You are not a platform admin."
              : error === "venue_name_required"
              ? "Venue name is required."
              : error === "operator_email_invalid"
              ? "Operator email is invalid."
              : `Error: ${error}`}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14, maxWidth: 560 }}>
          <label className="field">
            <span>Venue name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Goals Manchester"
              required
            />
          </label>

          <label className="field">
            <span>Operator email</span>
            <input
              type="email"
              value={operatorEmail}
              onChange={(e) => setOperatorEmail(e.target.value)}
              placeholder="manager@goalsmanchester.co.uk"
              required
            />
          </label>

          <label className="field">
            <span>Sport</span>
            <select value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="football">Football</option>
              <option value="cricket">Cricket</option>
              <option value="basketball">Basketball</option>
              <option value="netball">Netball</option>
              <option value="hockey">Hockey</option>
            </select>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={createLeague}
              onChange={(e) => setCreateLeague(e.target.checked)}
            />
            <span>Also create a first league</span>
          </label>

          {createLeague && (
            <div className="card" style={{ display: "grid", gap: 14 }}>
              <label className="field">
                <span>League name <span className="muted">(optional)</span></span>
                <input
                  type="text"
                  value={leagueName}
                  onChange={(e) => setLeagueName(e.target.value)}
                  placeholder={`${name.trim() || "Venue"} League`}
                />
              </label>

              <label className="field">
                <span>Format</span>
                <select value={leagueFormat} onChange={(e) => setLeagueFormat(e.target.value)}>
                  {FORMAT_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Match night</span>
                <select value={leagueDay} onChange={(e) => setLeagueDay(e.target.value)}>
                  {DAY_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Default kickoff</span>
                <input
                  type="time"
                  value={leagueKickoff}
                  onChange={(e) => setLeagueKickoff(e.target.value)}
                />
              </label>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create venue"}
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
