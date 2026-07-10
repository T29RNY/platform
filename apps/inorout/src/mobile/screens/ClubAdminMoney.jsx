// ClubAdminMoney.jsx — Club-admin track, screen ("Money"), mounted at /hub for a
// club_admin role, tab "money". The phone twin of the desktop club lens's
// membership-money glance (apps/venue/src/views/ClubHome.jsx membership card +
// PaymentsView.jsx billing runs), scoped to the ONE club whose shell venue the
// caller owns (Club Console PR #6b, Decision 10).
//
// A read-only billing/membership money glance for a club admin on the move:
// active members + MRR + due-soon, then the collection state (Stripe connect +
// member payment health) and the recent bulk-billing runs. Deep money admin
// (record payment, raise a run, void) stays on the desktop console — this screen
// NEVER writes.
//
// AUTH: a club admin passes their shell venue_id as the credential (role.entityId).
// resolve_venue_caller Stage-1b authenticates them via auth.uid() against
// venue_admins — the same venue-token path the operator track + desktop console
// use. Every read below is a venue-token, VENUE-WIDE read (honestly labelled: the
// figures cover the club's shell venue, not a club sub-scope — mirrors ClubHome's
// "across this venue" caption). clubId is not consumed by these venue-token
// wrappers; it stays in props for shell parity + future club-scoped readers.
//
// Reuses existing venue-token wrappers only (no new backend):
//   • venueMembershipSummary(venueToken)      — wrapper unwraps data.summary →
//       { active, paused, ending, due_soon, mrr_pence } (counts; mrr in pence). mig 273.
//   • venueGetBillingStatus(venueToken)       — raw data →
//       { ok, stripe:{ connected, status, ... }, gocardless:{...},
//         members:{ total, on_stripe, current, past_due, suspended } }. mig 329.
//   • venueListBillingRuns(venueToken, limit)  — raw data; read data.runs →
//       [{ run_id, label, cohort_type, amount_pence, status, member_count,
//          total_pence, collected_pence, created_at, voided_at, due_date }]. mig 405.

import { useState, useEffect, useCallback } from "react";
import { venueMembershipSummary, venueGetBillingStatus, venueListBillingRuns, venueListMembers } from "@platform/core";
import MIcon from "../icons.jsx";
import MemberListSheet from "./MemberListSheet.jsx";

// pence → £ (verbatim port of OperationsTonight.gbp).
function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", {
    minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2,
  });
}

function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const COHORT_LABEL = { tier: "Membership tier", team: "Team", all: "All members", cohort: "Cohort" };

// created_at → "Q3 2026" bucket so recent billing runs group by quarter.
function quarterKey(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "Undated";
  return `Q${Math.floor(dt.getMonth() / 3) + 1} ${dt.getFullYear()}`;
}

export default function ClubAdminMoney({ venueToken, clubId, clubName, toast }) { // eslint-disable-line no-unused-vars
  const [state, setState] = useState({ loading: true, error: false, summary: {}, billing: null, runs: [], members: [] });
  const [drill, setDrill] = useState(null); // { title, members, dateField, dateLabel }

  const load = useCallback(async () => {
    if (!venueToken) { setState({ loading: false, error: false, summary: {}, billing: null, runs: [], members: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      // Membership summary is the primary read (drives the error triad); billing
      // status + runs + members are secondary — a failure there must not blank the glance.
      // members = the SAME venue_list_members the desktop uses; the tile drill-downs
      // filter it client-side to this club (Active / Due soon).
      const [summary, billing, runs, members] = await Promise.all([
        venueMembershipSummary(venueToken),
        venueGetBillingStatus(venueToken).catch(() => null),
        venueListBillingRuns(venueToken, 24).catch(() => null),
        venueListMembers(venueToken).catch(() => []),
      ]);
      setState({
        loading: false, error: false,
        summary: summary || {},
        billing: billing || null,
        runs: Array.isArray(runs?.runs) ? runs.runs : [],
        members: Array.isArray(members) ? members : [],
      });
    } catch {
      setState({ loading: false, error: true, summary: {}, billing: null, runs: [], members: [] });
    }
  }, [venueToken]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, summary, billing, runs, members } = state;

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Club money</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading money for {clubName || "your club"}…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Club money</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load your club's money right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  const active = Number(summary.active) || 0;
  const dueSoon = Number(summary.due_soon) || 0;
  const stripeOn = !!billing?.stripe?.connected;
  const cardMembers = billing?.members || {};
  const pastDue = Number(cardMembers.past_due) || 0;

  // Drill-down buckets. venue_list_members is venue-wide (every club at the shell
  // venue), so scope to THIS club (club_id) first — a club admin should only see
  // their own club's members. The tile numbers stay the desktop's
  // venue_membership_summary counts (venue-scoped), so on a multi-venue club a tile
  // and its drill can differ slightly; each figure is individually honest.
  const clubMembers = members.filter((m) => m.club_id === clubId);
  const activeMembers = clubMembers.filter((m) => String(m.status || "").toLowerCase() === "active");
  const dueSoonMembers = clubMembers.filter((m) => m.due_soon === true);
  const openActive = activeMembers.length ? () => setDrill({ title: "Active members", members: activeMembers }) : undefined;

  // Recent billing runs grouped by quarter (runs arrive created_at DESC, so both
  // the quarter groups and the rows within them stay newest-first).
  const runGroups = [];
  const seenQ = new Map();
  for (const r of runs) {
    const k = quarterKey(r.created_at);
    let g = seenQ.get(k);
    if (!g) { g = { key: k, runs: [] }; seenQ.set(k, g); runGroups.push(g); }
    g.runs.push(r);
  }

  return (
    <div>
      {/* ── stat strip: active members · MRR · due-soon (tap → member list) ── */}
      <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "8px 0 2px", scrollbarWidth: "none" }}>
        <StatTile tone="ink" label="Members" value={active} sub="active" onClick={openActive} />
        <StatTile tone="ok" money label="MRR" value={gbp(summary.mrr_pence)} sub="per month" onClick={openActive} />
        <StatTile tone={dueSoon ? "amber" : "ink"} label="Due soon" value={dueSoon} sub="renew ≤ 7 days"
          onClick={dueSoonMembers.length ? () => setDrill({ title: "Due soon", members: dueSoonMembers, dateField: "renews_at", dateLabel: "renews" }) : undefined} />
      </div>

      {/* ── BILLING ── collection state + recent runs ── */}
      <SecHead title="Billing" meta="this venue" />

      {/* Collection / connect status */}
      <div className="m-card" style={{ padding: "13px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
          background: stripeOn ? "var(--ok-soft)" : "var(--amber-soft)",
        }}><MIcon name="card" size={19} color={stripeOn ? "var(--ok-ink)" : "var(--amber)"} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>Card payments</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {stripeOn
              ? (cardMembers.total
                  ? `${Number(cardMembers.current) || 0} paying · ${pastDue} past due`
                  : "Connected — ready to collect")
              : "Connect online payments on desktop"}
          </div>
        </div>
        <Chip tone={stripeOn ? (pastDue ? "warn" : "ok") : "warn"} icon={stripeOn ? "check" : "alert"}
          text={stripeOn ? "Connected" : "Off"} />
      </div>

      {/* Recent billing runs — grouped by quarter */}
      <div className="m-eyebrow" style={{ margin: "16px 2px 9px" }}>Recent billing runs</div>
      {runs.length === 0 ? (
        <div className="m-card" style={{ padding: "24px 18px", textAlign: "center" }}>
          <MIcon name="pound" size={24} color="var(--ink4)" />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "var(--ink2)" }}>No billing runs yet</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 3 }}>Raise membership charges from the desktop console.</div>
        </div>
      ) : runGroups.map((g) => (
        <div key={g.key}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink3)", margin: "12px 2px 8px", letterSpacing: "0.01em" }}>{g.key}</div>
          {g.runs.map((r) => <RunRow key={r.run_id} r={r} />)}
        </div>
      ))}

      {drill && (
        <MemberListSheet title={drill.title} members={drill.members}
          dateField={drill.dateField} dateLabel={drill.dateLabel}
          emptyText="No members here" onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

// One billing-run card (extracted so the quarter groups can each map their runs).
function RunRow({ r }) {
  const voided = !!r.voided_at || r.status === "voided";
  const title = r.label || COHORT_LABEL[r.cohort_type] || "Billing run";
  const when = fmtDate(r.created_at);
  const collected = Number(r.collected_pence) || 0;
  const total = Number(r.total_pence) || 0;
  return (
    <div className="m-card" style={{ padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12, opacity: voided ? 0.6 : 1 }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--s3)",
      }}><MIcon name="clock" size={17} color="var(--ink2)" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {`${Number(r.member_count) || 0} member${(Number(r.member_count) || 0) === 1 ? "" : "s"}`}
          {when ? ` · ${when}` : ""}
          {r.due_date ? ` · due ${fmtDate(r.due_date)}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", flex: "none" }}>
        {voided ? (
          <Chip tone="muted" text="Voided" />
        ) : (
          <>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{gbp(total)}</div>
            <div style={{ fontSize: 11.5, color: collected >= total && total > 0 ? "var(--ok-ink)" : "var(--ink3)", marginTop: 2, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{gbp(collected)} in</div>
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({ tone, label, value, sub, money, onClick }) {
  const col = tone === "ok" ? "var(--ok-ink)" : tone === "amber" ? "var(--amber)" : "var(--ink)";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} type={onClick ? "button" : undefined} className="m-card" style={{
      flex: "none", width: 122, padding: "13px 13px", display: "flex", flexDirection: "column", gap: 6,
      textAlign: "left", cursor: onClick ? "pointer" : "default", fontFamily: "var(--m-font)", color: "inherit",
    }}>
      <span className="m-eyebrow" style={{ fontSize: 10.5 }}>{label}</span>
      <div style={{ fontSize: money ? 22 : 28, fontWeight: 800, letterSpacing: "-0.03em", color: col, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </Tag>
  );
}

function SecHead({ title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 2px 11px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}

function Chip({ tone, text, icon }) {
  const bg = tone === "ok" ? "var(--ok-soft)" : tone === "warn" ? "var(--amber-soft)" : "var(--s3)";
  const ink = tone === "ok" ? "var(--ok-ink)" : tone === "warn" ? "var(--amber)" : "var(--ink3)";
  return (
    <span style={{
      height: 22, fontSize: 11, padding: "0 9px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 800, flex: "none",
      background: bg, color: ink,
    }}>{icon ? <MIcon name={icon} size={13} color={ink} /> : null}{text}</span>
  );
}
