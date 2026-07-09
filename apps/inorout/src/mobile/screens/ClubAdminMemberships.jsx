// ClubAdminMemberships.jsx — Club-admin track, SECONDARY /hub screen ("Memberships"),
// opened from the club-admin "More" hub (not a primary bottom-nav tab), Club Console PR #6b.
// The phone twin of the desktop club lens's Memberships view
// (apps/venue/src/views/MembershipsView.jsx), scoped to the ONE club whose shell
// venue the caller owns.
//
// A read-only glance: a subscriptions stat strip (active members, monthly recurring
// revenue, renewals due soon, memberships ending) + the club's cohorts list (name +
// age band + active/inactive). Deep membership setup (tiers, cohorts editing, Stripe,
// partner offers) stays on the desktop console — NO writes here.
//
// AUTH: a club admin passes their shell venue_id as the credential (role.entityId).
// resolve_venue_caller authenticates them via auth.uid() against venue_admins — the
// same venue-token path the operator track and desktop console use. clubId scopes the
// cohorts read. No token, no new RPC.
//
// Reuses existing venue-token wrappers only (no new backend), verified against
// packages/core/storage/supabase.js + desktop call sites:
//   • venueMembershipSummary(venueToken)  [supabase.js:4371, MembershipsView.jsx:209]
//       — wrapper unwraps to `data?.summary ?? {}` →
//         { active, paused, ending, due_soon, mrr_pence } (counts; mrr in pence). mig 273.
//   • clubListCohorts(venueToken, clubId, includeInactive=false)  [supabase.js:6104,
//       MembershipsView.jsx:2289] — wrapper returns the raw JSONB ARRAY (not `.cohorts`) →
//       [{ cohort_id, name, description, category, min_age, max_age, active, created_at }]. mig 389.
// NOTE: per-cohort member counts are intentionally NOT shown — venue_list_members
// (mig 410) rows carry club_id/tier_id but NO cohort_id, so the shape can't join a
// member to a cohort. Counts skipped as instructed.

import { useState, useEffect, useCallback } from "react";
import { venueMembershipSummary, clubListCohorts } from "@platform/core";
import MIcon from "../icons.jsx";

// pence → £ (verbatim port of OperationsTonight.gbp / OperatorPayments.gbp).
function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", {
    minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2,
  });
}

const CATEGORY_LABEL = { youth: "Youth", adult: "Adult", mixed: "Mixed" };

// Human age band from min/max (both nullable ints on club_cohorts).
function ageBand(c) {
  const lo = c.min_age, hi = c.max_age;
  if (lo != null && hi != null) return `Ages ${lo}–${hi}`;
  if (lo != null) return `Ages ${lo}+`;
  if (hi != null) return `Up to ${hi}`;
  return "All ages";
}

// Combined sub-line: "Youth · Ages 7–11" (category dropped when absent).
function cohortSub(c) {
  const cat = c.category ? CATEGORY_LABEL[c.category] || c.category : null;
  return [cat, ageBand(c)].filter(Boolean).join(" · ");
}

export default function ClubAdminMemberships({ venueToken, clubId, clubName, toast, onBack }) { // eslint-disable-line no-unused-vars
  const [state, setState] = useState({ loading: true, error: false, summary: {}, cohorts: [] });

  const load = useCallback(async () => {
    if (!venueToken) { setState({ loading: false, error: false, summary: {}, cohorts: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      // Summary is the primary read (drives the error triad); cohorts is a secondary
      // panel — a cohorts failure must not blank the whole glance.
      const [summary, cohorts] = await Promise.all([
        venueMembershipSummary(venueToken),
        clubId ? clubListCohorts(venueToken, clubId, false).catch(() => []) : Promise.resolve([]),
      ]);
      setState({
        loading: false, error: false,
        summary: summary || {},
        cohorts: Array.isArray(cohorts) ? cohorts : [],
      });
    } catch {
      setState({ loading: false, error: true, summary: {}, cohorts: [] });
    }
  }, [venueToken, clubId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, summary, cohorts } = state;

  if (loading) {
    return (
      <div>
        <BackHead onBack={onBack} />
        <div className="m-card" style={{ marginTop: 8 }}>
          <div className="m-eyebrow">Memberships</div>
          <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading {clubName || "your club"}…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <BackHead onBack={onBack} />
        <div className="m-card" style={{ marginTop: 8 }}>
          <div className="m-eyebrow">Memberships</div>
          <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load memberships right now.</p>
          <button onClick={load} style={{
            marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
            background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
          }}>Try again</button>
        </div>
      </div>
    );
  }

  const active = summary?.active ?? 0;
  const dueSoon = summary?.due_soon ?? 0;
  const ending = summary?.ending ?? 0;
  const mrrPence = summary?.mrr_pence ?? 0;

  return (
    <div>
      <BackHead onBack={onBack} />

      {/* ── subscriptions stat strip ── */}
      <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "8px 0 2px", scrollbarWidth: "none" }}>
        <StatTile tone="ink" label="Active" value={active} sub="members" />
        <StatTile tone="ink" label="MRR" value={gbp(mrrPence)} sub="per month" />
        <StatTile tone={dueSoon ? "amber" : "ink"} label="Due soon" value={dueSoon} sub="renew ≤ 7d" />
        <StatTile tone={ending ? "amber" : "ink"} label="Ending" value={ending} sub="not renewing" />
      </div>

      {/* ── cohorts ── */}
      <SecHead title="Cohorts" meta={cohorts.length ? `${cohorts.length}` : ""} />
      {cohorts.length === 0 ? (
        <div className="m-card" style={{ padding: "26px 18px", textAlign: "center" }}>
          <MIcon name="users" size={24} color="var(--ink4)" />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "var(--ink2)" }}>
            No cohorts yet — add them on the desktop console
          </div>
        </div>
      ) : cohorts.map((c) => (
        <div key={c.cohort_id} className="m-card" style={{ padding: "13px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12, opacity: c.active === false ? 0.62 : 1 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--s3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><MIcon name="users" size={19} color="var(--ink2)" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name || "Cohort"}</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {cohortSub(c)}
            </div>
          </div>
          <ActiveChip active={c.active !== false} />
        </div>
      ))}
    </div>
  );
}

function BackHead({ onBack }) {
  return (
    <button onClick={onBack} style={{
      display: "flex", alignItems: "center", gap: 6, background: "none", border: 0,
      color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, cursor: "pointer", marginBottom: 4, padding: 0,
    }}>
      <MIcon name="chevleft" size={16} color="var(--ink3)" /> Back
    </button>
  );
}

function StatTile({ tone, label, value, sub }) {
  const col = tone === "live" ? "var(--live)" : tone === "amber" ? "var(--amber)" : "var(--ink)";
  return (
    <div className="m-card" style={{ flex: "none", width: 122, padding: "13px 13px", display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="m-eyebrow" style={{ fontSize: 10.5 }}>{label}</span>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: col, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </div>
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

function ActiveChip({ active }) {
  const bg = active ? "var(--ok-soft)" : "var(--s3)";
  const ink = active ? "var(--ok-ink)" : "var(--ink3)";
  return (
    <span style={{
      height: 21, fontSize: 11, padding: "0 8px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", fontWeight: 700, flex: "none",
      background: bg, color: ink,
    }}>{active ? "Active" : "Inactive"}</span>
  );
}
