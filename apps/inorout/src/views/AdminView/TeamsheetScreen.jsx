import { useState } from "react";
import { CaretLeft, Check, Warning } from "@phosphor-icons/react";
import { submitTeamLineup } from "@platform/core";

// League Mode Cycle 5.6 — the manager builds the line-up for the next fixture from the
// players who marked themselves IN (the 5.5 board). Players not marked in are shown lower
// down so one can still be pulled in. Submitting writes the line-up (and registers the
// picked players into the competition server-side). League teams field one team v an
// external opponent — there is no casual A/B split here.

function fmtDate(d) {
  if (!d) return null;
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "short", day: "numeric", month: "short",
    });
  } catch { return d; }
}

export default function TeamsheetScreen({ fixture, existingLineup, squad, adminToken, onBack, onSubmitted }) {
  // assignment: { [playerId]: 'start' | 'bench' }  ·  shirts: { [playerId]: string }
  const [assign, setAssign] = useState(() => {
    const a = {};
    (existingLineup?.starting || []).forEach(id => { a[id] = "start"; });
    (existingLineup?.bench || []).forEach(id => { a[id] = "bench"; });
    return a;
  });
  const [shirts, setShirts] = useState(() => {
    const s = {};
    Object.entries(existingLineup?.shirt_numbers || {}).forEach(([id, n]) => { s[id] = String(n); });
    return s;
  });
  const [showOthers, setShowOthers] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);

  const eligible = squad.filter(p => !p.disabled && !p.isGuest);
  const inPlayers = eligible.filter(p => p.status === "in");
  const others    = eligible.filter(p => p.status !== "in");

  const startingIds = Object.keys(assign).filter(id => assign[id] === "start");
  const benchIds    = Object.keys(assign).filter(id => assign[id] === "bench");

  const setRole = (id, role) =>
    setAssign(prev => ({ ...prev, [id]: prev[id] === role ? undefined : role }));

  const opponent = fixture?.opponent_name || "TBC";
  const oppLabel = `${fixture?.is_home ? "vs" : "@"} ${opponent}`;
  const dateLabel = [fmtDate(fixture?.scheduled_date), fixture?.kickoff_time ? fixture.kickoff_time.slice(0, 5) : null,
                     fixture?.playing_area].filter(Boolean).join(" · ");

  const submit = async () => {
    if (!startingIds.length || saving) return;
    setSaving(true); setError(null); setResult(null);
    const shirtNums = {};
    [...startingIds, ...benchIds].forEach(id => {
      const n = parseInt(shirts[id], 10);
      if (!Number.isNaN(n)) shirtNums[id] = n;
    });
    try {
      const data = await submitTeamLineup(adminToken, fixture.id, {
        starting: startingIds, bench: benchIds, shirt_numbers: shirtNums,
      });
      setResult(data);
      onSubmitted?.();
    } catch (e) {
      console.error("[teamsheet] submit failed", e);
      setError("Couldn't save the team sheet. Tap to try again.");
    } finally {
      setSaving(false);
    }
  };

  const label = { fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.08em", color: "var(--t2)" };
  const roleBtn = (active, color) => ({
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: "0.05em",
    padding: "5px 10px", borderRadius: 8, cursor: "pointer",
    border: `0.5px solid ${active ? color : "rgba(255,255,255,0.14)"}`,
    background: active ? color : "transparent",
    color: active ? "var(--bg)" : "var(--t2)",
  });

  const Row = (p) => {
    const role = assign[p.id];
    return (
      <div key={p.id} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
        borderBottom: "0.5px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ flex: 1, minWidth: 0, fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "var(--t1)" }}>
          {p.nickname || p.name}
        </span>
        {role && (
          <input
            value={shirts[p.id] || ""}
            onChange={e => setShirts(s => ({ ...s, [p.id]: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) }))}
            placeholder="#"
            inputMode="numeric"
            style={{
              width: 34, textAlign: "center", padding: "5px 0", borderRadius: 8,
              border: "0.5px solid rgba(255,255,255,0.14)", background: "var(--s2)",
              color: "var(--t1)", fontFamily: "'DM Sans', sans-serif", fontSize: 13, outline: "none",
            }}
          />
        )}
        <button onClick={() => setRole(p.id, "start")} style={roleBtn(role === "start", "var(--green)")}>START</button>
        <button onClick={() => setRole(p.id, "bench")} style={roleBtn(role === "bench", "var(--amber)")}>BENCH</button>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", paddingBottom: 120 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px" }}>
        <CaretLeft weight="thin" size={22} color="var(--t1)" style={{ cursor: "pointer" }} onClick={onBack} />
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em", color: "var(--t1)" }}>
          TEAMSHEET
        </span>
      </div>

      {/* Fixture summary */}
      <div style={{ margin: "0 16px 16px", padding: "14px 16px", background: "var(--s1)",
        border: "0.5px solid var(--purpleb)", borderRadius: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--t1)", letterSpacing: "0.02em" }}>
          {oppLabel}
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
          {[fixture?.competition_name, dateLabel].filter(Boolean).join("  ·  ")}
        </div>
      </div>

      {/* Count bar */}
      <div style={{ display: "flex", gap: 16, padding: "0 16px 12px", ...label }}>
        <span>STARTING {startingIds.length}</span>
        <span>BENCH {benchIds.length}</span>
      </div>

      {/* IN players */}
      <div style={{ ...label, padding: "0 16px 6px" }}>AVAILABLE — MARKED IN</div>
      <div style={{ background: "var(--s1)", borderTop: "0.5px solid rgba(255,255,255,0.06)" }}>
        {inPlayers.length === 0
          ? <div style={{ padding: "14px 16px", fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 13, color: "var(--t2)" }}>
              No one's marked in yet.
            </div>
          : inPlayers.map(Row)}
      </div>

      {/* Others (not marked in) */}
      {others.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div onClick={() => setShowOthers(o => !o)} style={{ ...label, padding: "0 16px 6px", cursor: "pointer" }}>
            {showOthers ? "▾" : "▸"} NOT MARKED IN ({others.length})
          </div>
          {showOthers && (
            <div style={{ background: "var(--s1)", borderTop: "0.5px solid rgba(255,255,255,0.06)" }}>
              {others.map(Row)}
            </div>
          )}
        </div>
      )}

      {/* Warnings */}
      {result?.warnings?.length > 0 && (
        <div style={{ margin: "16px", padding: "12px 14px", background: "var(--amber2)",
          border: "0.5px solid var(--amberb)", borderRadius: 10, display: "flex", gap: 8 }}>
          <Warning weight="thin" size={18} color="var(--amber)" />
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "var(--t1)" }}>
            {result.warnings.length} player{result.warnings.length === 1 ? "" : "s"} flagged (suspended or registered to another team). Submitted anyway — review before kickoff.
          </span>
        </div>
      )}

      {/* Submit */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, padding: 16,
        background: "linear-gradient(transparent, var(--bg) 30%)" }}>
        {error && (
          <div onClick={submit} style={{ marginBottom: 8, textAlign: "center", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "var(--red)" }}>
            {error}
          </div>
        )}
        {result?.ok && !error && (
          <div style={{ marginBottom: 8, textAlign: "center", fontFamily: "'DM Sans', sans-serif",
            fontSize: 12, color: "var(--green)", display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
            <Check weight="thin" size={16} color="var(--green)" /> Team sheet submitted
          </div>
        )}
        <button
          onClick={submit}
          disabled={saving || startingIds.length === 0}
          style={{
            width: "100%", padding: "15px 0", borderRadius: 12, border: "none",
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.05em",
            cursor: saving || startingIds.length === 0 ? "not-allowed" : "pointer",
            background: startingIds.length === 0 ? "var(--s3)" : "var(--purple)",
            color: startingIds.length === 0 ? "var(--t2)" : "var(--bg)",
          }}
        >
          {saving ? "SAVING…" : existingLineup ? "UPDATE TEAM SHEET" : "SUBMIT TEAM SHEET"}
        </button>
      </div>
    </div>
  );
}
