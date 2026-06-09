import React, { useEffect, useState, useCallback } from "react";
import { superadminHealth } from "@platform/core/storage/supabase.js";

// Squad-health analytics (mig 236 superadmin_health): activation funnel, notification
// reach, install/sign-in health, response/ghost rate. Funnel + reach are current-state;
// install + response use the selected window.

const STAGE_LABELS = ["Created", "Opened a week", "Players responded", "Teams picked", "Result recorded"];

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rangeFor(key) {
  const today = new Date();
  const to = isoDate(today);
  if (key === "today") return { from: to, to };
  const back = new Date(today);
  back.setDate(back.getDate() - (key === "7d" ? 6 : 29));
  return { from: isoDate(back), to };
}
const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

export default function Health() {
  const [rangeKey, setRangeKey] = useState("7d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const { from, to } = rangeFor(rangeKey);
    superadminHealth(from, to)
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, [rangeKey]);

  useEffect(() => { load(); }, [load]);

  const funnel = data?.funnel || {};
  const notif = data?.notification || {};
  const install = data?.install || {};
  const response = data?.response || {};
  const stages = funnel.stages || [];
  const createdCount = stages[0]?.count || 0;

  return (
    <div>
      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>Squad health</h2>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="muted">window:</span>
            {RANGES.map((r) => (
              <button key={r.key} className={rangeKey === r.key ? "primary" : ""} onClick={() => setRangeKey(r.key)}>
                {r.label}
              </button>
            ))}
            <button onClick={load} disabled={loading}>{loading ? "…" : "Refresh"}</button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Funnel &amp; reach are current state; install &amp; response use the window.
        </p>
        {error && <div className="error">{error}</div>}
      </div>

      {/* 1. Activation funnel */}
      {data && (
        <div className="section">
          <h3 style={{ marginTop: 0 }}>Activation funnel</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {stages.map((s, i) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 14px", minWidth: 90 }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{s.count}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{s.label}</div>
                  {i > 0 && (
                    <div className="muted" style={{ fontSize: 11, color: pct(s.count, createdCount) < 50 ? "#b4533a" : undefined }}>
                      {pct(s.count, createdCount)}%
                    </div>
                  )}
                </div>
                {i < stages.length - 1 && <span className="muted">→</span>}
              </div>
            ))}
          </div>
          <table className="data">
            <thead><tr><th>Squad</th><th style={{ width: 90 }}>Age</th><th>Furthest stage</th><th style={{ width: 120 }}>Days to 1st result</th></tr></thead>
            <tbody>
              {(funnel.per_squad || []).map((s) => {
                const stalled = s.stage < 4;
                return (
                  <tr key={s.team_id}>
                    <td>{s.name}</td>
                    <td className="mono muted">{s.days_old}d</td>
                    <td style={stalled ? { color: "#b4533a" } : { color: "#3a8a4a" }}>
                      {STAGE_LABELS[s.stage]}{stalled ? " — stalled" : " ✓"}
                    </td>
                    <td className="mono">{s.days_to_result == null ? "—" : `${s.days_to_result}d`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 2. Notification reach */}
      {data && (
        <div className="section">
          <h3 style={{ marginTop: 0 }}>Notification reach</h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
            <Tile label="Reachable" value={`${notif.reachable_total ?? 0} / ${notif.roster_total ?? 0}`} sub={`${pct(notif.reachable_total, notif.roster_total)}% of rosters`} />
            <Tile label="Push" value={notif.push_total ?? 0} sub={`${pct(notif.push_total, notif.roster_total)}% — best channel`} warn={pct(notif.push_total, notif.roster_total) < 30} />
            <Tile label="Email (account)" value={notif.email_total ?? 0} />
            <Tile label="Phone (SMS)" value={notif.phone_total ?? 0} />
          </div>
          <table className="data">
            <thead><tr><th>Squad</th><th style={{ width: 70 }}>Roster</th><th style={{ width: 70 }}>Push</th><th style={{ width: 70 }}>Email</th><th style={{ width: 70 }}>Phone</th><th style={{ width: 110 }}>Reachable</th></tr></thead>
            <tbody>
              {(notif.per_squad || []).map((s) => (
                <tr key={s.team_id}>
                  <td>{s.name}</td>
                  <td className="mono">{s.roster}</td>
                  <td className="mono" style={s.push === 0 ? { color: "#b4533a" } : undefined}>{s.push}</td>
                  <td className="mono">{s.email}</td>
                  <td className="mono">{s.phone}</td>
                  <td className="mono" style={pct(s.reachable, s.roster) < 80 ? { color: "#b4533a" } : { color: "#3a8a4a" }}>
                    {s.reachable}/{s.roster} ({pct(s.reachable, s.roster)}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Reachable = has push subscription, a phone, or a linked account (email). "Channel preference" is ignored — it defaults to push for everyone and doesn't mean we can actually reach them.
          </p>
        </div>
      )}

      {/* 3. Install & sign-in health */}
      {data && (
        <div className="section">
          <h3 style={{ marginTop: 0 }}>Install &amp; sign-in <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(this window)</span></h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Tile label="App opens" value={install.opens ?? 0} sub={`${install.distinct_users ?? 0} distinct`} />
            <Tile label="Installed PWA" value={install.pwa_installed ?? 0} sub={`${pct(install.pwa_installed, install.opens)}% of opens`} />
            <Tile label="Browser" value={install.browser ?? 0} sub={`${pct(install.browser, install.opens)}% of opens`} />
            <Tile label="Signed in" value={install.signed_in ?? 0} sub={`${pct(install.signed_in, install.opens)}% of opens`} />
          </div>
        </div>
      )}

      {/* 4. Response / ghost rate */}
      {data && (
        <div className="section">
          <h3 style={{ marginTop: 0 }}>Response rate <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(this window)</span></h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
            <Tile label="Responded" value={`${response.responders_total ?? 0} / ${response.roster_total ?? 0}`} sub={`${pct(response.responders_total, response.roster_total)}% of all rostered players`} />
          </div>
          <table className="data">
            <thead><tr><th>Squad</th><th style={{ width: 80 }}>Roster</th><th style={{ width: 90 }}>Responded</th><th style={{ width: 90 }}>Rate</th></tr></thead>
            <tbody>
              {(response.per_squad || []).map((s) => (
                <tr key={s.team_id}>
                  <td>{s.name}</td>
                  <td className="mono">{s.roster}</td>
                  <td className="mono">{s.responders}</td>
                  <td className="mono" style={s.rate == null ? { color: "#6b7280" } : s.rate < 50 ? { color: "#b4533a" } : { color: "#3a8a4a" }}>
                    {s.rate == null ? "—" : `${s.rate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Of each squad's active roster, how many marked in/out in this window. The rest ghosted.
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, warn }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${warn ? "rgba(180,83,58,0.5)" : "rgba(255,255,255,0.08)"}`, borderRadius: 10, padding: "12px 16px", minWidth: 150 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, color: warn ? "#d97a5e" : undefined }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}
