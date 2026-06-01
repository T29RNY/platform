import React, { useCallback, useEffect, useMemo, useState } from "react";
import { hqGetAnalytics, hqGetUtilisation, hqSetDashboardConfig } from "@platform/core/storage/supabase.js";

const ALL_CARDS = ["overview", "venue_comparison", "top_scorers", "discipline", "incidents", "billing", "utilisation", "revenue"];
const CARD_TITLES = {
  overview: "Overview",
  venue_comparison: "Venue comparison",
  top_scorers: "Top scorers",
  discipline: "Discipline",
  incidents: "Open incidents",
  billing: "Billing",
  utilisation: "Utilisation",
  revenue: "Revenue",
};
const PRESETS = {
  operations: ["overview", "venue_comparison", "incidents"],
  commercial: ["overview", "revenue", "billing", "venue_comparison"],
  performance: ["overview", "top_scorers", "discipline"],
};
const DEFAULT_PRESET = "operations";

export default function AnalyticsView({ companyId }) {
  const [data, setData] = useState(null);
  const [util, setUtil] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const d = await hqGetAnalytics(companyId);
      setData(d);
      setErr(null);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try { const u = await hqGetUtilisation(companyId); if (!cancelled) setUtil(u); }
      catch (e) { console.error("[hq] utilisation load failed", e); }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  // resolve the active layout: saved cards → saved preset → default preset
  const layout = useMemo(() => {
    const cfg = data?.config;
    if (cfg?.cards?.length) return cfg.cards;
    if (cfg?.preset && PRESETS[cfg.preset]) return PRESETS[cfg.preset];
    return PRESETS[DEFAULT_PRESET];
  }, [data]);

  const startEdit = () => { setDraft(layout); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setDraft([]); };
  const applyPreset = (p) => setDraft(PRESETS[p]);
  const toggleCard = (key) =>
    setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  const move = (i, dir) =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await hqSetDashboardConfig(companyId, { preset: null, cards: draft });
      setEditing(false);
      await load();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (err) return <div className="analytics"><div className="error">{err}</div></div>;
  if (!data) return <div className="analytics"><div className="muted">Loading analytics…</div></div>;

  const a = data.analytics || {};
  const cards = editing ? draft : layout;

  return (
    <div className="analytics">
      <div className="edit-bar">
        {!editing && <button onClick={startEdit}>Customise dashboard</button>}
        {editing && (
          <>
            <span className="muted">Preset:</span>
            {Object.keys(PRESETS).map((p) => (
              <button key={p} className="small" onClick={() => applyPreset(p)}>{p}</button>
            ))}
            <span className="muted">· Cards:</span>
            {ALL_CARDS.map((k) => (
              <button
                key={k}
                className={"small" + (draft.includes(k) ? " primary" : "")}
                onClick={() => toggleCard(k)}
              >
                {CARD_TITLES[k]}
              </button>
            ))}
            <span className="spacer" />
            <button className="primary small" onClick={save} disabled={saving}>{saving ? "…" : "Save"}</button>
            <button className="small" onClick={cancelEdit} disabled={saving}>Cancel</button>
          </>
        )}
      </div>

      {cards.length === 0 && <div className="muted">No cards selected. Add some above.</div>}

      {cards.map((key, i) => (
        <div className="acard" key={key}>
          {editing && (
            <div className="card-ctl">
              <button className="small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="small" onClick={() => move(i, 1)} disabled={i === cards.length - 1}>↓</button>
              <button className="small" onClick={() => toggleCard(key)}>Remove</button>
            </div>
          )}
          <h3>{CARD_TITLES[key] || key}</h3>
          <CardBody cardKey={key} a={a} util={util} />
        </div>
      ))}
    </div>
  );
}

function CardBody({ cardKey, a, util }) {
  if (cardKey === "overview") return <Overview o={a.overview || {}} />;
  if (cardKey === "venue_comparison") return <VenueComparison rows={a.venue_comparison || []} />;
  if (cardKey === "top_scorers") return <TopScorers rows={a.top_scorers || []} />;
  if (cardKey === "discipline") return <Discipline rows={a.discipline || []} />;
  if (cardKey === "incidents") return <Incidents i={a.incidents || {}} />;
  if (cardKey === "billing") return <Billing b={a.billing || {}} />;
  if (cardKey === "utilisation") return <UtilCard u={util} />;
  if (cardKey === "revenue") return <Revenue r={a.revenue || {}} />;
  return null;
}

// pence -> £; whole pounds when exact, else 2dp
const gbp = (pence) => {
  if (pence == null) return "—";
  const p = Number(pence) / 100;
  return "£" + (Number.isInteger(p) ? p.toLocaleString() : p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
};
const rate = (n) => (n == null ? "—" : n + "%");

function Revenue({ r }) {
  const rows = r.by_venue || [];
  return (
    <>
      <div className="chips">
        {Chip(gbp(r.owed_pence), "Owed")}
        {Chip(gbp(r.collected_pence), "Collected")}
        {Chip(gbp(r.outstanding_pence), "Outstanding")}
        {Chip(rate(r.collection_rate), "Collection rate")}
      </div>
      {rows.length === 0 ? (
        <div className="empty">No charges in range.</div>
      ) : (
        <table className="atable">
          <thead><tr><th>Venue</th><th>Region</th><th>Owed</th><th>Collected</th><th>Outstanding</th><th>Rate</th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.venue}>
                <td>{v.venue}</td>
                <td className="muted">{v.region || "—"}</td>
                <td className="num">{gbp(v.owed_pence)}</td>
                <td className="num">{gbp(v.collected_pence)}</td>
                <td className="num">{gbp(v.outstanding_pence)}</td>
                <td className="num">{rate(v.collection_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function UtilCard({ u }) {
  if (!u) return <div className="empty">Loading utilisation…</div>;
  const c = u.company || {};
  const cfg = c.prime_configured;
  const p = (n) => (n == null ? "—" : n + "%");
  const peak = (o) => (o && o.pct != null ? `${o.day || o.slot} · ${o.pct}%` : "—");
  return (
    <>
      <div className="chips">
        {Chip(p(c.overall_pct), "Overall used")}
        {Chip(cfg ? p(c.prime_pct) : "—", "Prime")}
        {Chip(cfg ? p(c.offpeak_pct) : "—", "Off-peak")}
        {Chip(cfg ? (c.empty_prime_hours == null ? "—" : c.empty_prime_hours + "h") : "—", "Empty prime")}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Busiest {peak(c.best_slot)} · Quietest {peak(c.worst_slot)}
      </div>
    </>
  );
}

const Chip = (n, l) => (
  <div className="chip" key={l}><div className="n">{n ?? 0}</div><div className="l">{l}</div></div>
);

function Overview({ o }) {
  return (
    <div className="chips">
      {Chip(o.venues, "Venues")}
      {Chip(o.active_leagues, "Leagues")}
      {Chip(o.active_seasons, "Seasons")}
      {Chip(o.registered_teams, "Teams")}
      {Chip(o.fixtures_completed, "Played")}
      {Chip(o.fixtures_remaining, "Remaining")}
      {Chip(o.total_goals, "Goals")}
      {Chip(o.avg_goals_per_game, "Avg/game")}
    </div>
  );
}

function VenueComparison({ rows }) {
  if (!rows.length) return <div className="empty">No venues.</div>;
  return (
    <table className="atable">
      <thead><tr><th>Venue</th><th>Region</th><th>Leagues</th><th>Teams</th><th>Played</th><th>Completion</th><th>Incidents</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.venue}>
            <td>{r.venue}</td>
            <td className="muted">{r.region || "—"}</td>
            <td className="num">{r.leagues}</td>
            <td className="num">{r.teams}</td>
            <td className="num">{r.fixtures_completed}/{r.fixtures_total}</td>
            <td className="num">{r.completion_pct == null ? "—" : r.completion_pct + "%"}</td>
            <td className="num">{r.open_incidents}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TopScorers({ rows }) {
  if (!rows.length) return <div className="empty">No goals recorded yet.</div>;
  return (
    <table className="atable">
      <thead><tr><th className="rank">#</th><th>Player</th><th>Team</th><th>Venue</th><th>Goals</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="rank">{i + 1}</td>
            <td>{r.player}</td>
            <td className="muted">{r.team || "—"}</td>
            <td className="muted">{r.venue || "—"}</td>
            <td className="num">{r.goals}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Discipline({ rows }) {
  if (!rows.length) return <div className="empty">No cards recorded yet.</div>;
  return (
    <table className="atable">
      <thead><tr><th>Player</th><th>Team</th><th>Yellow</th><th>Red</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.player}</td>
            <td className="muted">{r.team || "—"}</td>
            <td className="num">{r.yellows}</td>
            <td className="num">{r.reds}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Incidents({ i }) {
  return (
    <div className="chips">
      {Chip(i.critical, "Critical")}
      {Chip(i.warning, "Warning")}
      {Chip(i.info, "Info")}
    </div>
  );
}

function Billing({ b }) {
  const keys = Object.keys(b || {});
  if (!keys.length) return <div className="empty">No venues.</div>;
  return (
    <div className="chips">
      {keys.map((k) => Chip(b[k], k))}
    </div>
  );
}
