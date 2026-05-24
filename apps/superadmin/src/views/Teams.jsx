import React, { useEffect, useState } from "react";
import { superadminListTeams } from "@platform/core/storage/supabase.js";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(n) {
  if (n == null || n === 0) return "—";
  return "£" + Number(n).toFixed(2);
}

export default function Teams({ onOpenTeam }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    superadminListTeams()
      .then((data) => { setTeams(data); setError(null); })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = teams.filter((t) => {
    if (!filter.trim()) return true;
    const f = filter.toLowerCase();
    return (
      (t.name || "").toLowerCase().includes(f) ||
      (t.admin_email || "").toLowerCase().includes(f) ||
      (t.team_id || "").toLowerCase().includes(f) ||
      (t.join_code || "").toLowerCase().includes(f)
    );
  });

  return (
    <div>
      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Teams ({teams.length})</h2>
          <input
            placeholder="Filter by name, email, id, join code…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 320 }}
          />
        </div>

        {error && <div className="error">{error}</div>}
        {loading && <div className="muted">Loading…</div>}

        {!loading && (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Admin</th>
                <th style={{ width: 90, textAlign: "right" }}>Players</th>
                <th style={{ width: 90, textAlign: "right" }}>Admins</th>
                <th style={{ width: 120 }}>Last match</th>
                <th style={{ width: 120, textAlign: "right" }}>Outstanding</th>
                <th style={{ width: 110 }}>Join code</th>
                <th style={{ width: 110 }}>Created</th>
                <th style={{ width: 100 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No teams match the filter.
                </td></tr>
              )}
              {filtered.map((t) => (
                <tr key={t.team_id} className="clickable" onClick={() => onOpenTeam(t.team_id)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <div className="mono muted">{t.team_id}</div>
                  </td>
                  <td>{t.admin_email || <span className="muted">—</span>}</td>
                  <td className="num">{t.player_count}</td>
                  <td className="num">{t.admin_count}</td>
                  <td>{fmtDate(t.last_match_date)}</td>
                  <td className="num">{fmtMoney(t.outstanding_total)}</td>
                  <td className="mono">{t.join_code || <span className="muted">—</span>}</td>
                  <td className="mono">{fmtDate(t.created_at)}</td>
                  <td>
                    {t.onboarding_complete
                      ? <span className="badge good">live</span>
                      : <span className="badge warn">onboarding</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
