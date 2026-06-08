import React, { useEffect, useMemo, useState } from "react";
import { venueListCancellations } from "@platform/core/storage/supabase.js";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { getInitials, poundsFromPence, relativeFrom } from "../lib/format.js";

const DECISION = {
  full: { label: "Full refund", cls: "pill-ok" },
  partial: { label: "50% credit", cls: "pill-warn" },
  none: { label: "No refund", cls: "pill-muted" },
};
const PERIODS = [["7d", "7 days"], ["30d", "30 days"], ["all", "All"]];

// Venue cancellations audit log (mig 222). Read-only history with search,
// period filter, and CSV export. `refreshKey` bumps to reload after a cancel.
export default function CancellationsLog({ venueToken, refreshKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState("30d");

  useEffect(() => {
    let alive = true;
    venueListCancellations(venueToken)
      .then((res) => { if (alive) setRows(Array.isArray(res?.cancellations) ? res.cancellations : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken, refreshKey]);

  const filtered = useMemo(() => {
    let list = rows || [];
    if (period !== "all") {
      const ms = (period === "7d" ? 7 : 30) * 86400000;
      const cut = Date.now() - ms;
      list = list.filter((c) => new Date(c.cancelled_at).getTime() >= cut);
    }
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((c) =>
      [c.team_name, c.booked_by_name, c.pitch_name, c.reason].filter(Boolean).join(" ").toLowerCase().includes(term));
    return list;
  }, [rows, q, period]);

  const exportCsv = () => {
    const cols = ["cancelled_at", "booker", "pitch_name", "booking_date", "kickoff_time", "kind", "reason", "note", "decision", "within_policy", "refund_pence", "charged_pence", "by"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.join(",")];
    filtered.forEach((c) => lines.push(cols.map((k) =>
      esc(k === "booker" ? (c.team_name || c.booked_by_name || "") : c[k])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cancellations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section style={{ marginTop: "var(--gap-3)" }}>
      <SectionHead label="Cancellations" count={rows == null ? "" : filtered.length}>
        <span className="search">
          <span className="ico"><Icon name="search" size={15} /></span>
          <input placeholder="Search booker, pitch, reason…" value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
        <span className="chips">
          {PERIODS.map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={period === v} onClick={() => setPeriod(v)}>{l}</button>
          ))}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={exportCsv} disabled={!filtered.length}>
          <Icon name="copy" size={14} /> Export CSV
        </button>
      </SectionHead>

      {error && <EmptyState title="Couldn’t load cancellations" body={error} />}
      {rows && filtered.length === 0 && !error && (
        <EmptyState title="No cancellations" body={q || period !== "all" ? "Nothing matches the current filter." : "Cancelled bookings will be logged here."} />
      )}

      {filtered.length > 0 && (
        <div className="cancel-list">
          {filtered.map((c) => {
            const dec = DECISION[c.decision] || null;
            const booker = c.team_name || c.booked_by_name || "Walk-in";
            return (
              <div className="cancel-row" key={c.id}>
                <div className="cr-when">
                  <div className="cr-rel">{relativeFrom(c.cancelled_at)}</div>
                  <div className="cr-by text-mute">by {c.by === "team" ? "booker" : "venue"}</div>
                </div>
                <div className="cr-booker">
                  <span className="avatar">{getInitials(booker)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="cr-name">{booker}</div>
                    {c.kind && <div className="cr-org">{c.series_id ? "Weekly block" : "One-off"}</div>}
                  </div>
                </div>
                <div className="cr-when2">
                  <span className="cr-line"><Icon name="pitch" size={12} /> {(c.pitch_name || "").replace(/ \(.*\)/, "")}</span>
                  <span className="cr-line"><Icon name="clock" size={12} /> {c.booking_date || "—"}{c.kickoff_time ? ` · ${String(c.kickoff_time).slice(0, 5)}` : ""}</span>
                </div>
                <div className="cr-reason">
                  <div>{c.reason || "—"}{c.within_policy === false && <span className="pill pill-warn" style={{ marginLeft: 8 }}>short notice</span>}</div>
                  {c.note && <div className="cr-note">“{c.note}”</div>}
                </div>
                <div className="cr-charge">
                  {dec && <span className={"pill " + dec.cls}>{dec.label}</span>}
                  <div className="cr-charge-meta">
                    {c.refund_pence > 0 && <>refund {poundsFromPence(c.refund_pence)}</>}
                    {c.refund_pence > 0 && c.charged_pence > 0 && " · "}
                    {c.charged_pence > 0 && <>charged {poundsFromPence(c.charged_pence)}</>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
