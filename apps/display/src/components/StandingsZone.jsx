import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { teamColour } from "../lib/format.js";

export default function StandingsZone({ competition, isLive }) {
  if (!competition) return null;
  const confirmed = competition.standings_confirmed || [];
  const live = competition.standings_live || [];
  const rows = isLive && live.length ? live : confirmed;

  // position deltas: where each team sits in confirmed vs the live table shown
  const confirmedPos = new Map(confirmed.map((r, i) => [r.team_id, i]));

  return (
    <div className="zone" style={{ flex: 1 }}>
      <div className="zone-head">
        <span className="zone-title">{competition.name}</span>
        {isLive && live.length ? (
          <span className="zone-tag amber">Provisional</span>
        ) : (
          <span className="zone-tag">Table</span>
        )}
      </div>
      <div className="zone-body">
        <AnimatePresence mode="wait">
          <motion.div
            key={competition.competition_id + (isLive ? "-live" : "-conf")}
            className="tbl"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.4 }}
          >
            <div className="tbl-head">
              <span className="n">#</span>
              <span className="l">Team</span>
              <span className="n">P</span><span className="n">W</span><span className="n">D</span>
              <span className="n">L</span><span className="n">GD</span><span className="n">GF</span>
              <span className="n">Pts</span>
            </div>
            <motion.div layout className="tbl-rows">
              {rows.map((r, i) => {
                const c = teamColour(r.primary_colour, r.team_name);
                const prev = confirmedPos.has(r.team_id) ? confirmedPos.get(r.team_id) : i;
                const delta = prev - i; // +ve = climbed vs confirmed
                const provisional = isLive && live.length && delta !== 0;
                return (
                  <motion.div
                    key={r.team_id}
                    layout
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className={`tbl-row${i < 3 ? " top3" : ""}${provisional ? " provisional" : ""}`}
                  >
                    <span className="pos">{i + 1}</span>
                    <span className="tbl-team">
                      <span className="tbl-chip" style={{ background: c, color: c }} />
                      <span className="tbl-team-name">{r.team_name}</span>
                      {provisional && (
                        <span className={`delta ${delta > 0 ? "up" : "down"}`}>{delta > 0 ? "▲" : "▼"}</span>
                      )}
                    </span>
                    <span className="n">{r.played}</span>
                    <span className="n">{r.w}</span>
                    <span className="n">{r.d}</span>
                    <span className="n">{r.l}</span>
                    <span className="n">{r.gd > 0 ? `+${r.gd}` : r.gd}</span>
                    <span className="n">{r.gf}</span>
                    <span className="pts">{r.pts}</span>
                  </motion.div>
                );
              })}
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
