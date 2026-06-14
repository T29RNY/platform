import React, { useEffect, useRef, useState } from "react";
import { tournamentJoinViaInvite } from "@platform/core/storage/supabase.js";

const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  } catch { return iso; }
};

export default function TournamentJoinScreen({ code }) {
  const [loading, setLoading]       = useState(true);
  const [invalid, setInvalid]       = useState(false);
  const [invite, setInvite]         = useState(null);  // {tournament_name, competition_name, ...}
  const [teamName, setTeamName]     = useState("");
  const [saving, setSaving]         = useState(false);
  const [done, setDone]             = useState(null);  // {tournament_name, competition_name}
  const [error, setError]           = useState(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!code) { setInvalid(true); setLoading(false); return; }
    setLoading(false);
  }, [code]);

  const handleJoin = async () => {
    if (isSavingRef.current) return;
    const name = teamName.trim();
    if (!name) { setError("Enter your team name."); return; }
    isSavingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await tournamentJoinViaInvite(code, name);
      if (result?.ok) {
        setDone({ tournament_name: result.tournament_name, competition_name: result.competition_name });
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch (e) {
      console.error("[tournament-join] failed", e);
      const msg = e?.message ?? "";
      if (msg.includes("invite_not_found"))   setError("This invite link is not valid.");
      else if (msg.includes("invite_already_used")) setError("This invite has already been used.");
      else if (msg.includes("invite_expired"))      setError("This invite link has expired.");
      else if (msg.includes("team_name_required"))  setError("Enter your team name.");
      else setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
      isSavingRef.current = false;
    }
  };

  const shell = (children) => (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg, #0A0A08)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 32,
      fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
    }}>
      <div style={{
        maxWidth: 440, width: "100%",
        background: "var(--b2, rgba(255,255,255,0.04))",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
        borderRadius: 16, padding: "32px 28px",
        display: "flex", flexDirection: "column", gap: 20,
      }}>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div style={{ fontSize: 14, color: "var(--t2)", textAlign: "center" }}>Loading…</div>
    );
  }

  if (done) {
    return shell(
      <>
        <div style={{ fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)", fontSize: 28, color: "var(--t1, #fff)", lineHeight: 1 }}>
          Registration submitted
        </div>
        <div style={{ fontSize: 14, color: "var(--t2)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--t1)" }}>{done.tournament_name}</strong> — {done.competition_name}
          <br />Your team is pending approval from the host. You'll hear back soon.
        </div>
        <a href="/" style={{ fontSize: 13, color: "var(--t2)", textDecoration: "none", textAlign: "center", marginTop: 4 }}>
          ← Back to home
        </a>
      </>
    );
  }

  return shell(
    <>
      <div style={{ fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)", fontSize: 28, color: "var(--t1, #fff)", lineHeight: 1 }}>
        Join tournament
      </div>
      <div style={{ fontSize: 14, color: "var(--t2)", lineHeight: 1.5 }}>
        Enter your team name to register. Your registration will be sent to the host for approval.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", textTransform: "uppercase" }}>
          Team name
        </label>
        <input
          type="text"
          value={teamName}
          onChange={e => setTeamName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
          placeholder="e.g. Westside FC"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid var(--border-subtle, rgba(255,255,255,0.12))",
            borderRadius: 8, padding: "10px 14px",
            fontSize: 15, color: "var(--t1, #fff)",
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            outline: "none",
          }}
        />
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "#FF6060", background: "rgba(255,96,96,0.08)", borderRadius: 8, padding: "10px 14px" }}>
          {error}
        </div>
      )}

      <button
        onClick={handleJoin}
        disabled={saving}
        style={{
          background: saving ? "rgba(255,255,255,0.08)" : "rgba(255,190,60,0.15)",
          border: "1px solid rgba(255,190,60,0.3)",
          color: saving ? "var(--t2)" : "var(--amber, #FFBE3C)",
          borderRadius: 10, padding: "12px 20px",
          fontSize: 15, fontWeight: 700,
          fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
          cursor: saving ? "not-allowed" : "pointer",
          transition: "opacity 0.15s",
        }}
      >
        {saving ? "Submitting…" : "Register team"}
      </button>

      <a href="/" style={{ fontSize: 13, color: "var(--t2)", textDecoration: "none", textAlign: "center" }}>
        ← Back to home
      </a>
    </>
  );
}
