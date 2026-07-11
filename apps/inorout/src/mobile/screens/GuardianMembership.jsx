// GuardianMembership.jsx — Guardian track, screen 3 (mounted at /hub, tab "membership").
//
// Honest build of design_handoff_guardian_app/m-guardian.jsx GuardianMembership
// (MembershipCard + Fees/Pay-now + Extra classes/Book-for-child). Everything reads/writes
// the SAME tables the laptop venue dashboard uses — no parallel system:
//   • Card + plan + fees : get_my_money() (mig 429 adds member_profile_id + class charges),
//                          filtered to the ACTIVE CHILD. Owed fees → "Pay now" mints a
//                          Stripe hosted invoice (stripeInitChargeCheckout) opened in the
//                          system browser; it reconciles via the existing invoice.paid
//                          webhook into venue_payments → desktop finance.
//   • Manage card/cancel : stripeInitBillingPortal (Stripe memberships only).
//   • Extra classes      : guardian_list_child_class_options(child) → book a paid class FOR
//                          the child via guardian_book_class_session (writes venue_class_bookings
//                          + the venue_charges ledger). The resulting fee then appears in
//                          "Fees & payments" with its own Pay now.
//
// Renders inside the scoped [data-surface="mobile"] tree (amber tokens).

import { useState, useEffect, useCallback } from "react";
import {
  getMyMoney, stripeInitBillingPortal,
  guardianListChildClassOptions, guardianBookClassSession,
} from "@platform/core";
import { openExternal } from "../../native/open-external.js";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";
import BookPaySheet from "./BookPaySheet.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const gbp = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;
const hm = (t) => (t ? String(t).slice(0, 5) : ""); // "09:00:00" → "09:00"

function periodLabel(p) {
  return ({ monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", season: "Season" })[p] || (p || "—");
}

function fmtDay(iso) {
  if (!iso) return "TBC";
  const dt = new Date(iso);
  if (isNaN(dt)) return "TBC";
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

function fmtDateTime(iso) {
  if (!iso) return "TBC";
  const dt = new Date(iso);
  if (isNaN(dt)) return "TBC";
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} · ${hh}:${mm}`;
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// Deterministic hue from a name — HSL (not hex) to satisfy the no-hardcoded-hex rule.
function hueFor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function Crest({ name, size = 38, r = 11 }) {
  const hue = hueFor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg, hsl(${hue} 46% 40%) 0 52%, hsl(${hue} 46% 30%) 100%)`,
      color: "white", fontSize: size * 0.36, fontWeight: 800, letterSpacing: "-0.02em",
    }}>{initials(name)}</div>
  );
}

// Deterministic faux-QR (membership identity), 9×9, rgba cells (no hex).
function FauxQR({ seed, size = 50 }) {
  let h = 0; for (let i = 0; i < String(seed).length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const cells = [];
  for (let i = 0; i < 81; i++) { h = (h * 1103515245 + 12345) >>> 0; cells.push((h >>> 16) & 1); }
  return (
    <div style={{
      width: size, height: size, flex: "none", display: "grid",
      gridTemplateColumns: "repeat(9,1fr)", gap: 1, padding: 4, borderRadius: 8,
      background: "rgba(255,255,255,0.92)",
    }}>
      {cells.map((c, i) => <span key={i} style={{ background: c ? "rgba(10,12,16,0.92)" : "transparent", borderRadius: 1 }} />)}
    </div>
  );
}

function friendlyPayError(e) {
  const m = String(e?.message || "");
  if (m.includes("not_configured")) return "Card payments aren't switched on for this club yet.";
  if (m.includes("not_connected")) return "This club hasn't finished its payment setup.";
  return "Couldn't start the payment just now.";
}

// selfMode (Club Console PR #6): the adult member's OWN membership. childId is the
// caller's own member_profiles.id (getMyMoney returns the caller's rows; the class-
// book RPC accepts the self id). childFirst is the member's real first name (shown
// on the card); selfMode switches possessive/voice copy to self.
export default function GuardianMembership({ childId, childFirst, toast, selfMode = false, selfClubId = null }) {
  const [money, setMoney] = useState({ loading: true, error: false, memberships: [], charges: [] });
  const [classes, setClasses] = useState({ loading: true, options: [] });
  const [portalBusy, setPortalBusy] = useState(null);  // membership_id opening portal
  const [sheet, setSheet] = useState(null);            // { opt } for the book sheet
  const [payCtx, setPayCtx] = useState(null);          // book-and-pay sheet (post-booking)
  const [bookBusy, setBookBusy] = useState(false);

  const load = useCallback(async () => {
    if (!childId) { setMoney({ loading: false, error: false, memberships: [], charges: [] }); setClasses({ loading: false, options: [] }); return; }
    setMoney((s) => ({ ...s, loading: true, error: false }));
    try {
      const m = await getMyMoney();
      setMoney({
        loading: false, error: false,
        memberships: (m.memberships || []).filter((x) => x.member_profile_id === childId),
        charges:     (m.charges || []).filter((x) => x.member_profile_id === childId),
      });
    } catch {
      setMoney({ loading: false, error: true, memberships: [], charges: [] });
    }
    setClasses((s) => ({ ...s, loading: true }));
    try {
      const c = await guardianListChildClassOptions(childId);
      // Keep ALREADY-BOOKED options too, so a booked camp/class MIRRORS the Sessions screen
      // (which shows booked camps with a "Booked" state) instead of vanishing here. Bookable
      // ones sort first; booked ones follow (still by start date within each group).
      setClasses({ loading: false, options: (c?.options || []).slice().sort(
        (a, b) => (a.already_booked ? 1 : 0) - (b.already_booked ? 1 : 0)) });
    } catch {
      setClasses({ loading: false, options: [] });
    }
  }, [childId]);

  useEffect(() => { load(); }, [load]);

  // "Pay now" on a pre-existing fee → open the SAME shared BookPaySheet as a book-and-pay
  // booking (card / bank / cash — cash ALWAYS offered), so it never dead-ends when the club's
  // Stripe isn't connected. `stripe_available` + `manual_pay_url` come from get_my_money
  // (mig 546) so the sheet gates card/bank correctly; settle:true switches the banner copy to
  // "Amount outstanding". The sheet handles the actual card/bank/cash paths.
  function payCharge(charge) {
    const remaining = (charge.amount_due_pence || 0) - (charge.paid_pence || 0);
    setPayCtx({
      settle: true,
      class_name: charge.label,
      charge_id: charge.charge_id,
      amount_pence: remaining,
      status: charge.status,
      stripe_available: charge.stripe_available,
      manual_pay_url: charge.manual_pay_url,
    });
  }

  async function openPortal(membershipId) {
    setPortalBusy(membershipId);
    try {
      const { portal_url } = await stripeInitBillingPortal({ membershipId, returnPath: "/hub/membership" });
      if (portal_url) await openExternal(portal_url);
    } catch (e) {
      toast?.({ icon: "alert", tone: "warn", text: "Couldn't open billing", sub: friendlyPayError(e) });
    } finally {
      setPortalBusy(null);
    }
  }

  async function bookClass(opt) {
    setBookBusy(true);
    try {
      const r = await guardianBookClassSession(opt.session_id, { forProfileId: childId });
      if (!r?.ok) {
        const reason = r?.reason || "couldn't_book";
        const msg = reason === "already_booked" ? "Already booked"
          : reason === "suspended" ? "Booking is suspended for missed sessions"
          : "Couldn't book that class";
        toast?.({ icon: "alert", tone: "warn", text: msg });
        setBookBusy(false);
        return;
      }
      // Book-and-pay: the booking is made — now take payment (card / bank / cash) in one shared
      // sheet. Completing payment confirms the spot; no more silent "booked, go pay elsewhere".
      setSheet(null);
      setPayCtx({ ...r, class_name: opt.class_name });
      setBookBusy(false);
      await load();  // the new class fee now shows in Fees & payments too
    } catch (e) {
      const m = String(e?.message || "");
      const sub = m.includes("membership_required") ? "A membership is needed for this class."
        : m.includes("session_not_bookable") ? "This class is no longer open."
        : "Please try again.";
      toast?.({ icon: "alert", tone: "warn", text: "Couldn't book", sub });
      setBookBusy(false);
    }
  }

  const { loading, error, memberships, charges } = money;
  const dueCharges = charges.filter((c) => ["unpaid", "partial"].includes(c.status));
  const outstanding = dueCharges.reduce((a, c) => a + ((c.amount_due_pence || 0) - (c.paid_pence || 0)), 0);
  const childPoss = selfMode ? "Your" : (childFirst ? `${childFirst}'s` : "Your");

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Membership</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading {childPoss.toLowerCase()} membership…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Membership</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load membership right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  return (
    <div>
      <div className="m-eyebrow" style={{ margin: "8px 2px 10px" }}>{childPoss} membership</div>

      {/* membership card(s) — one per club the child is enrolled at */}
      {memberships.length === 0 && (
        <div className="m-card" style={{ padding: "16px 15px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>No membership yet</div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 4, lineHeight: 1.5 }}>
            {selfMode ? "You aren't" : `${childFirst} isn't`} enrolled in a paid membership at the club yet. Any match fees or extras owed will still show below.
          </div>
        </div>
      )}

      {memberships.map((membership, mi) => {
        const hue = hueFor(membership.club_name || childFirst || "club");
        return (
          <div key={membership.membership_id} style={{ marginTop: mi === 0 ? 0 : 12 }}>
            <div style={{
              position: "relative", borderRadius: 18, padding: "16px 17px", color: "white", overflow: "hidden",
              background: `linear-gradient(135deg, hsl(${hue} 44% 34%) 0%, hsl(${hue} 44% 24%) 58%, hsl(${(hue + 28) % 360} 40% 18%) 130%)`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.75 }}>
                    {membership.club_name || "Club"}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, marginTop: 2 }}>{membership.tier_name || "Member"}</div>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 9px", borderRadius: "var(--r-pill)", textTransform: "capitalize", background: "rgba(255,255,255,0.2)" }}>
                  {membership.status === "ending" ? "Ending" : membership.status === "paused" ? "Paused" : "Active"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 20, gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {childFirst || "Member"}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.78, marginTop: 3 }}>
                    {periodLabel(membership.period)} · {gbp(membership.amount_pence)}
                  </div>
                  {membership.renews_at && (
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 1 }}>
                      {membership.status === "ending" ? "Ends" : "Renews"} {fmtDay(membership.renews_at)}
                    </div>
                  )}
                </div>
                <FauxQR seed={(membership.club_name || "") + (childFirst || "")} />
              </div>
            </div>

            {/* manage card / cancel — Stripe memberships only */}
            {membership.is_stripe && membership.status !== "cancelled" && (
              <button onClick={() => openPortal(membership.membership_id)} disabled={portalBusy === membership.membership_id}
                style={{
                  marginTop: 10, width: "100%", padding: "11px 14px", borderRadius: 12, cursor: "pointer",
                  background: "transparent", border: "1px solid var(--hair2)", color: "var(--ink2)",
                  fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13.5,
                }}>
                {portalBusy === membership.membership_id ? "Opening…" : "Manage card / cancel"}
              </button>
            )}
          </div>
        );
      })}

      {/* fees & payments */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "20px 2px 10px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>Fees & payments</h2>
        {outstanding > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: "var(--amber)" }}>{gbp(outstanding)} outstanding</span>}
      </div>

      {charges.length === 0 && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>
          Nothing owed — {childPoss.toLowerCase()} account is all clear.
        </div>
      )}

      {charges.map((c) => {
        const due = ["unpaid", "partial"].includes(c.status);
        const remaining = (c.amount_due_pence || 0) - (c.paid_pence || 0);
        const icon = c.stream === "class" ? "figure" : "card";
        return (
          <div key={c.charge_id} className="m-card" style={{ padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
              background: due ? "var(--amber-soft)" : "var(--s4)",
            }}>
              <MIcon name={icon} size={17} color={due ? "var(--amber)" : "var(--ink2)"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>
                {c.stream === "class" ? "Extra class" : "Membership"}{c.due_date ? ` · due ${fmtDay(c.due_date)}` : ""}
              </div>
              {due && (
                <button onClick={() => payCharge(c)} style={{
                  marginTop: 8, fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
                  fontFamily: "var(--m-font)",
                }}>
                  Pay now →
                </button>
              )}
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{gbp(due ? remaining : c.amount_due_pence)}</div>
              <span style={{
                display: "inline-block", marginTop: 3, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)",
                background: due ? "var(--amber-soft)" : "var(--ok-soft)", color: due ? "var(--amber)" : "var(--ok-ink)",
              }}>{due ? "Due" : "Paid"}</span>
            </div>
          </div>
        );
      })}

      {/* extra classes */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "20px 2px 10px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>Extra classes</h2>
        <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>book for {selfMode ? "you" : childFirst}</span>
      </div>

      {classes.loading && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>Loading classes…</div>
      )}
      {!classes.loading && classes.options.length === 0 && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>
          No extra classes open for booking right now.
        </div>
      )}
      {!classes.loading && classes.options.map((o) => {
        const bookedO = !!o.already_booked; // mirror Sessions: booked ones stay visible, marked "Booked"
        return (
          <button key={o.session_id} onClick={() => setSheet({ opt: o })}
            className="m-card"
            style={{ width: "100%", textAlign: "left", cursor: bookedO ? "default" : "pointer", padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: bookedO ? "var(--ok-soft)" : "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MIcon name={bookedO ? "check" : "figure"} size={19} color={bookedO ? "var(--ok-ink)" : "var(--ink2)"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.class_name}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{fmtDateTime(o.starts_at)}</div>
              <div style={{ fontSize: 11, color: bookedO ? "var(--ok-ink)" : (o.spots_left > 0 ? "var(--ok-ink)" : "var(--ink3)"), fontWeight: 700, marginTop: 3 }}>
                {bookedO ? "Booked — fee in Fees & payments" : (o.spots_left > 0 ? `${o.spots_left} ${o.spots_left === 1 ? "space" : "spaces"} left` : "Waitlist")}
              </div>
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: bookedO ? "var(--ink3)" : "var(--amber)" }}>{gbp(o.price_pence)}</div>
              <span style={{ display: "inline-block", marginTop: 3, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)",
                background: bookedO ? "var(--ok-soft)" : "var(--s3)", color: bookedO ? "var(--ok-ink)" : "var(--ink2)" }}>{bookedO ? "Booked" : "Book"}</span>
            </div>
          </button>
        );
      })}

      {/* book sheet — also re-openable read-only once booked, so camp logistics
          (dietary / pick-up / drop-off / block dates) stay reviewable, matching Sessions. */}
      {sheet?.opt && (
        <MobileSheet
          title={sheet.opt.already_booked ? "Booking" : (sheet.opt.is_camp ? "Book camp" : "Book class")}
          onClose={() => { if (!bookBusy) setSheet(null); }}
          footer={
            sheet.opt.already_booked ? (
              <button onClick={() => setSheet(null)} style={{
                width: "100%", height: 50, borderRadius: 14, border: "none", cursor: "pointer",
                background: "var(--s3)", color: "var(--ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15,
              }}>Done</button>
            ) : (
              <button onClick={() => bookClass(sheet.opt)} disabled={bookBusy} style={{
                width: "100%", height: 50, borderRadius: 14, border: "none", cursor: "pointer",
                background: "var(--amber)", color: "var(--amber-ink)", fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15,
              }}>
                {bookBusy ? "Booking…" : `Book · ${gbp(sheet.opt.price_pence)}`}
              </button>
            )
          }>
          <div className="m-card" style={{ padding: "15px 15px", background: "var(--s2)", marginTop: 4, display: "flex", alignItems: "center", gap: 13 }}>
            <Crest name={sheet.opt.class_name} size={46} r={14} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--ink)" }}>{sheet.opt.class_name}</div>
              <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 2 }}>
                {fmtDateTime(sheet.opt.starts_at)}
                {sheet.opt.booking_mode === "block" && sheet.opt.end_date ? ` – ${fmtDay(sheet.opt.end_date)}` : ""}
              </div>
            </div>
          </div>
          <div className="m-card" style={{ padding: "4px 15px", marginTop: 11, background: "var(--s2)" }}>
            <InfoRow icon="users" k="For" v={selfMode ? "You" : childFirst} />
            <InfoRow icon="pound" k="Price" v={gbp(sheet.opt.price_pence)} />
            {sheet.opt.is_camp && sheet.opt.camp_info && <InfoRow icon="info" k="Info" v={sheet.opt.camp_info} />}
            {sheet.opt.is_camp && sheet.opt.camp_dietary && <InfoRow icon="info" k="Dietary" v={sheet.opt.camp_dietary} />}
            {sheet.opt.is_camp && (sheet.opt.pickup_time || sheet.opt.pickup_location) && (
              <InfoRow icon="pin" k="Pick-up" v={[hm(sheet.opt.pickup_time), sheet.opt.pickup_location].filter(Boolean).join(" · ")} />
            )}
            {sheet.opt.is_camp && (sheet.opt.dropoff_time || sheet.opt.dropoff_location) && (
              <InfoRow icon="pin" k="Drop-off" v={[hm(sheet.opt.dropoff_time), sheet.opt.dropoff_location].filter(Boolean).join(" · ")} />
            )}
            <InfoRow icon="check" k="Availability"
              v={sheet.opt.already_booked ? "Booked" : (sheet.opt.spots_left > 0 ? `${sheet.opt.spots_left} left` : "Waitlist")} last />
          </div>
          {!sheet.opt.already_booked && (
            <div style={{ fontSize: 12.5, color: "var(--ink4)", textAlign: "center", marginTop: 14, lineHeight: 1.5, padding: "0 12px" }}>
              Choose how to pay on the next step — card, bank transfer, or cash at the club.
            </div>
          )}
          {sheet.opt.already_booked && (
            <div style={{ fontSize: 12.5, color: "var(--ink4)", textAlign: "center", marginTop: 14, lineHeight: 1.5, padding: "0 12px" }}>
              Already booked — the fee is in Fees &amp; payments.
            </div>
          )}
        </MobileSheet>
      )}

      {/* book-and-pay: after the booking is made, take payment (card / bank / cash) in one sheet */}
      {payCtx && (
        <BookPaySheet ctx={payCtx} forName={selfMode ? null : childFirst}
          onClose={() => { setPayCtx(null); load(); }} toast={toast} />
      )}

      {/* Player-only path back to the full club view (announcements, shop,
          tournaments) — the /hub member track doesn't carry those yet, so this
          link restores what the removed per-membership switcher rows used to reach.
          Scoped to the CURRENT club entity (selfClubId from the member hat). */}
      {selfMode && selfClubId && (
        <button
          onClick={() => { window.location.href = `/sessions?club=${selfClubId}`; }}
          className="m-card"
          style={{
            width: "100%", textAlign: "left", cursor: "pointer", marginTop: 16,
            padding: "13px 15px", display: "flex", alignItems: "center", gap: 12,
            fontFamily: "var(--m-font)", color: "inherit", borderColor: "var(--hair)",
          }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flex: "none", display: "flex",
            alignItems: "center", justifyContent: "center", background: "var(--s4)",
          }}>
            <MIcon name="shield" size={18} color="var(--ink2)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>Open full club view</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>Announcements, shop &amp; tournaments</div>
          </div>
          <MIcon name="arrow" size={16} color="var(--ink4)" />
        </button>
      )}
    </div>
  );
}

function InfoRow({ icon, k, v, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 11, padding: "11px 0",
      borderBottom: last ? "none" : "1px solid var(--hair)",
    }}>
      <MIcon name={icon} size={16} color="var(--ink3)" />
      <span style={{ flex: 1, fontSize: 13.5, color: "var(--ink3)", fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{v}</span>
    </div>
  );
}
