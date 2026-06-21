import React, { useEffect, useState, useRef } from "react";
import QRCode from "react-qr-code";
import {
  getMemberPass, memberGetSelf, redeemMemberOffer,
  memberListMyClassBookings, memberCancelClassBooking, memberClaimWaitlistSpot,
  memberGetPackageBalance, memberListMyRoomHires,
} from "@platform/core/storage/supabase.js";
import { supabase } from "@platform/core/storage/supabase.js";
import ClubNavBar from "../components/ui/ClubNavBar.jsx";
import Tour from "../components/Tour.jsx";
import { clubToursEnabled } from "../lib/tourRegistry.js";
import { getDisciplineLabels } from "../lib/disciplineLabels.js";

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
  const labels = getDisciplineLabels(pass.discipline);
  const grades = labels.hasGrading ? (pass.grades || []) : [];
  const discount = pass.benefits?.discount_pct;
  const isFree = pass.benefits?.is_free || pass.amount_pence === 0;
  // QR encodes this pass's own URL — reception scans it, parses the token, checks the member in.
  const passUrl = typeof window !== "undefined" ? `${window.location.origin}/m/${token}` : "";

  // Only the account-holder gets the club nav bar — a reception scan / shared-link
  // view (non-owner) shows the pass alone, no member navigation. When present, the
  // fixed bar needs bottom clearance so the card never sits behind it.
  const ownerWrap = isOwner
    ? { ...wrap, paddingBottom: "calc(80px + env(safe-area-inset-bottom,0))" }
    : wrap;

  return (
    <div style={ownerWrap}>
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
        <div data-tour="membership-perks" style={{ padding: 20 }}>
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
                  {pass.status === "paused"
                    ? (pass.frozen_until ? "Frozen until" : "Frozen")
                    : pass.status === "ending" ? "Access until" : "Renews"}
                </span>
                <strong>{(() => {
                  // A paused pass often has no freeze end date (indefinite hold); show
                  // no date rather than fmtDate(null) → the 1 Jan 1970 epoch.
                  const dateVal = pass.status === "paused" ? pass.frozen_until : pass.renews_at;
                  const datePart = dateVal ? fmtDate(dateVal) : "";
                  const pricePart = isFree ? "" : `${datePart ? " · " : ""}${money(pass.amount_pence)}/${pass.period}`;
                  return `${datePart}${pricePart}` || "—";
                })()}</strong>
              </>
            )}
          </div>

          {/* current grade / belt (martial-arts clubs only) */}
          {grades.length > 0 && (
            <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
              {grades.map((g) => (
                <div key={g.scheme_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid var(--border-subtle)", borderRadius: "var(--r)" }}>
                  <span style={{ width: 22, height: 22, borderRadius: 5, background: g.colour_hex || "var(--t2)", border: "1px solid var(--border-subtle)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "var(--t2)", textTransform: "uppercase", letterSpacing: 0.4 }}>{labels.rankWord || "Grade"}{g.age_band && g.age_band !== "all" ? ` · ${g.age_band}` : ""}</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 20, lineHeight: 1.1 }}>
                      {g.grade_name}{g.stripes > 0 ? ` · ${g.stripes} stripe${g.stripes === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* perks */}
          {discount ? (
            <div style={{ marginTop: 12, color: "var(--t1)" }}>
              <span style={{ color: accent, fontWeight: 700 }}>{discount}% off</span> bookings as a member
            </div>
          ) : null}

          {/* check-in — a frozen (paused) membership cannot check in: the QR and
              the reception code are withheld until it's reactivated. Booking is
              already blocked server-side; this closes the QR/check-in path too. */}
          {pass.status === "paused" ? (
            <div style={{ marginTop: 20, textAlign: "center", padding: "18px 16px",
              background: "var(--amber2)", border: "1px solid var(--amberb)", borderRadius: "var(--r)" }}>
              <div style={{ color: "var(--amber)", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                Membership frozen
              </div>
              <div style={{ color: "var(--t2)", fontSize: 13, lineHeight: 1.4 }}>
                Your check-in pass is paused. Reactivate your membership to use it at reception again.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 20, textAlign: "center" }}>
              <div style={{ color: "var(--t2)", fontSize: 12, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Scan at reception to check in</div>
              {passUrl ? (
                <div data-tour="qr-code" style={{ display: "inline-block", background: "var(--white)", padding: 14, borderRadius: "var(--r)" }}>
                  <QRCode value={passUrl} size={172} level="M" />
                </div>
              ) : null}
              <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 13, letterSpacing: 1, color: "var(--t2)" }}>
                {pass.check_in_code}
              </div>
            </div>
          )}

          <PaymentStateBanner state={pass.payment_state} />

          {/* upcoming classes — owner only, zero footprint when none (mig 340) */}
          {isOwner && <ClassPasses />}
          {isOwner && <UpcomingClasses />}
          {isOwner && <UpcomingRoomHires />}

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
      {isOwner && <Tour tourKey="io_tour_club_pass" enabled={clubToursEnabled()} />}
      {isOwner && <ClubNavBar active="pass" passToken={token} clubEntry={pass.club_id ? { club_id: pass.club_id, discipline: pass.discipline } : null} />}
    </div>
  );
}

// Upcoming class bookings for the pass owner, with inline cancel (Classes Phase 3,
// mig 340). Renders nothing until it has at least one upcoming booking, so it's
// invisible for members who don't use classes.
function UpcomingClasses() {
  const [rows, setRows] = useState(null); // null=loading, []=none
  const [err, setErr] = useState(null);
  const [taken, setTaken] = useState(new Set()); // session_ids whose offer lapsed/gone
  const cancelling = useRef(new Set());
  const claiming = useRef(new Set());

  const reload = () =>
    memberListMyClassBookings()
      .then((all) => (all || []).filter((b) => b.is_upcoming))
      .catch((e) => { console.error("[memberpass] class bookings load failed", e); return []; });

  useEffect(() => {
    let alive = true;
    reload().then((up) => { if (alive) setRows(up); });
    return () => { alive = false; };
  }, []);

  const cancel = async (bookingId) => {
    if (cancelling.current.has(bookingId)) return;
    cancelling.current.add(bookingId);
    setErr(null);
    const prev = rows;
    setRows((r) => r.filter((b) => b.booking_id !== bookingId)); // optimistic
    try {
      const res = await memberCancelClassBooking(bookingId);
      if (!res?.ok) { setRows(prev); setErr("Couldn't cancel that booking."); }
    } catch (e) {
      console.error("[memberpass] cancel failed", e);
      setRows(prev);
      setErr(e?.message === "cutoff_passed"
        ? "Too late to cancel this class — the cancellation window has passed."
        : "Couldn't cancel that booking. Please try again.");
    } finally {
      cancelling.current.delete(bookingId);
    }
  };

  const claim = async (b) => {
    if (claiming.current.has(b.booking_id)) return;
    claiming.current.add(b.booking_id);
    setErr(null);
    const prev = rows;
    // optimistic: flip the offered row to confirmed
    setRows((r) => r.map((x) => (x.booking_id === b.booking_id ? { ...x, status: "confirmed", offer_expires_at: null } : x)));
    try {
      const res = await memberClaimWaitlistSpot(b.session_id);
      if (!res?.ok) {
        // spot gone — mark it taken and refresh from the server
        setTaken((t) => new Set(t).add(b.session_id));
        const up = await reload();
        setRows(up);
      } else {
        const up = await reload();
        setRows(up);
      }
    } catch (e) {
      console.error("[memberpass] claim failed", e);
      setRows(prev);
      setErr("Couldn't claim that spot. Please try again.");
    } finally {
      claiming.current.delete(b.booking_id);
    }
  };

  if (!rows || rows.length === 0) return null;

  const fmt = (d) => {
    try {
      return new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
    } catch { return d; }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ color: "var(--t2)", fontSize: 12, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Upcoming classes</div>
      {err && <div style={{ color: "#FF6060", fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((b) => {
          const offerLive = b.status === "offered" && b.offer_expires_at && new Date(b.offer_expires_at) > new Date();
          return (
            <div key={b.booking_id} style={{ border: offerLive ? "1px solid #60A0FF" : "1px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: offerLive ? "rgba(96,160,255,0.08)" : "transparent" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)" }}>{b.class_name}</div>
                <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
                  {fmt(b.starts_at)}{b.space_name ? ` · ${b.space_name}` : ""}
                </div>
                {b.status === "waitlist" && (
                  <div style={{ fontSize: 12, color: "#60A0FF", marginTop: 2 }}>
                    Waitlisted{b.waitlist_position ? ` · position ${b.waitlist_position}` : ""}
                  </div>
                )}
                {offerLive && (
                  <div style={{ fontSize: 12, color: "#60A0FF", marginTop: 2, fontWeight: 600 }}>
                    A spot opened — claim it · <ClaimCountdown expiresAt={b.offer_expires_at} />
                  </div>
                )}
                {b.status === "offered" && !offerLive && (
                  <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>This offer has expired.</div>
                )}
                {taken.has(b.session_id) && b.status !== "confirmed" && (
                  <div style={{ fontSize: 12, color: "#FF6060", marginTop: 2 }}>Sorry — that spot was taken.</div>
                )}
              </div>
              {offerLive ? (
                <button
                  onClick={() => claim(b)}
                  disabled={claiming.current.has(b.booking_id)}
                  style={{ flexShrink: 0, background: "#60A0FF", color: "#fff", border: "none", borderRadius: "var(--r-button)", padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  Claim spot
                </button>
              ) : (
                <button
                  onClick={() => cancel(b.booking_id)}
                  style={{ flexShrink: 0, background: "transparent", color: "var(--t2)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-button)", padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
                >
                  Cancel
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Room hires the member has requested/confirmed (Room Hire Phase 5, mig 342).
// Read-only on the pass — confirm/cancel/deposit are venue-side. Zero footprint
// when the member has no upcoming hires.
function UpcomingRoomHires() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    memberListMyRoomHires()
      .then((all) => (all || []).filter((h) => h.is_upcoming))
      .catch((e) => { console.error("[memberpass] room hires load failed", e); return []; })
      .then((up) => { if (alive) setRows(up); });
    return () => { alive = false; };
  }, []);

  if (!rows || rows.length === 0) return null;

  const fmt = (d) => {
    try {
      return new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
    } catch { return d; }
  };
  const STATUS_LABEL = { requested: "Awaiting confirmation", confirmed: "Confirmed" };
  const poundsOpt = (p) => (p == null ? null : "£" + (p % 100 ? (p / 100).toFixed(2) : (p / 100).toString()));

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ color: "var(--t2)", fontSize: 12, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Room hires</div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((h) => {
          const confirmed = h.status === "confirmed";
          return (
            <div key={h.hire_id} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "10px 14px" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)" }}>{h.space_name}</div>
              <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
                {fmt(h.starts_at)}{h.purpose ? ` · ${h.purpose}` : ""}
              </div>
              <div style={{ fontSize: 12, color: confirmed ? "#60A0FF" : "var(--t2)", marginTop: 2 }}>
                {STATUS_LABEL[h.status] || h.status}
                {confirmed && poundsOpt(h.price_pence) ? ` · ${poundsOpt(h.price_pence)}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Class-pass balances for the pass owner (Class Packages Phase 7, mig 344).
// Read-only; each row = remaining credits + expiry at a venue. Zero footprint when
// the member holds no active passes.
function ClassPasses() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    memberGetPackageBalance(null)
      .catch((e) => { console.error("[memberpass] package balance load failed", e); return []; })
      .then((all) => { if (alive) setRows(Array.isArray(all) ? all : []); });
    return () => { alive = false; };
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ color: "var(--t2)", fontSize: 12, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Class passes</div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((b) => (
          <div key={b.balance_id} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)", flex: 1, minWidth: 0 }}>{b.package_name}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "#60A0FF", lineHeight: 1 }}>{b.sessions_remaining}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
              {b.sessions_remaining} class{b.sessions_remaining === 1 ? "" : "es"} left
              {b.venue_name ? ` · ${b.venue_name}` : ""}
              {b.expires_at ? ` · expires ${fmtDate(b.expires_at)}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Live mm:ss countdown to a claim-window expiry. Re-renders once a second; shows
// "expired" when the window lapses so the surrounding card can fall back gracefully.
function ClaimCountdown({ expiresAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return <span>expired</span>;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return <span>{mins}:{String(secs).padStart(2, "0")} left</span>;
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
