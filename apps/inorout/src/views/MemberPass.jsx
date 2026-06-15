import React, { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { getMemberPass, memberGetSelf, redeemMemberOffer } from "@platform/core/storage/supabase.js";
import { supabase } from "@platform/core/storage/supabase.js";

// MemberPass — the member-facing PWA pass at /m/<pass_token> (Membership Phase 5,
// mig 272). Public read keyed by the secret token. Shows tier, perks, status,
// renewal, venue brand + a reception check-in code. Wallet (PassKit) + a scannable
// QR image are the next layer; this card is the floor.

const money = (p) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };

const STATUS = {
  active:    { label: "Active",   color: "var(--green)" },
  paused:    { label: "Frozen",   color: "var(--amber)" },
  ending:    { label: "Ending",   color: "var(--amber)" },
  cancelled: { label: "Ended",    color: "var(--t2)" },
};

export default function MemberPass({ token }) {
  const [pass, setPass] = useState(undefined); // undefined=loading, null=not found, obj=ok
  const [isOwner, setIsOwner] = useState(false); // true when logged-in user owns this pass

  useEffect(() => {
    let alive = true;
    getMemberPass(token)
      .then((r) => { if (alive) setPass(r?.ok ? r : null); })
      .catch((e) => { if (alive) { console.error("[memberpass] load failed", e); setPass(null); } });
    return () => { alive = false; };
  }, [token]);

  // Check if the logged-in user is the account-holder for this pass.
  useEffect(() => {
    if (!pass?.member_profile_id) return;
    let alive = true;
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!session?.user || !alive) return;
        return memberGetSelf();
      })
      .then((profile) => {
        if (!alive || !profile?.found) return;
        if (profile.id === pass.member_profile_id) setIsOwner(true);
      })
      .catch((e) => console.error("[memberpass] owner check failed", e));
    return () => { alive = false; };
  }, [pass?.member_profile_id]);

  const wrap = { minHeight: "100vh", background: "var(--bg)", color: "var(--t1)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "var(--font-body)" };

  if (pass === undefined) return <div style={wrap}><p style={{ color: "var(--t2)" }}>Loading your pass…</p></div>;
  if (pass === null) return (
    <div style={wrap}><div style={{ textAlign: "center" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, margin: 0 }}>Pass not found</h1>
      <p style={{ color: "var(--t2)", marginTop: 8 }}>This membership link is invalid or no longer active.</p>
    </div></div>
  );

  const st = STATUS[pass.status] || STATUS.active;
  const accent = pass.primary_colour || "#60A0FF";
  const discount = pass.benefits?.discount_pct;
  const isFree = pass.benefits?.is_free || pass.amount_pence === 0;
  // QR encodes this pass's own URL — reception scans it, parses the token, checks the member in.
  const passUrl = typeof window !== "undefined" ? `${window.location.origin}/m/${token}` : "";

  return (
    <div style={wrap}>
      <div style={{ width: "100%", maxWidth: 420, border: "1px solid var(--border-subtle)", borderRadius: "var(--r)", overflow: "hidden", background: "var(--b2)" }}>
        {/* brand header */}
        <div style={{ background: accent, color: "var(--white)", padding: "18px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          {pass.venue_logo
            ? <img src={pass.venue_logo} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />
            : null}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, opacity: 0.85, letterSpacing: 0.5, textTransform: "uppercase" }}>Membership</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1 }}>{pass.venue_name}</div>
          </div>
          {isOwner && (
            <a href="/profile" style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              background: "rgba(0,0,0,0.25)", color: "var(--white)",
              padding: "4px 10px", borderRadius: 20, textDecoration: "none",
              whiteSpace: "nowrap", flexShrink: 0,
            }}>
              Your account
            </a>
          )}
        </div>

        {/* member + tier */}
        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 30, lineHeight: 1 }}>{[pass.first_name, pass.last_name].filter(Boolean).join(" ")}</div>
              <div style={{ color: "var(--t2)", marginTop: 4 }}>{pass.tier_name}{isFree ? " · Free" : ` · ${pass.period}`}</div>
            </div>
            <span style={{ background: st.color, color: "var(--black)", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: "var(--r-pill)" }}>{st.label}</span>
          </div>

          {/* status detail */}
          <div style={{ marginTop: 16, padding: "12px 14px", border: "1px solid var(--border-subtle)", borderRadius: "var(--r)", display: "flex", justifyContent: "space-between" }}>
            {isFree && pass.status !== "paused" && pass.status !== "ending" ? (
              <><span style={{ color: "var(--t2)" }}>Membership</span><strong>Free membership</strong></>
            ) : (
              <>
                <span style={{ color: "var(--t2)" }}>
                  {pass.status === "paused" ? "Frozen until" : pass.status === "ending" ? "Access until" : "Renews"}
                </span>
                <strong>{fmtDate(pass.status === "paused" ? pass.frozen_until : pass.renews_at)}{isFree ? "" : ` · ${money(pass.amount_pence)}/${pass.period}`}</strong>
              </>
            )}
          </div>

          {/* perks */}
          {discount ? (
            <div style={{ marginTop: 12, color: "var(--t1)" }}>
              <span style={{ color: accent, fontWeight: 700 }}>{discount}% off</span> bookings as a member
            </div>
          ) : null}

          {/* check-in */}
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <div style={{ color: "var(--t2)", fontSize: 12, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Scan at reception to check in</div>
            {passUrl ? (
              <div style={{ display: "inline-block", background: "var(--white)", padding: 14, borderRadius: "var(--r)" }}>
                <QRCode value={passUrl} size={172} level="M" />
              </div>
            ) : null}
            <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 13, letterSpacing: 1, color: "var(--t2)" }}>
              {pass.check_in_code}
            </div>
          </div>

          <PaymentStateBanner state={pass.payment_state} />

          {/* valid venues */}
          {(pass.valid_venues || []).length > 1 ? (
            <ValidVenuesSection venues={pass.valid_venues} />
          ) : (pass.valid_venues || []).length === 1 ? (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--t2)", textAlign: "center" }}>
              Valid at <strong style={{ color: "var(--t1)" }}>{pass.valid_venues[0].venue_name}</strong>
            </div>
          ) : null}

          {/* partner perks */}
          {Array.isArray(pass.offers) && pass.offers.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ color: "var(--t2)", fontSize: 12, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Member perks</div>
              <div style={{ display: "grid", gap: 10 }}>
                {pass.offers.map((o) => <OfferRow key={o.offer_id} offer={o} token={token} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PaymentStateBanner({ state }) {
  if (!state || state === "current") return null;
  const isPastDue = state === "past_due";
  return (
    <div style={{
      margin: "12px 0 0",
      padding: "10px 14px",
      borderRadius: "var(--r)",
      background: isPastDue ? "rgba(255,180,0,0.12)" : "rgba(255,96,96,0.12)",
      border: `1px solid ${isPastDue ? "rgba(255,180,0,0.3)" : "rgba(255,96,96,0.3)"}`,
      color: isPastDue ? "#FFB400" : "#FF6060",
      fontSize: 13,
      lineHeight: 1.4,
    }}>
      {isPastDue
        ? "Payment overdue — your membership will be suspended if not resolved. Please update your payment method with the venue."
        : "Membership suspended due to failed payment. Please contact the venue to reinstate."}
    </div>
  );
}

function ValidVenuesSection({ venues }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginTop: 14, border: "1px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "10px 14px" }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)" }}>Valid at {venues.length} venues</span>
        <span style={{ fontSize: 11, color: "var(--t2)" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          {venues.map((v) => (
            <div key={v.venue_id} style={{ fontSize: 13, color: "var(--t2)", paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
              {v.venue_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OfferRow({ offer, token }) {
  const [revealed, setRevealed] = useState(null); // null | {code}
  const [busy, setBusy] = useState(false);
  const reveal = async () => {
    setBusy(true);
    try { const r = await redeemMemberOffer(token, offer.offer_id); if (r?.ok) setRevealed({ code: r.code }); }
    catch (e) { console.error("[memberpass] redeem failed", e); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "12px 14px" }}>
      <div style={{ fontWeight: 700 }}>{offer.title}</div>
      <div style={{ color: "var(--t2)", fontSize: 13, marginTop: 2 }}>{offer.partner_name}{offer.description ? ` · ${offer.description}` : ""}</div>
      {revealed ? (
        revealed.code
          ? <div style={{ marginTop: 8, fontFamily: "monospace", fontWeight: 700, letterSpacing: 1 }}>{revealed.code}</div>
          : <div style={{ marginTop: 8, color: "var(--green)", fontSize: 13 }}>✓ Just show your pass</div>
      ) : (
        <button onClick={reveal} disabled={busy} style={{ marginTop: 8, background: "transparent", color: "var(--t1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-button)", padding: "6px 12px", fontSize: 13, cursor: "pointer" }}>
          {busy ? "…" : (offer.code ? "Show code" : "Use perk")}
        </button>
      )}
    </div>
  );
}
