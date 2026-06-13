import React, { useEffect, useMemo, useState } from "react";
import {
  venueListMembers, venueListMembershipTiers, venueListCustomersPeople, venueApproveCustomer,
  venueCreateMembershipTier, venueEnrolMembership, venueFreezeMembership, venueCancelMembership,
  venueCreateCustomer, venueListFeePlans, venueCreateFeePlan, venueEnrolFee, venueCancelFee,
  venueListPartners, venueCreatePartner, venueCreateOffer, venueMembershipSummary,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { poundsRound } from "../lib/format.js";

// Memberships — venue-ops surface for the membership programme (migs 269–271).
// Three sub-tabs: Members (per-person roster + enrol/freeze/cancel), Plans
// (tier config + per-cadence pricing), Fees (team/booker recurring fees).
// All on manual billing — charges land on the venue Payments ledger.

const M_STATUS = {
  active:    { label: "Active",    cls: "pill-ok" },
  paused:    { label: "Frozen",    cls: "pill-info" },
  ending:    { label: "Ending",    cls: "pill-warn" },
  cancelled: { label: "Cancelled", cls: "pill-muted" },
};
const CADENCES = [["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annual", "Annual"]];
const FEE_PERIODS = [["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annual", "Annual"]];

const toPence = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const fullName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim();
const isoPlusDays = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const errLabel = (e) => ({
  already_member: "That person already has a live membership.",
  price_not_set: "No price set for that cadence on this plan.",
  customer_not_found: "Couldn’t find that person.",
  tier_not_found: "Couldn’t find that plan.",
}[e?.message] || "Something went wrong — try again.");

export default function MembershipsView({ venueToken, liveTick = 0 }) {
  const [tab, setTab] = useState("members");
  return (
    <div>
      <SectionHead label="Memberships" count="Recurring members, plans and team fees — billed to the Payments ledger">
        <span className="chips">
          {[["members", "Members"], ["plans", "Plans"], ["fees", "Team fees"], ["perks", "Perks"]].map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={tab === v} onClick={() => setTab(v)}>{l}</button>
          ))}
        </span>
      </SectionHead>
      {tab === "members" && <MembersTab venueToken={venueToken} liveTick={liveTick} />}
      {tab === "plans" && <PlansTab venueToken={venueToken} />}
      {tab === "fees" && <FeesTab venueToken={venueToken} />}
      {tab === "perks" && <PerksTab venueToken={venueToken} />}
    </div>
  );
}

// ── Members ──────────────────────────────────────────────────────────────────
function MembersTab({ venueToken, liveTick = 0 }) {
  const [members, setMembers] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [freezeFor, setFreezeFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [pending, setPending] = useState([]);
  const [approving, setApproving] = useState(null); // person id being acted on
  const [copiedId, setCopiedId] = useState(null);   // membership id whose pass link was just copied

  // The member pass lives on the casual app (in-or-out.com), not the venue console.
  const copyPassLink = async (m) => {
    if (!m.pass_token) return;
    const url = `https://www.in-or-out.com/m/${m.pass_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(m.membership_id);
      setTimeout(() => setCopiedId((c) => (c === m.membership_id ? null : c)), 2000);
    } catch (e) { console.error("[membership] copy pass link failed", e); }
  };

  const loadPending = () => venueListCustomersPeople(venueToken)
    .then((r) => setPending((r || []).filter((p) => p.status === "pending")))
    .catch(() => {});

  const reload = () => {
    venueListMembers(venueToken).then((rows) => setMembers(Array.isArray(rows) ? rows : [])).catch((e) => setError(e?.message || String(e)));
    venueMembershipSummary(venueToken).then(setSummary).catch(() => {});
    loadPending();
  };
  useEffect(() => {
    let a = true;
    venueListMembers(venueToken).then((r) => { if (a) setMembers(r || []); }).catch((e) => { if (a) setError(e?.message || String(e)); });
    venueMembershipSummary(venueToken).then((s) => { if (a) setSummary(s); }).catch(() => {});
    venueListCustomersPeople(venueToken).then((r) => { if (a) setPending((r || []).filter((p) => p.status === "pending")); }).catch(() => {});
    return () => { a = false; };
  }, [venueToken]);

  // Live: a member self-signup / approval broadcast bumps liveTick → re-fetch roster + requests.
  useEffect(() => { if (liveTick > 0) reload(); }, [liveTick]);

  const decide = async (person, approve) => {
    setApproving(person.id);
    try { await venueApproveCustomer(venueToken, person.id, approve); await loadPending(); }
    catch (e) { setError(e?.message || String(e)); }
    finally { setApproving(null); }
  };

  const live = (members || []).filter((m) => m.status !== "cancelled");
  const dueSoon = live.filter((m) => m.due_soon).length;

  return (
    <div>
      {pending.length > 0 && (
        <div className="panel" style={{ marginBottom: "var(--gap-2)", padding: "var(--gap-2)", border: "1px solid var(--accent)", borderRadius: "var(--radius)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span className="pill pill-warn">{pending.length}</span>
            <strong>Membership requests</strong>
            <span className="text-mute" style={{ fontSize: 12 }}>— self-signups from your QR, awaiting approval</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {pending.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cu-name">{fullName(p) || "—"}</div>
                  <div className="cu-sub">{[p.email, p.phone].filter(Boolean).join(" · ") || "No contact given"}</div>
                </div>
                <button className="btn btn-xs btn-ghost" disabled={approving === p.id} onClick={() => decide(p, false)}><Icon name="x" size={13} /> Reject</button>
                <button className="btn btn-xs btn-primary" disabled={approving === p.id} onClick={() => decide(p, true)}><Icon name="check" size={13} /> Approve</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {summary && (
        <div className="customers-grid" style={{ marginBottom: "var(--gap-2)" }}>
          <div className="customer-card"><div className="cu-stat-label">Active members</div><div className="cu-stat-value" style={{ fontSize: 26 }}>{summary.active ?? 0}</div></div>
          <div className="customer-card"><div className="cu-stat-label">Monthly value (MRR)</div><div className="cu-stat-value" style={{ fontSize: 26 }}>{poundsRound(summary.mrr_pence || 0)}</div></div>
          <div className="customer-card"><div className="cu-stat-label">Renewing in 7 days</div><div className="cu-stat-value" style={{ fontSize: 26 }}>{summary.due_soon ?? 0}</div></div>
          <div className="customer-card"><div className="cu-stat-label">Frozen · Cancelled 30d</div><div className="cu-stat-value" style={{ fontSize: 26 }}>{summary.paused ?? 0} · {summary.cancelled_30d ?? 0}</div></div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "var(--gap-2)" }}>
        {dueSoon > 0 && <span className="pill pill-warn">{dueSoon} renewing soon</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setEnrolOpen(true)}><Icon name="plus" size={14} /> Enrol member</button>
      </div>

      {error && <EmptyState title="Couldn’t load members" body={error} />}
      {members && live.length === 0 && !error && (
        <EmptyState title="No members yet" body="Enrol someone onto a plan to start a recurring membership." />
      )}

      {live.length > 0 && (
        <div className="customers-grid">
          {live.map((m) => {
            const st = M_STATUS[m.status] || M_STATUS.active;
            return (
              <div className="customer-card" key={m.membership_id}>
                <div className="cu-top">
                  <div className="cu-head-text">
                    <div className="cu-name">{fullName(m) || "—"}</div>
                    <div className="cu-sub">{m.tier_name} · {m.period}</div>
                  </div>
                  <span className={"pill " + st.cls}>{st.label}</span>
                </div>
                <div className="cu-stats">
                  <div className="cu-stat"><div className="cu-stat-label">Price</div><div className="cu-stat-value">{poundsRound(m.amount_pence)}</div></div>
                  <div className="cu-stat"><div className="cu-stat-label">{m.status === "ending" ? "Ends" : m.status === "paused" ? "Frozen to" : "Renews"}</div>
                    <div className="cu-stat-value" style={m.due_soon ? { color: "var(--live)" } : null}>{m.status === "paused" ? m.frozen_until : m.renews_at}</div></div>
                </div>
                <div className="cu-foot">
                  {m.pass_token && (
                    <button className="btn btn-xs" onClick={() => copyPassLink(m)} title="Copy the member's pass link to share">
                      <Icon name={copiedId === m.membership_id ? "check" : "copy"} size={13} /> {copiedId === m.membership_id ? "Copied" : "Copy link"}
                    </button>
                  )}
                  <span style={{ flex: 1 }} />
                  {m.status === "active" && <button className="btn btn-xs" onClick={() => setFreezeFor(m)}><Icon name="clock" size={13} /> Freeze</button>}
                  {m.status !== "cancelled" && <button className="btn btn-xs" onClick={() => setCancelFor(m)}><Icon name="x" size={13} /> Cancel</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {enrolOpen && <EnrolModal venueToken={venueToken} onClose={() => setEnrolOpen(false)} onDone={() => { setEnrolOpen(false); reload(); }} />}
      {freezeFor && <FreezeModal venueToken={venueToken} member={freezeFor} onClose={() => setFreezeFor(null)} onDone={() => { setFreezeFor(null); reload(); }} />}
      {cancelFor && <CancelModal venueToken={venueToken} member={cancelFor} onClose={() => setCancelFor(null)} onDone={() => { setCancelFor(null); reload(); }} />}
    </div>
  );
}

function EnrolModal({ venueToken, onClose, onDone }) {
  const [people, setPeople] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [newName, setNewName] = useState("");
  const [tierId, setTierId] = useState("");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    venueListCustomersPeople(venueToken).then((r) => setPeople(r || [])).catch(() => {});
    venueListMembershipTiers(venueToken).then((r) => setTiers(r || [])).catch(() => {});
  }, [venueToken]);

  const tier = tiers.find((t) => t.tier_id === tierId);
  const cadences = (tier?.prices || []);
  const priceFor = cadences.find((p) => p.period === period);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      let cid = customerId;
      if (!cid && newName.trim()) {
        const r = await venueCreateCustomer(venueToken, { firstName: newName.trim() });
        cid = r?.customer_id;
      }
      if (!cid) { setError("Pick a person or enter a name."); setBusy(false); return; }
      if (!tierId || !period) { setError("Pick a plan and a cadence."); setBusy(false); return; }
      await venueEnrolMembership(venueToken, cid, tierId, period);
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Enrol member" foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Enrolling…" : priceFor ? `Enrol · ${poundsRound(priceFor.price_pence)}/${period}` : "Enrol"}</button></>
    }>
      <label className="field-label">Person</label>
      <select className="input" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setNewName(""); }}>
        <option value="">— Select existing —</option>
        {people.map((p) => <option key={p.id} value={p.id}>{fullName(p)}{p.email ? ` · ${p.email}` : ""}</option>)}
      </select>
      {!customerId && (
        <>
          <div className="text-mute" style={{ fontSize: 12, margin: "8px 0 4px" }}>…or add a new person</div>
          <input className="input" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </>
      )}
      <label className="field-label" style={{ marginTop: 14 }}>Plan</label>
      <select className="input" value={tierId} onChange={(e) => { setTierId(e.target.value); setPeriod(""); }}>
        <option value="">— Select plan —</option>
        {tiers.map((t) => <option key={t.tier_id} value={t.tier_id}>{t.name}</option>)}
      </select>
      {tier && (
        <>
          <label className="field-label" style={{ marginTop: 14 }}>Cadence</label>
          {cadences.length === 0 ? <p className="text-mute" style={{ fontSize: 12 }}>This plan has no prices set yet — add them under Plans.</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {cadences.map((p) => (
                <button key={p.period} type="button" className="charge-opt" onClick={() => setPeriod(p.period)}
                  style={{ borderColor: period === p.period ? "var(--accent)" : "var(--border)", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, fontSize: 13, textTransform: "capitalize" }}>{p.period}</span>
                  <span>{poundsRound(p.price_pence)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function FreezeModal({ venueToken, member, onClose, onDone }) {
  const [until, setUntil] = useState(isoPlusDays(30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await venueFreezeMembership(venueToken, member.membership_id, until); onDone(); }
    catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Freeze ${fullName(member)}`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Freezing…" : "Freeze"}</button></>
    }>
      <p className="text-mute" style={{ marginBottom: 12 }}>No charges while frozen — the renewal date is pushed out by the freeze length, so the frozen time is never billed.</p>
      <label className="field-label">Frozen until</label>
      <input className="input" type="date" value={until} min={isoPlusDays(1)} onChange={(e) => setUntil(e.target.value)} />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function CancelModal({ venueToken, member, onClose, onDone }) {
  const [immediate, setImmediate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await venueCancelMembership(venueToken, member.membership_id, immediate); onDone(); }
    catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Cancel ${fullName(member)}`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Keep</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Cancelling…" : "Confirm cancel"}</button></>
    }>
      <div style={{ display: "grid", gap: 8 }}>
        <button type="button" className="charge-opt" onClick={() => setImmediate(false)} style={{ borderColor: !immediate ? "var(--accent)" : "var(--border)" }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>End of period</div>
          <div className="text-mute" style={{ fontSize: 12 }}>Access until {member.renews_at}. No further charges.</div>
        </button>
        <button type="button" className="charge-opt" onClick={() => setImmediate(true)} style={{ borderColor: immediate ? "var(--accent)" : "var(--border)" }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Immediately</div>
          <div className="text-mute" style={{ fontSize: 12 }}>Membership ends today.</div>
        </button>
      </div>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// ── Plans (tiers) ────────────────────────────────────────────────────────────
function PlansTab({ venueToken }) {
  const [tiers, setTiers] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const reload = () => venueListMembershipTiers(venueToken).then((r) => setTiers(r || [])).catch((e) => setError(e?.message || String(e)));
  useEffect(() => { let a = true; venueListMembershipTiers(venueToken).then((r) => { if (a) setTiers(r || []); }).catch((e) => { if (a) setError(e?.message || String(e)); }); return () => { a = false; }; }, [venueToken]);

  return (
    <div>
      <div style={{ display: "flex", marginBottom: "var(--gap-2)" }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> New plan</button>
      </div>
      {error && <EmptyState title="Couldn’t load plans" body={error} />}
      {tiers && tiers.length === 0 && !error && <EmptyState title="No plans yet" body="Create a membership plan with monthly, quarterly or annual pricing." />}
      {tiers && tiers.length > 0 && (
        <div className="customers-grid">
          {tiers.map((t) => (
            <div className="customer-card" key={t.tier_id}>
              <div className="cu-top">
                <div className="cu-head-text">
                  <div className="cu-name">{t.name}</div>
                  <div className="cu-sub">{t.benefits?.discount_pct ? `${t.benefits.discount_pct}% booking discount` : "No discount"}</div>
                </div>
                {!t.active && <span className="pill pill-muted">Inactive</span>}
              </div>
              <div className="cu-stats">
                {(t.prices || []).length === 0 ? <span className="text-mute" style={{ fontSize: 12 }}>No prices set</span> :
                  (t.prices || []).map((p) => (
                    <div className="cu-stat" key={p.period}>
                      <div className="cu-stat-label" style={{ textTransform: "capitalize" }}>{p.period}</div>
                      <div className="cu-stat-value">{poundsRound(p.price_pence)}</div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <TierModal venueToken={venueToken} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </div>
  );
}

function TierModal({ venueToken, onClose, onDone }) {
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("");
  const [prices, setPrices] = useState({ monthly: "", quarterly: "", annual: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (!name.trim()) { setError("Give the plan a name."); setBusy(false); return; }
      const priceArr = CADENCES.map(([p]) => [p, toPence(prices[p])]).filter(([, v]) => v != null && v >= 0)
        .map(([period, price_pence]) => ({ period, price_pence }));
      if (priceArr.length === 0) { setError("Set at least one price."); setBusy(false); return; }
      const benefits = {};
      const d = parseInt(discount, 10);
      if (Number.isFinite(d) && d > 0) benefits.discount_pct = d;
      await venueCreateMembershipTier(venueToken, name.trim(), benefits, priceArr);
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="New membership plan" foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Create plan"}</button></>
    }>
      <label className="field-label">Plan name</label>
      <input className="input" placeholder="e.g. Gold" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Booking discount (%) — optional</label>
      <input className="input" type="number" min="0" max="100" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Pricing (£) — set any cadence you offer</label>
      <div style={{ display: "grid", gap: 8 }}>
        {CADENCES.map(([p, l]) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 90, fontSize: 13 }}>{l}</span>
            <input className="input" type="number" min="0" step="0.01" placeholder="—" value={prices[p]}
              onChange={(e) => setPrices((s) => ({ ...s, [p]: e.target.value }))} />
          </div>
        ))}
      </div>
      <p className="text-mute" style={{ fontSize: 12, marginTop: 10 }}>Tip: discount the annual cadence to reward upfront payers.</p>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// ── Fees (team/booker) ───────────────────────────────────────────────────────
function FeesTab({ venueToken }) {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [enrolFor, setEnrolFor] = useState(null);
  const reload = () => venueListFeePlans(venueToken).then((r) => setPlans(r || [])).catch((e) => setError(e?.message || String(e)));
  useEffect(() => { let a = true; venueListFeePlans(venueToken).then((r) => { if (a) setPlans(r || []); }).catch((e) => { if (a) setError(e?.message || String(e)); }); return () => { a = false; }; }, [venueToken]);

  return (
    <div>
      <div style={{ display: "flex", marginBottom: "var(--gap-2)" }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setPlanOpen(true)}><Icon name="plus" size={14} /> New fee plan</button>
      </div>
      {error && <EmptyState title="Couldn’t load fee plans" body={error} />}
      {plans && plans.length === 0 && !error && <EmptyState title="No fee plans yet" body="Create a recurring team/booker fee (e.g. a weekly pitch slot)." />}
      {plans && plans.length > 0 && (
        <div className="customers-grid">
          {plans.map((fp) => (
            <div className="customer-card" key={fp.plan_id}>
              <div className="cu-top">
                <div className="cu-head-text">
                  <div className="cu-name">{fp.name}</div>
                  <div className="cu-sub">{poundsRound(fp.amount_pence)} · {fp.period}{fp.sport ? ` · ${fp.sport}` : ""}</div>
                </div>
                <span className="pill pill-info">{(fp.subscriptions || []).length} active</span>
              </div>
              <div className="cu-foot">
                <span className="text-mute" style={{ fontSize: 12 }}>
                  {(fp.subscriptions || []).slice(0, 3).map((s) => s.member_key).join(", ") || "No subscribers yet"}
                </span>
                <span style={{ flex: 1 }} />
                <button className="btn btn-xs" onClick={() => setEnrolFor(fp)}><Icon name="plus" size={13} /> Enrol</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {planOpen && <FeePlanModal venueToken={venueToken} onClose={() => setPlanOpen(false)} onDone={() => { setPlanOpen(false); reload(); }} />}
      {enrolFor && <FeeEnrolModal venueToken={venueToken} plan={enrolFor} onClose={() => setEnrolFor(null)} onDone={() => { setEnrolFor(null); reload(); }} />}
    </div>
  );
}

function FeePlanModal({ venueToken, onClose, onDone }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("weekly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const pence = toPence(amount);
      if (!name.trim()) { setError("Give the fee a name."); setBusy(false); return; }
      if (pence == null || pence < 0) { setError("Enter a valid amount."); setBusy(false); return; }
      await venueCreateFeePlan(venueToken, name.trim(), pence, period, null);
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="New fee plan" foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Create fee plan"}</button></>
    }>
      <label className="field-label">Name</label>
      <input className="input" placeholder="e.g. Weekly pitch slot" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Amount (£)</label>
      <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Cadence</label>
      <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
        {FEE_PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function FeeEnrolModal({ venueToken, plan, onClose, onDone }) {
  const [memberKey, setMemberKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (!memberKey.trim()) { setError("Enter a team or booker name."); setBusy(false); return; }
      await venueEnrolFee(venueToken, plan.plan_id, memberKey.trim(), null);
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Enrol on ${plan.name}`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Enrolling…" : `Enrol · ${poundsRound(plan.amount_pence)}/${plan.period}`}</button></>
    }>
      <p className="text-mute" style={{ marginBottom: 12 }}>First charge is raised now; the next is auto-raised each {plan.period} onto the Payments ledger.</p>
      <label className="field-label">Team or booker name</label>
      <input className="input" placeholder="e.g. Sunday FC" value={memberKey} onChange={(e) => setMemberKey(e.target.value)} />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// ── Perks (partner offers) ───────────────────────────────────────────────────
function PerksTab({ venueToken }) {
  const [partners, setPartners] = useState(null);
  const [error, setError] = useState(null);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [offerFor, setOfferFor] = useState(null);
  const reload = () => venueListPartners(venueToken).then((r) => setPartners(r || [])).catch((e) => setError(e?.message || String(e)));
  useEffect(() => { let a = true; venueListPartners(venueToken).then((r) => { if (a) setPartners(r || []); }).catch((e) => { if (a) setError(e?.message || String(e)); }); return () => { a = false; }; }, [venueToken]);

  return (
    <div>
      <p className="text-mute" style={{ fontSize: 13, marginBottom: "var(--gap-2)" }}>Local partner offers that show on members’ passes (e.g. the pub). A separate revenue stream from bookings.</p>
      <div style={{ display: "flex", marginBottom: "var(--gap-2)" }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setPartnerOpen(true)}><Icon name="plus" size={14} /> Add partner</button>
      </div>
      {error && <EmptyState title="Couldn’t load partners" body={error} />}
      {partners && partners.length === 0 && !error && <EmptyState title="No partners yet" body="Add a local partner and attach a member offer." />}
      {partners && partners.length > 0 && (
        <div className="customers-grid">
          {partners.map((p) => (
            <div className="customer-card" key={p.partner_id}>
              <div className="cu-top">
                <div className="cu-head-text"><div className="cu-name">{p.name}</div><div className="cu-sub">{p.contact || "Partner"}</div></div>
                <button className="btn btn-xs" onClick={() => setOfferFor(p)}><Icon name="plus" size={13} /> Offer</button>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {(p.offers || []).length === 0 ? <span className="text-mute" style={{ fontSize: 12 }}>No offers yet</span> :
                  (p.offers || []).map((o) => (
                    <div key={o.offer_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, flex: 1 }}>{o.title}{o.code ? ` · ${o.code}` : ""}</span>
                      <span className="pill pill-info">{o.redemptions} used</span>
                      {!o.active && <span className="pill pill-muted">off</span>}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {partnerOpen && <PartnerModal venueToken={venueToken} onClose={() => setPartnerOpen(false)} onDone={() => { setPartnerOpen(false); reload(); }} />}
      {offerFor && <OfferModal venueToken={venueToken} partner={offerFor} onClose={() => setOfferFor(null)} onDone={() => { setOfferFor(null); reload(); }} />}
    </div>
  );
}

function PartnerModal({ venueToken, onClose, onDone }) {
  const [name, setName] = useState(""); const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { if (!name.trim()) { setError("Name the partner."); setBusy(false); return; }
      await venueCreatePartner(venueToken, name.trim(), contact.trim() || null); onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="Add partner" foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Add partner"}</button></>
    }>
      <label className="field-label">Name</label>
      <input className="input" placeholder="e.g. The Crown" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Contact — optional</label>
      <input className="input" placeholder="email or phone" value={contact} onChange={(e) => setContact(e.target.value)} />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function OfferModal({ venueToken, partner, onClose, onDone }) {
  const [title, setTitle] = useState(""); const [desc, setDesc] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { if (!title.trim()) { setError("Give the offer a title."); setBusy(false); return; }
      await venueCreateOffer(venueToken, partner.partner_id, title.trim(), { description: desc.trim() || null, code: code.trim() || null, tierIds: null }); onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Offer at ${partner.name}`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Add offer"}</button></>
    }>
      <label className="field-label">Title</label>
      <input className="input" placeholder="e.g. 10% off food" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Detail — optional</label>
      <input className="input" placeholder="e.g. Sun–Thu, food only" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Code — optional (blank = just show the pass)</label>
      <input className="input" placeholder="e.g. MEMBER10" value={code} onChange={(e) => setCode(e.target.value)} />
      <p className="text-mute" style={{ fontSize: 12, marginTop: 10 }}>Shows on every member’s pass. Redemptions are counted for you.</p>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}
