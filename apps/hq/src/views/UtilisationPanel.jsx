import React, { useCallback, useEffect, useMemo, useState } from "react";
import { hqGetUtilisation } from "@platform/core/storage/supabase.js";

// Dedicated utilisation surface (HQ-I Phase 1 Cycle 3) for the Cycle-2
// hq_get_utilisation RPC. Self-loading on companyId, mirroring AnalyticsView.
// Built to apps/hq's existing visual language (.analytics / .acard / .chips /
// .atable / --font-mono numerals); a few novel bits use inline styles.

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const fmt = (n) => (n == null ? "—" : nf.format(n));
const pct = (n) => (n == null ? "—" : `${nf.format(n)}%`);
const hrs = (n) => (n == null ? "—" : `${nf.format(n)}h`);
const peak = (o) => (o && o.pct != null ? `${o.day || o.slot} · ${nf.format(o.pct)}%` : "—");

function Bar({ value }) {
  const w = Math.max(0, Math.min(100, Number(value) || 0));
  const colour = w >= 70 ? "var(--good)" : w >= 40 ? "var(--warn)" : "var(--danger)";
  return (
    <div style={{ height: 4, borderRadius: 999, background: "var(--bg)", overflow: "hidden", marginTop: 6 }} title={pct(value)}>
      <div style={{ height: "100%", width: `${w}%`, background: colour, borderRadius: 999 }} />
    </div>
  );
}

const chip = (n, l, accent) => (
  <div className="chip" key={l}>
    <div className="n" style={accent ? { color: "var(--warn)" } : undefined}>{n ?? "—"}</div>
    <div className="l">{l}</div>
  </div>
);

function PitchRow({ p }) {
  const off = p.prime_source === "not_configured";
  return (
    <tr>
      <td>
        {p.pitch_name}
        {p.assumed_availability && (
          <span className="mono" style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: 11 }} title="No booking hours set — assumed 08:00–22:00 all week">
            (assumed)
          </span>
        )}
      </td>
      <td className="num">{pct(p.overall_pct)}</td>
      <td className="num">{off ? <span className="muted">not set</span> : pct(p.prime_pct)}</td>
      <td className="num">{off ? "—" : pct(p.offpeak_pct)}</td>
      <td className="num">{off ? "—" : hrs(p.empty_prime_hours)}</td>
      <td className="num">{hrs(p.used_hours)}</td>
      <td className="num muted">{fmt(p.source_split?.fixture_hours)}f / {fmt(p.source_split?.booking_hours)}b</td>
    </tr>
  );
}

function VenueRows({ v, open, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>
          <span className="mono" style={{ color: "var(--text-muted)", marginRight: 6 }}>{open ? "▾" : "▸"}</span>
          <b>{v.venue_name}</b>
          {v.region && <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>{v.region}</span>}
        </td>
        <td className="num">{pct(v.overall_pct)}</td>
        <td className="num">{v.prime_configured ? pct(v.prime_pct) : <span className="muted">not set</span>}</td>
        <td className="num">{v.prime_configured ? pct(v.offpeak_pct) : "—"}</td>
        <td className="num" style={{ color: v.prime_configured ? "var(--warn)" : undefined }}>{v.prime_configured ? hrs(v.empty_prime_hours) : "—"}</td>
        <td className="num">{hrs(v.used_hours)}</td>
        <td className="num">{peak(v.best_slot)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ background: "var(--bg)", padding: "0 0 12px 0" }}>
            {v.pitches?.length ? (
              <table className="atable">
                <thead>
                  <tr><th>Pitch</th><th>Overall</th><th>Prime</th><th>Off-peak</th><th>Empty prime</th><th>Used</th><th>Split</th></tr>
                </thead>
                <tbody>{v.pitches.map((p) => <PitchRow key={p.pitch_id} p={p} />)}</tbody>
              </table>
            ) : (
              <div className="empty">No active pitches</div>
            )}
            <div className="muted" style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, fontSize: 12 }}>
              <span>Best day: <b className="mono">{peak(v.best_day)}</b></span>
              <span>Worst day: <b className="mono">{peak(v.worst_day)}</b></span>
              <span>Quietest slot: <b className="mono">{peak(v.worst_slot)}</b></span>
              {v.requested_hours > 0 && <span>Requested (pending): <b className="mono">{hrs(v.requested_hours)}</b></span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function UtilisationPanel({ companyId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState({});

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const d = await hqGetUtilisation(companyId);
      setData(d);
      setErr(null);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setOpen((p) => ({ ...p, [id]: !p[id] }));

  if (err) return <div className="analytics"><div className="error">{err}</div></div>;
  if (!data) return <div className="analytics"><div className="muted">Loading utilisation…</div></div>;

  const c = data.company || {};
  const venues = data.venues || [];
  const range = data.range || {};
  const assumed = data.assumptions?.assumed_pitches || 0;
  const cfg = c.prime_configured;

  return (
    <div className="analytics">
      <div className="panel-title">Utilisation</div>
      <div className="panel-sub mono">{range.from} → {range.to} · {range.days} days</div>

      <div className="acard">
        <div className="chips">
          {chip(pct(c.overall_pct), "Overall used")}
          {chip(cfg ? pct(c.prime_pct) : "—", "Prime used")}
          {chip(cfg ? pct(c.offpeak_pct) : "—", "Off-peak used")}
          {chip(cfg ? hrs(c.empty_prime_hours) : "—", "Empty prime", true)}
          {chip(hrs(c.used_hours), `Used of ${hrs(c.available_hours)}`)}
          {chip(peak(c.best_slot), "Busiest slot")}
          {chip(peak(c.worst_slot), "Quietest slot")}
          {chip(c.requested_hours > 0 ? hrs(c.requested_hours) : "—", "Requested")}
        </div>
        <Bar value={c.overall_pct} />
      </div>

      {!cfg && (
        <div className="acard" style={{ borderLeft: "3px solid var(--accent)" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Prime-time hours aren’t configured for any pitch — the prime / off-peak split is unavailable.
            Set them in each venue’s booking settings to unlock peak-hours intelligence.
          </div>
        </div>
      )}
      {assumed > 0 && (
        <div className="muted" style={{ fontSize: 12, margin: "8px 2px 14px" }}>
          {assumed} pitch{assumed === 1 ? "" : "es"} have no booking hours set — availability assumed at 08:00–22:00 all week.
        </div>
      )}

      <div className="acard">
        <h3>By venue</h3>
        {venues.length ? (
          <table className="atable">
            <thead>
              <tr><th>Venue</th><th>Overall</th><th>Prime</th><th>Off-peak</th><th>Empty prime</th><th>Used</th><th>Busiest slot</th></tr>
            </thead>
            <tbody>
              {venues.map((v) => (
                <VenueRows key={v.venue_id} v={v} open={!!open[v.venue_id]} onToggle={() => toggle(v.venue_id)} />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No venues with measurable utilisation in this range.</div>
        )}
      </div>
    </div>
  );
}
