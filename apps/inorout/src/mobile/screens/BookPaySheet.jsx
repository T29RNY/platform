// BookPaySheet — the ONE shared "book-and-pay" surface. Both the Sessions camp/class detail sheet
// (GuardianMatches) and Membership → Extra classes (GuardianMembership) open this the instant a
// booking is made, so the "Book · £X" button takes the family THROUGH payment — completing payment
// IS the booking. Mirrors the existing operator/desktop pay-a-charge model; adds no new payment
// system. The booking's pending venue_charge (created server-side by guardian_book_class_session)
// is settled by whichever method the club actually offers:
//   • Pay by card       — club's Stripe is connected → stripeInitChargeCheckout mints a hosted
//                          invoice (same path as Fees & payments "Pay now").
//   • Bank transfer/link — club's venues.payment_link (server-provided, never client input) →
//                          opened externally. Same link get_my_money coalesces into charge.pay_url.
//   • Cash at the club   — always available (never a dead "payment not set up" wall). The place is
//                          held; the club records the cash with the venue_record_payment they use.
//
// Waitlist / waived / package-paid bookings carry no charge → the sheet just confirms, no pay step.
//
// Renders inside the scoped [data-surface="mobile"] tree (amber tokens).

import { useState } from "react";
import { stripeInitChargeCheckout } from "@platform/core";
import { openExternal } from "../../native/open-external.js";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const gbp = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

function friendlyPayError(e) {
  const m = String(e?.message || "");
  if (m.includes("not_connected") || m.includes("no_account")) return "This club hasn't finished card setup.";
  if (m.includes("checkout_failed")) return "Couldn't start card payment. Try cash at the club.";
  return "Try another method, or settle with the club.";
}

// ctx = the guardian_book_class_session result + display fields:
//   { class_name, status, payment_status, charge_id, amount_pence, stripe_available, manual_pay_url }
// settle:true → the sheet is settling a PRE-EXISTING fee (Membership → Fees "Pay now"), not
// confirming a fresh booking: the confirmation banner reads as an outstanding amount, not "Place booked".
export default function BookPaySheet({ ctx, forName, onClose, toast }) {
  const [busy, setBusy] = useState(null); // 'card' | 'bank' while a redirect is being opened
  if (!ctx) return null;

  const settle = !!ctx.settle;
  const waitlisted = ctx.status === "waitlist";
  const amount = ctx.amount_pence || 0;
  const mustPay = !waitlisted && !!ctx.charge_id && amount > 0;
  const forLabel = forName ? ` for ${forName}` : "";

  async function payCard() {
    setBusy("card");
    try {
      const { pay_url } = await stripeInitChargeCheckout({ chargeId: ctx.charge_id });
      if (pay_url) { await openExternal(pay_url); onClose?.(); }
      else toast?.({ icon: "alert", tone: "warn", text: "Payment unavailable", sub: "No card link returned — try cash at the club." });
    } catch (e) {
      toast?.({ icon: "alert", tone: "warn", text: "Card payment not started", sub: friendlyPayError(e) });
    } finally { setBusy(null); }
  }

  async function payBank() {
    setBusy("bank");
    try {
      await openExternal(ctx.manual_pay_url);
      onClose?.();
    } catch {
      toast?.({ icon: "alert", tone: "warn", text: "Couldn't open link", sub: "Try cash at the club." });
    } finally { setBusy(null); }
  }

  function payCash() {
    toast?.({ icon: "check", tone: "ok", text: settle ? "Noted" : "Booked", sub: `${gbp(amount)} to pay in cash at the club` });
    onClose?.();
  }

  const title = ctx.class_name || (settle ? "Payment" : "Booked");
  const banner = settle ? "amber" : waitlisted ? "amber" : "ok";

  return (
    <MobileSheet title={title} onClose={() => { if (!busy) onClose?.(); }}>
      {/* confirmation / outstanding-amount banner */}
      <div className="m-card" style={{
        padding: "14px 15px", marginTop: 4, display: "flex", alignItems: "center", gap: 12,
        background: banner === "ok" ? "var(--ok-soft)" : "var(--amber-soft)",
        border: `1px solid ${banner === "ok" ? "var(--ok-soft)" : "var(--amber-glow)"}`,
      }}>
        <MIcon name={settle ? "pound" : waitlisted ? "clock" : "check"} size={22} color={banner === "ok" ? "var(--ok-ink)" : "var(--amber)"} style={{ flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: "var(--ink)" }}>
            {settle ? "Amount outstanding" : waitlisted ? "Added to the waitlist" : "Place booked"}{forLabel}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 1 }}>
            {settle
              ? (mustPay ? `${gbp(amount)} to settle.` : "Nothing outstanding — you're all clear.")
              : waitlisted ? "We'll ask for payment if a place opens up."
              : mustPay ? `${gbp(amount)} to pay to confirm the spot.`
              : ctx.payment_status === "waived" ? "Nothing to pay — this session's covered."
              : "Nothing to pay — you're all set."}
          </div>
        </div>
      </div>

      {/* payment methods — only when there's a charge to settle */}
      {mustPay && (
        <>
          <div className="m-eyebrow" style={{ margin: "16px 2px 9px" }}>How would you like to pay?</div>

          {ctx.stripe_available && (
            <PayBtn primary busy={busy === "card"} disabled={!!busy} onClick={payCard}
              icon="card" title="Pay by card" sub="Secure Stripe checkout · pays now" />
          )}

          {ctx.manual_pay_url && (
            <PayBtn busy={busy === "bank"} disabled={!!busy} onClick={payBank}
              icon="globe" title="Bank transfer / pay online" sub="Opens the club's payment page" />
          )}

          <PayBtn disabled={!!busy} onClick={payCash}
            icon="pound" title="Pay cash at the club" sub="Your place is held — pay the club in person" />

          {!settle && (
            <div style={{ fontSize: 11.5, color: "var(--ink4)", textAlign: "center", marginTop: 14, lineHeight: 1.5, padding: "0 10px" }}>
              You can also settle any time from Membership → Fees &amp; payments.
            </div>
          )}
        </>
      )}

      {/* nothing-to-pay / waitlist → single Done affordance */}
      {!mustPay && (
        <button onClick={() => onClose?.()} style={{
          width: "100%", height: 48, marginTop: 16, borderRadius: 14, border: "none", cursor: "pointer",
          background: "var(--s3)", color: "var(--ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15,
        }}>Done</button>
      )}
    </MobileSheet>
  );
}

function PayBtn({ icon, title, sub, onClick, busy, disabled, primary }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", marginBottom: 9, padding: "13px 14px", borderRadius: 14, cursor: disabled ? "default" : "pointer",
      display: "flex", alignItems: "center", gap: 12, textAlign: "left", fontFamily: "var(--m-font)",
      background: primary ? "var(--amber)" : "var(--s2)",
      border: primary ? "none" : "1px solid var(--hair)",
      opacity: disabled && !busy ? 0.5 : 1,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 10, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
        background: primary ? "rgba(0,0,0,0.14)" : "var(--s4)",
      }}>
        <MIcon name={icon} size={17} color={primary ? "var(--amber-ink)" : "var(--ink2)"} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: primary ? "var(--amber-ink)" : "var(--ink)" }}>
          {busy ? "Opening…" : title}
        </div>
        <div style={{ fontSize: 11.5, color: primary ? "var(--amber-ink)" : "var(--ink3)", marginTop: 1, opacity: primary ? 0.8 : 1 }}>{sub}</div>
      </div>
      {!primary && <MIcon name="arrow" size={15} color="var(--ink4)" style={{ flex: "none" }} />}
    </button>
  );
}
