// OperatorTournaments.jsx — Operator track, the tournaments INDEX (Cups).
//
// Lists the venue's tournaments via list_venue_tournaments (mig 439) — operators carry
// a venue_id (role.entityId), resolved by resolve_venue_caller stage-1b like every other
// venue screen. Tapping a tournament opens the amber spectator view (TournamentView) which
// reads the existing get_tournament_public. Reached from operator More → Cups.
//
// Honest scope: monitor/spectate only. Create/manage (the director flow) stays on the
// existing web Sessions screen — it isn't in the mobile design. Sports-day is a separate
// deferred design.

import { useEffect, useState } from "react";
import { listVenueTournaments } from "@platform/core/storage/supabase.js";
import MIcon from "../icons.jsx";

const STATUS = {
  live:      { label: "Live", tone: "live" },
  open:      { label: "Entries open", tone: "ok" },
  closed:    { label: "Entries closed", tone: "mut" },
  completed: { label: "Finished", tone: "mut" },
  draft:     { label: "Draft", tone: "mut" },
};

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return iso; }
}
function dateRange(a, b) {
  if (!a) return "Date TBC";
  if (b && b !== a) return `${fmtDate(a)} – ${fmtDate(b)}`;
  return fmtDate(a);
}

function StatusPill({ status }) {
  const s = STATUS[status] || { label: status, tone: "mut" };
  const map = {
    live: { bg: "var(--live-soft)", fg: "var(--live-ink)" },
    ok:   { bg: "var(--ok-soft)", fg: "var(--ok-ink)" },
    mut:  { bg: "var(--s3)", fg: "var(--ink3)" },
  };
  const c = map[s.tone];
  return (
    <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: "var(--r-pill)", background: c.bg, color: c.fg }}>
      {s.tone === "live" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--live)" }} />}
      {s.label}
    </span>
  );
}

function TournamentCard({ t, onOpen }) {
  const isLive = t.status === "live";
  const meta = [];
  if (t.teams) meta.push(`${t.teams} team${t.teams === 1 ? "" : "s"}`);
  if (isLive && t.live_count) meta.push(`${t.live_count} live now`);
  else if (t.completed_count) meta.push(`${t.completed_count} played`);
  return (
    <button
      onClick={() => onOpen(t.slug, t.tournament_id)}
      className="m-card"
      style={{
        width: "100%", textAlign: "left", cursor: "pointer", padding: "13px 14px", marginBottom: 9,
        display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)", color: "inherit",
        background: isLive ? "var(--amber-soft)" : undefined, borderColor: isLive ? "var(--amber-glow)" : undefined,
      }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 12, flex: "none", background: isLive ? "var(--amber)" : "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <MIcon name="cup" size={21} color={isLive ? "var(--amber-ink)" : "var(--amber)"} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>{dateRange(t.event_date, t.event_end_date)}{meta.length ? " · " + meta.join(" · ") : ""}</div>
      </div>
      <StatusPill status={t.status} />
    </button>
  );
}

export default function OperatorTournaments({ venueId, venueName, onOpenTournament, onBack, toast }) {
  const [state, setState] = useState({ loading: true, error: false, tournaments: [] });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: false, tournaments: [] });
    listVenueTournaments(venueId)
      .then((d) => { if (alive) setState({ loading: false, error: false, tournaments: d?.tournaments ?? [] }); })
      .catch((e) => { console.error("[cups] list_venue_tournaments failed", e); if (alive) setState({ loading: false, error: true, tournaments: [] }); });
    return () => { alive = false; };
  }, [venueId]);

  const { loading, error, tournaments } = state;
  const live = tournaments.filter((t) => t.status === "live");
  const upcoming = tournaments.filter((t) => ["open", "closed", "draft"].includes(t.status));
  const past = tournaments.filter((t) => t.status === "completed");

  const Section = ({ title, items }) => items.length ? (
    <div style={{ marginTop: 16 }}>
      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>{title}</div>
      {items.map((t) => <TournamentCard key={t.tournament_id} t={t} onOpen={onOpenTournament} />)}
    </div>
  ) : null;

  return (
    <div className="m-view-enter">
      {onBack && (
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600, padding: "2px 2px 10px" }}>
          <MIcon name="chevleft" size={16} color="var(--ink3)" /> All views
        </button>
      )}

      {loading && (
        <div className="m-card" style={{ padding: "22px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13.5, color: "var(--ink3)" }}>Loading tournaments…</div>
        </div>
      )}

      {!loading && error && (
        <div className="m-card" style={{ padding: "22px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13.5, color: "var(--ink3)" }}>Couldn't load tournaments. Pull back and try again.</div>
        </div>
      )}

      {!loading && !error && tournaments.length === 0 && (
        <div className="m-card" style={{ padding: "30px 20px", textAlign: "center" }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <MIcon name="cup" size={26} color="var(--amber)" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>No tournaments yet</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 6, lineHeight: 1.45 }}>
            {venueName ? venueName + " hasn't" : "This venue hasn't"} hosted a tournament yet. Set one up from the club dashboard.
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          <Section title="Live now" items={live} />
          <Section title="Upcoming" items={upcoming} />
          <Section title="Finished" items={past} />
        </>
      )}
    </div>
  );
}
