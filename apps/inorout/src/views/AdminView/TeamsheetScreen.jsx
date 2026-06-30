import { useState, useEffect } from "react";
import { CaretLeft, Check, Warning, Prohibit } from "@phosphor-icons/react";
import { submitTeamLineup, checkTeamLineupEligibility } from "@platform/core";

// League Mode Cycle 5.6 — the manager builds the line-up for the next fixture from the
// players who marked themselves IN (the 5.5 board). Players not marked in are shown lower
// down so one can still be pulled in. Submitting writes the line-up (and registers the
// picked players into the competition server-side). League teams field one team v an
// external opponent — there is no casual A/B split here.
//
// Cycle 5.7 — eligibility. A read-only check (team_admin_check_eligibility) badges each
// player and surfaces the league's squad-size bounds; submit is gated client-side and
// enforced authoritatively server-side. Suspended players block submit until the admin
// explicitly overrides each one; double-registered players are a hard block the league
// resolves; squad size must satisfy min starters / max subs.

function fmtDate(d) {
  if (!d) return null;
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "short", day: "numeric", month: "short",
    });
  } catch { return d; }
}

function submitErrorMessage(e) {
  const m = e?.message || e?.details || "";
  if (m.includes("too_few_starters"))         return "Not enough starters for this league's minimum. Add more to the starting XI.";
  if (m.includes("too_many_subs"))            return "Too many subs on the bench for this league. Remove some from the bench.";
  if (m.includes("player_double_registered")) return "A selected player is registered to another team in this competition. Remove them — the league will resolve the clash.";
  if (m.includes("player_ineligible"))        return "A suspended player is selected. Acknowledge the override on their row to proceed.";
  return "Couldn't save the team sheet. Tap to try again.";
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

  // Cycle 5.7 — eligibility: { byId: {playerId: {suspended, double_registered, in_squad, …}},
  // min_starting, max_subs } and the admin's per-player override acknowledgements.
  const [elig, setElig]           = useState(null);
  const [overrides, setOverrides] = useState({});

  const eligible = squad.filter(p => !p.disabled && !p.isGuest);
  const inPlayers = eligible.filter(p => p.status === "in");
  const others    = eligible.filter(p => p.status !== "in");

  // Per-player eligibility is a property of (player, fixture) — independent of who's
  // currently assigned — so one check over the whole candidate pool covers everything.
  useEffect(() => {
    if (!adminToken || !fixture?.id) return;
    let cancelled = false;
    const ids = eligible.map(p => p.id);
    checkTeamLineupEligibility(adminToken, fixture.id, ids)
      .then(data => {
        if (cancelled || !data) return;
        const byId = {};
        (data.players || []).forEach(p => { byId[p.player_id] = p; });
        setElig({ byId, min_starting: data.min_starting, max_subs: data.max_subs });
      })
      .catch(e => console.error("[teamsheet] eligibility check failed", e));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, fixture?.id, squad]);

  const startingIds = Object.keys(assign).filter(id => assign[id] === "start");
  const benchIds    = Object.keys(assign).filter(id => assign[id] === "bench");
  const assignedIds = [...startingIds, ...benchIds];

  const flagOf = (id) => elig?.byId?.[id] || null;
  const blockingDouble   = assignedIds.filter(id => flagOf(id)?.double_registered);
  const assignedSuspended = assignedIds.filter(id => flagOf(id)?.suspended);
  const unackSuspended    = assignedSuspended.filter(id => !overrides[id]);

  const minStart = elig?.min_starting ?? null;
  const maxSubs  = elig?.max_subs ?? null;
  const tooFew  = minStart != null && startingIds.length < minStart;
  const tooMany = maxSubs  != null && benchIds.length    > maxSubs;

  const canSubmit = startingIds.length > 0 && !saving
    && blockingDouble.length === 0 && unackSuspended.length === 0
    && !tooFew && !tooMany;

  const setRole = (id, role) =>
    setAssign(prev => ({ ...prev, [id]: prev[id] === role ? undefined : role }));
  const toggleOverride = (id) =>
    setOverrides(prev => ({ ...prev, [id]: !prev[id] }));

  const opponent = fixture?.opponent_name || "TBC";
  const oppLabel = `${fixture?.is_home ? "vs" : "@"} ${opponent}`;
  const dateLabel = [fmtDate(fixture?.scheduled_date), fixture?.kickoff_time ? fixture.kickoff_time.slice(0, 5) : null,
                     fixture?.playing_area].filter(Boolean).join(" · ");

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true); setError(null); setResult(null);
    const shirtNums = {};
    [...startingIds, ...benchIds].forEach(id => {
      const n = parseInt(shirts[id], 10);
      if (!Number.isNaN(n)) shirtNums[id] = n;
    });
    try {
      const data = await submitTeamLineup(adminToken, fixture.id, {
        starting: startingIds, bench: benchIds, shirt_numbers: shirtNums,
      }, assignedSuspended.filter(id => overrides[id]));
      setResult(data);
      onSubmitted?.();
    } catch (e) {
      console.error("[teamsheet] submit failed", e);
      setError(submitErrorMessage(e));
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
  const pill = (color, bg) => ({
    fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 500,
    padding: "2px 7px", borderRadius: 6, color, background: bg, whiteSpace: "nowrap",
    display: "inline-flex", alignItems: "center", gap: 3, cursor: "default",
  });

  const Row = (p) => {
    const role = assign[p.id];
    const f = flagOf(p.id);
    const isAssigned = role === "start" || role === "bench";
    const double = f?.double_registered;
    const susp   = f?.suspended;
    return (
      <div key={p.id} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
        borderBottom: "0.5px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ flex: 1, minWidth: 0, fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "var(--t1)",
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {p.nickname || p.name}
          {double && (
            <span style={pill("var(--red)", "var(--red2)")}>
              <Prohibit weight="thin" size={12} color="var(--red)" /> AT ANOTHER TEAM
            </span>
          )}
          {susp && !double && (
            isAssigned && overrides[p.id]
              ? <span onClick={() => toggleOverride(p.id)} style={{ ...pill("var(--amber)", "var(--amber2)"), cursor: "pointer" }}>
                  <Check weight="thin" size={12} color="var(--amber)" /> OVERRIDDEN
                </span>
              : <span onClick={() => isAssigned && toggleOverride(p.id)}
                  style={{ ...pill("var(--amber)", "var(--amber2)"), cursor: isAssigned ? "pointer" : "default" }}>
                  <Warning weight="thin" size={12} color="var(--amber)" />
                  {isAssigned ? "SUSPENDED — TAP TO OVERRIDE" : "SUSPENDED"}
                </span>
          )}
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

  // Squad-size hint text, e.g. "STARTING 5 (need ≥5)" / "BENCH 2 (max 3)"
  const startHint = minStart != null ? ` (need ≥${minStart})` : "";
  const benchHint = maxSubs  != null ? ` (max ${maxSubs})`     : "";

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", paddingBottom: 120 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(14px + env(safe-area-inset-top)) 16px 14px" }}>
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
        <span style={{ color: tooFew ? "var(--red)" : "var(--t2)" }}>STARTING {startingIds.length}{startHint}</span>
        <span style={{ color: tooMany ? "var(--red)" : "var(--t2)" }}>BENCH {benchIds.length}{benchHint}</span>
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

      {/* Blocking explainer (double-reg / size) */}
      {(blockingDouble.length > 0 || tooFew || tooMany) && (
        <div style={{ margin: "16px", padding: "12px 14px", background: "var(--red2)",
          border: "0.5px solid var(--redb)", borderRadius: 10, display: "flex", gap: 8 }}>
          <Prohibit weight="thin" size={18} color="var(--red)" />
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "var(--t1)" }}>
            {blockingDouble.length > 0
              ? "A selected player is registered to another team in this competition — the league must resolve it before they can play."
              : tooFew
                ? `You need at least ${minStart} starters for this league.`
                : `This league allows at most ${maxSubs} on the bench.`}
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
          disabled={!canSubmit}
          style={{
            width: "100%", padding: "15px 0", borderRadius: 12, border: "none",
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.05em",
            cursor: !canSubmit ? "not-allowed" : "pointer",
            background: !canSubmit ? "var(--s3)" : "var(--purple)",
            color: !canSubmit ? "var(--t2)" : "var(--bg)",
          }}
        >
          {saving ? "SAVING…" : existingLineup ? "UPDATE TEAM SHEET" : "SUBMIT TEAM SHEET"}
        </button>
      </div>
    </div>
  );
}
