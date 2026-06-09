import React, { useState } from "react";
import { superadminCreateTeam } from "@platform/core/storage/supabase.js";

// Operator-led casual squad creation (mig 239 superadmin_create_team). Creates the squad
// shell (team + schedule + settings + admin_token) — no members. Hands back an admin URL
// (/admin/<admin_token>) to give the new operator, plus a join link for players.

const CASUAL_BASE = "https://www.in-or-out.com";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function copyToClipboard(text) {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).catch((err) => console.error("[createsquad] copy failed", err));
}

export default function CreateSquad() {
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("Tuesday");
  const [kickoff, setKickoff] = useState("19:30");
  const [squadSize, setSquadSize] = useState(10);
  const [venue, setVenue] = useState("");
  const [price, setPrice] = useState("5");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function reset() {
    setName(""); setAdminEmail(""); setDayOfWeek("Tuesday"); setKickoff("19:30");
    setSquadSize(10); setVenue(""); setPrice("5"); setResult(null); setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const data = await superadminCreateTeam({
        name: name.trim(),
        adminEmail: adminEmail.trim(),
        dayOfWeek,
        kickoff,
        squadSize: Number(squadSize),
        venue: venue.trim() || null,
        price: Number(price) || 0,
      });
      setResult(data);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const adminUrl = `${CASUAL_BASE}/admin/${result.admin_token}`;
    const joinUrl = `${CASUAL_BASE}/join/${result.join_code}`;
    return (
      <div>
        <div className="section">
          <h2 style={{ margin: 0, marginBottom: 12 }}>Squad created ✓ — {result.name}</h2>

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Admin link</h3>
            <p className="muted" style={{ marginBottom: 6 }}>
              Send this to the squad's organiser — it's their full admin access (no login needed).
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code className="mono" style={{ flex: 1, padding: "8px 10px", background: "#0f0f12", borderRadius: 6, wordBreak: "break-all" }}>{adminUrl}</code>
              <button onClick={() => copyToClipboard(adminUrl)}>Copy</button>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Join link</h3>
            <p className="muted" style={{ marginBottom: 6 }}>
              Players use this to join the squad.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code className="mono" style={{ flex: 1, padding: "8px 10px", background: "#0f0f12", borderRadius: 6, wordBreak: "break-all" }}>{joinUrl}</code>
              <button onClick={() => copyToClipboard(joinUrl)}>Copy</button>
            </div>
            <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              <div>Squad ID: <code className="mono">{result.team_id}</code></div>
              <div>Join code: <code className="mono">{result.join_code}</code></div>
            </div>
          </div>

          <button onClick={reset}>Create another squad</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section">
        <h2 style={{ margin: 0, marginBottom: 4 }}>Create squad</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Sets up a casual squad (no players yet) and gives you an admin link to hand to the organiser.
        </p>

        {error && (
          <div className="error" style={{ marginBottom: 12 }}>
            {error === "team_name_required" ? "Squad name is required."
              : error === "admin_email_invalid" ? "Admin email is invalid."
              : error === "invalid_squad_size" ? "Squad size must be 1–30."
              : error === "invalid_day" ? "Pick a valid match day."
              : error === "forbidden" ? "You are not a platform admin."
              : `Error: ${error}`}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14, maxWidth: 560 }}>
          <label className="field">
            <span>Squad name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tuesday Night Footy" required />
          </label>
          <label className="field">
            <span>Organiser email</span>
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="organiser@email.com" required />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label className="field">
              <span>Match day</span>
              <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Kickoff</span>
              <input type="time" value={kickoff} onChange={(e) => setKickoff(e.target.value)} required />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label className="field">
              <span>Squad size</span>
              <input type="number" min="1" max="30" value={squadSize} onChange={(e) => setSquadSize(e.target.value)} required />
            </label>
            <label className="field">
              <span>Price per player (£)</span>
              <input type="number" min="0" step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Venue <span className="muted">(optional)</span></span>
            <input type="text" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Goals Manchester" />
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create squad"}</button>
            <button type="button" onClick={reset} disabled={submitting}>Reset</button>
          </div>
        </form>
      </div>
    </div>
  );
}
