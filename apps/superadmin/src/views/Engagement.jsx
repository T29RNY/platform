import React, { useEffect, useState, useCallback } from "react";
import { superadminEngagement } from "@platform/core/storage/supabase.js";

// Granular engagement analytics (mig 235 superadmin_engagement). Shows what every real
// squad IS and ISN'T doing, by feature category, over a selectable date range. The
// explorable counterpart to the lean ops email digest (mig 234).

// Ordered category columns for the per-squad matrix + the summary list.
const CATEGORY_ORDER = [
  "opens", "availability", "squad_mgmt", "team_selection",
  "match_lifecycle", "results", "potm", "payments", "injuries", "guests", "profile",
];
const CATEGORY_LABELS = {
  opens: "App opens",
  availability: "Availability",
  squad_mgmt: "Squad mgmt",
  team_selection: "Team selection",
  match_lifecycle: "Match lifecycle",
  results: "Scores & results",
  potm: "POTM votes",
  payments: "Payments",
  injuries: "Injuries",
  guests: "Guests",
  profile: "Profile",
};
// Short labels for the matrix header (kept tight).
const CATEGORY_SHORT = {
  opens: "Opens", availability: "In/Out", squad_mgmt: "Squad", team_selection: "Teams",
  match_lifecycle: "Match", results: "Results", potm: "POTM", payments: "Pay",
  injuries: "Injury", guests: "Guests", profile: "Profile",
};
const ACTION_LABELS = {
  app_boot: "app opened",
  player_status_set: "in/out mark (player)",
  player_status_updated: "status change (admin)",
  player_added: "player added",
  player_deleted: "player removed",
  player_disabled: "player disabled",
  player_enabled: "player re-enabled",
  player_priority_updated: "priority changed",
  player_note_updated: "note (admin)",
  player_note_updated_self: "note (self)",
  player_vc_updated: "vice-captain set",
  admin_reorder_reserves: "reserves reordered",
  group_assigned: "group assigned",
  groups_cleared: "groups cleared",
  match_teams_saved: "teams saved",
  match_teams_confirmed: "teams confirmed",
  week_opened: "week opened",
  week_reopened: "week reopened",
  match_cancelled: "match cancelled",
  match_result_saved: "result entered",
  potm_vote_cast_self: "POTM vote",
  potm_voting_closed: "POTM closed",
  player_paid_confirmed: "payment confirmed",
  player_paid_reset: "payment reset",
  player_paid_self_declared: "self-declared paid",
  player_injured_self_set: "injury (self)",
  player_injured_updated: "injury (admin)",
  guest_player_added_self: "guest added",
  guest_player_removed_self: "guest removed",
  player_nickname_updated_self: "nickname set",
  player_joined_team_self: "joined squad",
  push_subscription_registered: "push enabled",
};

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

function lastActiveLabel(d) {
  if (d.days_since == null) return "never";
  if (d.days_since === 0) return "today";
  return `${d.days_since}d ago`;
}

export default function Engagement() {
  const [rangeKey, setRangeKey] = useState("7d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const { from, to } = rangeFor(rangeKey);
    superadminEngagement(from, to)
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, [rangeKey]);

  useEffect(() => { load(); }, [load]);

  const opens = data?.opens || {};
  const ts = data?.team_selection || {};
  const categories = data?.categories || [];
  const perSquad = data?.per_squad || [];
  const catByKey = Object.fromEntries(categories.map((c) => [c.key, c]));

  return (
    <div>
      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Engagement</h2>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="muted">range:</span>
            {RANGES.map((r) => (
              <button
                key={r.key}
                className={rangeKey === r.key ? "primary" : ""}
                onClick={() => setRangeKey(r.key)}
              >
                {r.label}
              </button>
            ))}
            <button onClick={load} disabled={loading}>{loading ? "…" : "Refresh"}</button>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        {data && (
          <>
            {/* Headline tiles */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
              <Tile label="Squads active" value={`${data.squads_active} / ${data.squads_total}`} />
              <Tile label="App opens" value={opens.total ?? 0} sub={`${opens.distinct_users ?? 0} people · ${opens.player ?? 0} player / ${opens.admin ?? 0} admin`} />
              <Tile label="Total actions" value={data.total_events ?? 0} />
              <Tile label="Team selection" value={`${ts.saved ?? 0}`} sub={`${ts.ai ?? 0} AI · ${ts.manual ?? 0} manual`} />
            </div>
          </>
        )}
      </div>

      {/* Category breakdown */}
      {data && (
        <div className="section">
          <h3 style={{ marginTop: 0 }}>By feature</h3>
          <table className="data">
            <thead>
              <tr><th style={{ width: 170 }}>Category</th><th style={{ width: 70 }}>Total</th><th>Breakdown</th></tr>
            </thead>
            <tbody>
              {CATEGORY_ORDER.map((key) => {
                const c = catByKey[key];
                const total = c?.total ?? 0;
                return (
                  <tr key={key} style={total === 0 ? { opacity: 0.45 } : undefined}>
                    <td>{CATEGORY_LABELS[key]}</td>
                    <td className="mono"><b>{total}</b></td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {total === 0
                        ? <span style={{ color: "#b4533a" }}>nobody did this</span>
                        : (c.actions || []).map((a) => `${ACTION_LABELS[a.action] || a.action} ×${a.n}`).join("  ·  ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-squad matrix */}
      {data && (
        <div className="section">
          <h3 style={{ marginTop: 0 }}>By squad</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ minWidth: 150 }}>Squad</th>
                  <th style={{ width: 80 }}>Last active</th>
                  <th style={{ width: 60 }}>Total</th>
                  {CATEGORY_ORDER.map((key) => (
                    <th key={key} style={{ width: 56, textAlign: "right" }} title={CATEGORY_LABELS[key]}>
                      {CATEGORY_SHORT[key]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perSquad.length === 0 && !loading && (
                  <tr><td colSpan={3 + CATEGORY_ORDER.length} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    No squads.
                  </td></tr>
                )}
                {perSquad.map((s) => {
                  const silent = s.days_since == null || s.days_since >= 14;
                  return (
                    <tr key={s.team_id}>
                      <td>{s.name || s.team_id}</td>
                      <td className="mono" style={silent ? { color: "#b4533a" } : { color: "#6b7280" }}>
                        {lastActiveLabel(s)}
                      </td>
                      <td className="mono"><b>{s.total ?? 0}</b></td>
                      {CATEGORY_ORDER.map((key) => {
                        const n = (s.counts && s.counts[key]) || 0;
                        return (
                          <td key={key} className="mono" style={{ textAlign: "right", color: n === 0 ? "#cbd0d6" : undefined }}>
                            {n}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Real squads only (demo/seed excluded). Greyed columns = nobody did that this period.
            Views (results/table screens looked at) aren't tracked yet — only actions taken.
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 16px", minWidth: 150 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}
