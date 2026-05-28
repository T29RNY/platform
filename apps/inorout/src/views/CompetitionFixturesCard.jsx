import { useState, useEffect } from "react";
import { getPlayerCompetitionFixtures } from "@platform/core";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

// League Mode Phase 5 Cycle 5.3 — read-only competition fixtures on my-view.
// Self-gating: a casual player's token returns no fixtures, so the whole card
// renders null and the casual flow is untouched. Sits directly below
// CompetitionStandingsCard. Rows are not yet tappable — Cycle 5.4 wires the
// inline fixture detail expansion.
export default function CompetitionFixturesCard({ playerToken, currentTeamId }) {
  const [fixtures, setFixtures] = useState([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!playerToken) return;
    getPlayerCompetitionFixtures(playerToken, "all")
      .then(data => setFixtures(data?.fixtures || []))
      .catch(e => { console.error(e); setFixtures([]); });
  }, [playerToken]);

  if (!fixtures.length) return null;

  const PAST_STATUSES = ["completed", "walkover", "forfeit", "void"];
  const upcoming = fixtures.filter(f => f.status === "scheduled");
  const past = fixtures.filter(f => PAST_STATUSES.includes(f.status)).reverse();

  const fmtDate = (iso) => {
    if (!iso) return "Date TBC";
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return "Date TBC";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };
  const fmtTime = (t) => (t ? t.slice(0, 5) : null);

  const resultChip = (result) => {
    if (!result) return null;
    const map = {
      W: { bg: "var(--green2)", fg: "var(--green)" },
      D: { bg: "var(--b2)",     fg: "var(--t2)" },
      L: { bg: "var(--red2)",   fg: "var(--red)" },
    };
    const c = map[result] || map.D;
    return (
      <span style={{
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, lineHeight: 1,
        background: c.bg, color: c.fg, borderRadius: 5,
        padding: "3px 6px", minWidth: 18, textAlign: "center",
      }}>
        {result}
      </span>
    );
  };

  const statusLabel = (status) => {
    if (status === "walkover") return "W/O";
    if (status === "forfeit") return "FF";
    if (status === "void") return "VOID";
    return null;
  };

  const Row = ({ f }) => {
    const isPast = PAST_STATUSES.includes(f.status);
    const time = fmtTime(f.kickoff_time);
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10, padding: "10px 16px",
        borderTop: "0.5px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 13,
            color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {f.is_home ? "vs " : "@ "}{f.opponent_name || "TBC"}
          </div>
          <div style={{
            fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 11,
            color: "var(--t2)", marginTop: 2,
          }}>
            {f.round_name || `Week ${f.week_number}`} · {fmtDate(f.scheduled_date)}
            {time && !isPast ? ` · ${time}` : ""}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {isPast ? (
            <>
              {f.my_score != null && f.opponent_score != null ? (
                <span style={{
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--t1)",
                  letterSpacing: "0.02em",
                }}>
                  {f.my_score}–{f.opponent_score}
                </span>
              ) : (
                <span style={{
                  fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 400,
                  color: "var(--t2)",
                }}>
                  {statusLabel(f.status) || "—"}
                </span>
              )}
              {resultChip(f.result)}
            </>
          ) : (
            <span style={{
              fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 400,
              color: "var(--t2)",
            }}>
              Upcoming
            </span>
          )}
        </div>
      </div>
    );
  };

  const groupHeader = (label) => (
    <div style={{
      padding: "8px 16px 6px", fontFamily: "'Bebas Neue', sans-serif",
      fontSize: 12, color: "var(--t2)", letterSpacing: "0.08em",
      background: "var(--s1)",
    }}>
      {label}
    </div>
  );

  return (
    <div style={{ marginTop: 16 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px", background: "var(--s2)",
          borderRadius: open ? "10px 10px 0 0" : 10,
          border: "0.5px solid rgba(255,255,255,0.08)", cursor: "pointer",
        }}
      >
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 15,
          color: "var(--t2)", letterSpacing: "0.08em",
        }}>
          FIXTURES
        </span>
        {open
          ? <CaretUp   weight="thin" size={16} color="var(--t2)" />
          : <CaretDown weight="thin" size={16} color="var(--t2)" />}
      </div>

      {open && (
        <div style={{
          background: "var(--s1)", border: "0.5px solid rgba(255,255,255,0.08)",
          borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden",
        }}>
          {upcoming.length > 0 && (
            <>
              {groupHeader("UPCOMING")}
              {upcoming.map(f => <Row key={f.fixture_id} f={f} />)}
            </>
          )}
          {past.length > 0 && (
            <>
              {groupHeader("RESULTS")}
              {past.map(f => <Row key={f.fixture_id} f={f} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
