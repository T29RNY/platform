import { useState } from "react";
import { getFixtureOppositionIntel } from "@platform/core";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

// League Mode Phase 5 Cycle 5.4 — nested opposition-intel block inside the
// fixture detail card. Lazy: nothing is fetched until the section is opened.
// Read-only. H2H + both teams' form + top scorers + last meeting.
const CHIP = {
  W: { bg: "var(--green2)", fg: "var(--green)" },
  D: { bg: "var(--b2)",     fg: "var(--t2)" },
  L: { bg: "var(--red2)",   fg: "var(--red)" },
};

function FormPills({ form }) {
  if (!form || !form.length) {
    return <span style={{ fontSize: 11, fontWeight: 300, color: "var(--t2)", fontFamily: "'DM Sans', sans-serif" }}>No games yet</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {form.map((r, i) => {
        const c = CHIP[r] || CHIP.D;
        return (
          <span key={i} style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, lineHeight: 1,
            background: c.bg, color: c.fg, borderRadius: 4,
            padding: "3px 5px", minWidth: 16, textAlign: "center",
          }}>{r}</span>
        );
      })}
    </span>
  );
}

export default function OppositionIntel({ playerToken, fixtureId }) {
  const [open, setOpen] = useState(false);
  const [intel, setIntel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !intel && !loading) {
      setLoading(true);
      setFailed(false);
      getFixtureOppositionIntel(playerToken, fixtureId)
        .then(d => setIntel(d))
        .catch(e => { console.error(e); setFailed(true); })
        .finally(() => setLoading(false));
    }
  };

  const label = { fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, color: "var(--t2)", letterSpacing: "0.06em" };
  const body = { fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "var(--t1)", fontWeight: 400 };

  const h2hLine = (h) => h && h.p > 0
    ? `${h.p} played · ${h.w}W ${h.d}D ${h.l}L · ${h.gf}-${h.ga}`
    : "No previous meetings";

  return (
    <div style={{ marginTop: 12, borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>
      <div
        onClick={toggle}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 0", cursor: "pointer",
        }}
      >
        <span style={label}>OPPOSITION INTEL</span>
        {open
          ? <CaretUp   weight="thin" size={14} color="var(--t2)" />
          : <CaretDown weight="thin" size={14} color="var(--t2)" />}
      </div>

      {open && (
        <div style={{ paddingBottom: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {loading && <span style={{ ...body, color: "var(--t2)" }}>Loading…</span>}
          {failed && <span style={{ ...body, color: "var(--t2)" }}>Couldn't load intel.</span>}

          {intel && (
            <>
              {/* Form */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>FORM (LAST 5)</span>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={body}>You</span>
                  <FormPills form={intel.my_form} />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={body}>{intel.opponent_name}</span>
                  <FormPills form={intel.opponent_form} />
                </div>
              </div>

              {/* H2H */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={label}>HEAD TO HEAD</span>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ ...body, color: "var(--t2)" }}>This season</span>
                  <span style={body}>{h2hLine(intel.h2h?.this_season)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ ...body, color: "var(--t2)" }}>All time</span>
                  <span style={body}>{h2hLine(intel.h2h?.all_time)}</span>
                </div>
                {intel.last_meeting && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ ...body, color: "var(--t2)" }}>Last meeting</span>
                    <span style={body}>
                      {intel.last_meeting.my_score}-{intel.last_meeting.opponent_score}
                      {intel.last_meeting.scheduled_date ? ` · ${new Date(`${intel.last_meeting.scheduled_date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                    </span>
                  </div>
                )}
              </div>

              {/* Top scorers */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>TOP SCORERS</span>
                <ScorerList title="You" scorers={intel.my_top_scorers} body={body} />
                <ScorerList title={intel.opponent_name} scorers={intel.opponent_top_scorers} body={body} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScorerList({ title, scorers, body }) {
  return (
    <div>
      <div style={{ ...body, color: "var(--t2)", marginBottom: 3 }}>{title}</div>
      {!scorers || !scorers.length ? (
        <div style={{ ...body, fontWeight: 300, color: "var(--t2)" }}>No goals recorded</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {scorers.map(s => (
            <span key={s.player_id || s.name} style={body}>
              {s.name} <span style={{ fontFamily: "'Bebas Neue', sans-serif", color: "var(--gold)" }}>{s.goals}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
