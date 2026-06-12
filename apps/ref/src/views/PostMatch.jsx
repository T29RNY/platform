// ============================================================
// PostMatch — read-only full-time report (scorers / cards / subs /
// notes) + share. Ported from the artifact's screens.jsx.
// ============================================================
import React, { useState } from "react";
import { GoalDot, OGDot, CardGlyph, SubGlyph, NoteGlyph, CheckIcon } from "../components/ui.jsx";

export default function PostMatch({ state }) {
  const { fixture, venue, competition, home_team, away_team, home_squad, away_squad, events } = state;
  const nameOf = (id, evt) =>
    [...(home_squad || []), ...(away_squad || [])].find((p) => p.id === id)?.name
    || evt?.player_name_override || id || "—";
  const [copied, setCopied] = useState(false);

  const eyebrow = [venue?.name, competition?.name, fixture.week_number != null ? `Week ${fixture.week_number}` : null].filter(Boolean).join(" · ");
  const goals = events.filter((e) => e.event_type === "goal" || e.event_type === "own_goal").sort((a, b) => a.minute - b.minute);
  const cards = events.filter((e) => e.event_type === "yellow_card" || e.event_type === "red_card").sort((a, b) => a.minute - b.minute);
  const subs = events.filter((e) => e.event_type === "substitution").sort((a, b) => a.minute - b.minute);
  const notes = events.filter((e) => e.event_type === "note").sort((a, b) => a.minute - b.minute);

  const share = async () => {
    const lines = [];
    lines.push(`${home_team.name} ${fixture.home_score}–${fixture.away_score} ${away_team?.name || "Bye"}`);
    if (goals.length) { lines.push(""); goals.forEach((g) => lines.push(`${g.event_type === "own_goal" ? "(OG) " : ""}${nameOf(g.player_id, g)} ${g.minute}'`)); }
    if (cards.length) { lines.push(""); cards.forEach((c) => lines.push(`${c.event_type === "red_card" ? "[R]" : "[Y]"} ${nameOf(c.player_id, c)} ${c.minute}'`)); }
    const text = lines.join("\n");
    try { await navigator.clipboard.writeText(text); } catch { window.prompt("Copy result:", text); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="app">
      <div className="safetop" />
      <div className="scroll">
        <div className="hdr">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>Full time</h1>
          <div className="sub">Final result recorded. This view is read-only.</div>
        </div>

        <div className="card ft-score">
          <div className="ft-team">
            <div className="sw" style={{ background: home_team.primary_colour }} />
            <div className="nm">{home_team.name}</div>
            <div className="ft-num">{fixture.home_score}</div>
          </div>
          <div className="ft-dash">–</div>
          <div className="ft-team">
            <div className="sw" style={{ background: away_team?.primary_colour || "#555" }} />
            <div className="nm">{away_team?.name || "Bye"}</div>
            <div className="ft-num">{fixture.away_score}</div>
          </div>
        </div>

        <div className="report-sec">
          <h4>Scorers</h4>
          <div className="card">
            {goals.length === 0 ? <div className="report-row"><div className="nm" style={{ color: "var(--txt3)" }}>No goals.</div></div>
              : goals.map((g) => {
                const og = g.event_type === "own_goal";
                return (
                  <div className="report-row" key={g.id}>
                    <div className="ico">{og ? <OGDot /> : <GoalDot />}</div>
                    <div className="nm">{nameOf(g.player_id, g)}{og && <span className="og-tag" style={{ marginLeft: 8 }}>OG</span>}</div>
                    <div className="min tabnum">{g.minute}′ · {g.period}</div>
                  </div>
                );
              })}
          </div>
        </div>

        {cards.length > 0 && (
          <div className="report-sec">
            <h4>Cards</h4>
            <div className="card">
              {cards.map((c) => (
                <div className="report-row" key={c.id}>
                  <div className="ico"><CardGlyph red={c.event_type === "red_card"} /></div>
                  <div className="nm">{nameOf(c.player_id, c)}</div>
                  <div className="min tabnum">{c.minute}′ · {c.period}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {subs.length > 0 && (
          <div className="report-sec">
            <h4>Substitutions</h4>
            <div className="card">
              {subs.map((s) => (
                <div className="report-row" key={s.id}>
                  <div className="ico"><SubGlyph /></div>
                  <div className="nm">{nameOf(s.sub_player_on_id, s)} <span style={{ color: "var(--txt3)" }}>on for</span> {nameOf(s.sub_player_off_id, s)}</div>
                  <div className="min tabnum">{s.minute}′ · {s.period}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {notes.length > 0 && (
          <div className="report-sec">
            <h4>Notes &amp; incidents</h4>
            <div className="card">
              {notes.map((n) => (
                <div className="report-row" key={n.id}>
                  <div className="ico"><NoteGlyph s={16} c="var(--blue)" /></div>
                  <div className="nm" style={{ fontStyle: "italic", color: "var(--txt2)" }}>{n.player_id ? <strong style={{ fontStyle: "normal", color: "var(--txt)" }}>{nameOf(n.player_id, n)}: </strong> : null}{n.note_text}</div>
                  <div className="min tabnum">{n.minute}′</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: "20px 16px 4px" }}>
          <button className="btn btn-primary btn-block btn-lg" onClick={share}>
            {copied ? <><CheckIcon c="#04201D" /> Copied!</> : "Share result"}
          </button>
        </div>
        <div className="note">Need a correction? Results are locked for referees — ask the venue admin to amend the record.</div>
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}
