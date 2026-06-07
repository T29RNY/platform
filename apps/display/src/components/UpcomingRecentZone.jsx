import React from "react";
import { motion } from "framer-motion";
import Crest from "./Crest.jsx";
import { timeShort } from "../lib/format.js";

// Idle hero (no live games). Three states, richest-first:
//  1. Fixtures today  → big "Next Up" hero card + a list of the rest, recent results.
//  2. No fixtures but a league exists → "League Leaders" podium so the screen still sells.
//  3. Nothing at all → branded venue card with the custom message.
export default function UpcomingRecentZone({ upcoming = [], recent = [], customMessage, leaders = [], venue }) {
  const next = upcoming[0] || null;
  const rest = upcoming.slice(1, 6);
  const hasFixtures = upcoming.length > 0 || recent.length > 0;

  return (
    <div className="zone idle-zone" style={{ flex: 1 }}>
      <div className="zone-head">
        <span className="zone-title">Tonight at the Venue</span>
        <span className="zone-tag">{recent.length} played · {upcoming.length} to come</span>
      </div>

      <div className="zone-body idle-body">
        {next && (
          <motion.div
            className="nextup"
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          >
            <div className="nextup-kicker">⏱ Next Up{next.kickoff_time ? ` · ${timeShort(next.kickoff_time)}` : ""}{next.pitch_name ? ` · ${next.pitch_name}` : ""}</div>
            <div className="nextup-teams">
              <div className="nextup-side">
                <Crest name={next.home_team_name} primary={next.home_primary_colour} size={4} />
                <span className="nextup-name">{next.home_team_name}</span>
              </div>
              <span className="nextup-v">V</span>
              <div className="nextup-side">
                <Crest name={next.away_team_name} primary={next.away_primary_colour} size={4} />
                <span className="nextup-name">{next.away_team_name}</span>
              </div>
            </div>
            <div className="nextup-comp">{next.competition_name}</div>
          </motion.div>
        )}

        {(rest.length > 0 || recent.length > 0) && (
          <div className="idle-cols">
            {rest.length > 0 && (
              <div className="idle-col">
                <div className="hdr-sub">Later Today</div>
                {rest.map((u) => (
                  <div key={u.fixture_id} className="list-fix">
                    <span className="list-time">{timeShort(u.kickoff_time)}</span>
                    <span className="list-teams">
                      <Crest name={u.home_team_name} primary={u.home_primary_colour} size={1.4} />
                      <span className="lf-name">{u.home_team_name}</span>
                      <span className="vs">v</span>
                      <span className="lf-name">{u.away_team_name}</span>
                      <Crest name={u.away_team_name} primary={u.away_primary_colour} size={1.4} />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {recent.length > 0 && (
              <div className="idle-col">
                <div className="hdr-sub">Recent Results</div>
                {recent.slice(0, 6).map((r) => (
                  <div key={r.fixture_id} className="list-fix">
                    <span className="list-teams">
                      <Crest name={r.home_team_name} primary={r.home_primary_colour} size={1.4} />
                      <span className="lf-name">{r.home_team_name}</span>
                      <span className="list-score">{r.home_score}–{r.away_score}</span>
                      <span className="lf-name">{r.away_team_name}</span>
                      <Crest name={r.away_team_name} primary={r.away_primary_colour} size={1.4} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No fixtures today → show league leaders so the screen still has presence */}
        {!hasFixtures && leaders.length > 0 && (
          <div className="leaders">
            <div className="hdr-sub" style={{ marginBottom: "0.8rem" }}>League Leaders</div>
            <div className="leaders-podium">
              {leaders.slice(0, 3).map((t, i) => (
                <motion.div
                  key={t.team_id}
                  className={`podium podium-${i + 1}`}
                  initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                >
                  <div className="podium-rank">{i + 1}</div>
                  <Crest name={t.team_name} primary={t.primary_colour} secondary={t.secondary_colour} size={i === 0 ? 5.5 : 4.2} />
                  <div className="podium-name">{t.team_name}</div>
                  <div className="podium-pts">{t.pts} <small>PTS</small></div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Truly nothing — branded card */}
        {!hasFixtures && leaders.length === 0 && (
          <div className="idle-brand">
            {venue?.logo_url && <img className="idle-brand-logo" src={venue.logo_url} alt="" />}
            <div className="idle-brand-name">{venue?.name || "Reception Display"}</div>
            <div className="idle-brand-msg">{customMessage || "Live scores & league tables on match nights"}</div>
          </div>
        )}
      </div>
    </div>
  );
}
