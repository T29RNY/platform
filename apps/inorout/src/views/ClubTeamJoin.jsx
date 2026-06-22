import { useState, useEffect, useRef, useCallback } from "react";
import {
  clubTeamJoinContext, memberJoinClubTeam, redeemInviteLink,
  getVenueSignupTiers,
} from "@platform/core/storage/supabase.js";
import useRequireAuth from "../hooks/useRequireAuth.js";
import AuthGateModal from "../components/AuthGateModal.jsx";
import MembershipSignup from "./MembershipSignup.jsx";

// Phase 3 (mig 391) — membership-gated club-team join. Reached from a scanned
// join_club_team QR via InviteResolve (/q/<code>). Flow:
//   resolve context → sign in → membership check → (if none) reuse the 360
//   membership wizard (register → pick tier → pay test-mode) → land on the team
//   (club_team_members) → redeem the invite. The wizard is keyed on the club
//   venue's venue_landing code; assignment is the gated, idempotent
//   member_join_club_team RPC. Self-heals on re-scan (the gate sees the now-live
//   membership), which also covers a Stripe payer who closes the tab.

const STATUS_COPY = {
  not_found:             { title: "Invite not found", body: "This code doesn't match an active team invite. Check the link or ask the club." },
  inactive:              { title: "Invite switched off", body: "This team invite has been turned off, or the team is archived." },
  expired:               { title: "Invite expired", body: "This team invite is past its expiry date." },
  exhausted:             { title: "Invite full", body: "This team invite has reached its maximum number of uses." },
  signup_not_configured: { title: "Sign-up not ready", body: "The club hasn't finished setting up membership sign-up for this team yet. Check back shortly." },
};

function Styles() {
  return (
    <style>{`
      .ctj-shell {
        min-height: 100dvh; width: 100%;
        display: flex; align-items: flex-start; justify-content: center;
        padding: max(28px, env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom));
        background: var(--bg); color: var(--t1); font-family: "DM Sans", sans-serif;
      }
      .ctj-wrap { max-width: 380px; width: 100%; }
      .ctj-kicker { color: var(--t3); font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 4px; }
      .ctj-team { font-family: "Bebas Neue", sans-serif; font-size: 38px; letter-spacing: 0.5px; margin: 0; line-height: 1; }
      .ctj-sub { color: var(--t2); font-size: 14px; margin: 6px 0 4px; }
      .ctj-badge { display: inline-block; margin: 8px 0 18px; padding: 3px 10px; border-radius: 999px;
        background: var(--s1, rgba(255,255,255,0.06)); color: var(--t2); font-size: 12px; letter-spacing: 0.5px; }
      .ctj-msg { color: var(--t2); font-size: 15px; line-height: 1.5; margin: 0 0 14px; }
      .ctj-err { color: #FF6060; font-size: 13px; margin: 8px 0 0; }
      .ctj-person { display: flex; align-items: center; justify-content: space-between; gap: 10px;
        background: var(--s1, rgba(255,255,255,0.04)); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
      .ctj-person-name { font-weight: 600; font-size: 15px; }
      .ctj-person-state { color: var(--t3); font-size: 12px; margin-top: 2px; }
      .ctj-in { color: var(--t2); font-size: 13px; font-weight: 600; }
      .ctj-btn { padding: 9px 14px; border: none; border-radius: 9px; background: var(--t1); color: var(--bg);
        font-family: "DM Sans", sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }
      .ctj-btn:disabled { opacity: 0.45; cursor: default; }
      .ctj-cta { width: 100%; padding: 13px 16px; border: none; border-radius: 11px; background: var(--t1); color: var(--bg);
        font-family: "DM Sans", sans-serif; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 4px; }
      .ctj-section { font-family: "Bebas Neue", sans-serif; font-size: 16px; letter-spacing: 0.5px; color: var(--t2); margin: 18px 0 8px; }
      /* vl-* classes the embedded MembershipSignup relies on (normally from VenueLanding) */
      .vl-comp { background: var(--s1, rgba(255,255,255,0.04)); border-radius: 14px; padding: 16px; margin-top: 6px; }
      .vl-comp-name { font-family: "Bebas Neue", sans-serif; font-size: 24px; letter-spacing: 0.5px; margin: 0; }
      .vl-comp-sub { color: var(--t3); font-size: 12px; margin: 2px 0 12px; }
      .vl-cta { width: 100%; padding: 12px 16px; border: none; border-radius: 10px; background: var(--t1); color: var(--bg);
        font-family: "DM Sans", sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; }
    `}</style>
  );
}

const CATEGORY_LABEL = { youth: "Youth", adult: "Adult", mixed: "Mixed" };
const GENDER_LABEL   = { girls: "Girls", boys: "Boys", mixed: "Mixed" };

export default function ClubTeamJoin({ code }) {
  const [state, setState] = useState({ phase: "loading" });
  const [busyId, setBusyId] = useState(null);     // profile_id mid-assignment
  const [actionErr, setActionErr] = useState(null);
  const [signup, setSignup] = useState(null);     // getVenueSignupTiers result
  const [showWizard, setShowWizard] = useState(false);
  const { requireAuth, gateProps } = useRequireAuth();
  const checkoutReturn = useRef(false);

  const load = useCallback(async () => {
    const data = await clubTeamJoinContext(code);
    setState({ phase: "done", data });
    if (data?.venue_landing_code) {
      getVenueSignupTiers(data.venue_landing_code)
        .then((r) => { if (r?.ok) setSignup(r); })
        .catch(() => {});
    }
    return data;
  }, [code]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      checkoutReturn.current = params.get("checkout") === "done";
    } catch (e) { /* ignore */ }
    let alive = true;
    clubTeamJoinContext(code)
      .then((data) => {
        if (!alive) return;
        setState({ phase: "done", data });
        if (data?.venue_landing_code) {
          getVenueSignupTiers(data.venue_landing_code)
            .then((r) => { if (alive && r?.ok) setSignup(r); })
            .catch(() => {});
        }
      })
      .catch((e) => { console.error("[club-team-join] context threw", e); if (alive) setState({ phase: "done", data: null }); });
    return () => { alive = false; };
  }, [code]);

  const assign = useCallback(async (profileId, label) => {
    setActionErr(null);
    setBusyId(profileId || "self");
    try {
      const r = await memberJoinClubTeam(code, profileId ?? null);
      if (r?.ok) {
        redeemInviteLink(code).catch(() => {});   // post-join use-count + audit
        await load();
      } else if (r?.reason === "no_membership") {
        setShowWizard(true);
        setActionErr(`${label || "That member"} needs an active membership first — register and pay below.`);
      } else {
        setActionErr("Couldn't join the team — please try again.");
      }
    } catch (e) {
      console.error("[club-team-join] assign failed", e);
      setActionErr("Couldn't join the team — please try again.");
    } finally {
      setBusyId(null);
    }
  }, [code, load]);

  // After enrolment completes inside the wizard (free / no-Stripe path), land the
  // newly-enrolled profile on the team straight away.
  const onEnrolled = useCallback(async (_passToken, forProfileId) => {
    try {
      const r = await memberJoinClubTeam(code, forProfileId ?? null);
      if (r?.ok) redeemInviteLink(code).catch(() => {});
    } catch (e) {
      console.error("[club-team-join] post-enrol assign failed", e);
    } finally {
      setShowWizard(false);
      load();
    }
  }, [code, load]);

  if (state.phase === "loading") {
    return <div className="ctj-shell"><Styles /><div className="ctj-wrap"><p className="ctj-msg">Loading…</p></div></div>;
  }

  const data = state.data;
  if (!data || !data.ok) {
    const copy = STATUS_COPY[data?.status] || STATUS_COPY.not_found;
    return (
      <div className="ctj-shell"><Styles /><div className="ctj-wrap">
        <h1 className="ctj-team">{copy.title}</h1>
        <p className="ctj-msg" style={{ marginTop: 12 }}>{copy.body}</p>
      </div></div>
    );
  }

  const team   = data.team || {};
  const cohort = data.cohort || {};
  const club   = data.club || {};
  const sub    = [club.name, cohort.name].filter(Boolean).join(" · ");
  const badge  = [CATEGORY_LABEL[cohort.category], GENDER_LABEL[team.gender]].filter(Boolean).join(" · ");

  const Header = () => (
    <>
      <p className="ctj-kicker">Join the team</p>
      <h1 className="ctj-team">{team.name || "Club team"}</h1>
      {sub && <p className="ctj-sub">{sub}</p>}
      {badge && <span className="ctj-badge">{badge}</span>}
    </>
  );

  // Not signed in yet — club_team_members needs an authenticated member profile.
  if (!data.signed_in) {
    return (
      <div className="ctj-shell"><Styles /><div className="ctj-wrap">
        <Header />
        <p className="ctj-msg">Sign in to register and join. You'll only need to do this once.</p>
        <button className="ctj-cta" onClick={() => requireAuth(() => load(), { reason: `Sign in to join ${team.name || "the team"}.` })}>
          Sign in to join
        </button>
        <AuthGateModal {...gateProps} />
      </div></div>
    );
  }

  const self = data.self;
  const children = Array.isArray(data.children) ? data.children : [];

  // People the signed-in user can act for, with their state.
  const ready  = [];   // active membership, not yet on team → one-tap join
  const onTeam = [];   // already on team
  if (self) {
    const label = "You";
    if (self.on_team) onTeam.push({ id: null, label });
    else if (self.has_membership) ready.push({ id: self.profile_id, label });
  }
  children.forEach((c) => {
    const label = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Child";
    if (c.on_team) onTeam.push({ id: c.profile_id, label });
    else if (c.has_membership) ready.push({ id: c.profile_id, label });
  });

  const selfNeedsMembership = !data.has_profile || !self?.has_membership;
  const wizardOpen = selfNeedsMembership || showWizard ||
    (checkoutReturn.current && ready.length === 0 && onTeam.length === 0);

  return (
    <div className="ctj-shell"><Styles /><div className="ctj-wrap">
      <Header />

      {checkoutReturn.current && (
        <p className="ctj-msg">Payment received. {ready.length > 0 ? "Tap to finish joining." : "Finalising your membership…"}</p>
      )}

      {ready.length > 0 && (
        <>
          <div className="ctj-section">Ready to join</div>
          {ready.map((p) => (
            <div className="ctj-person" key={p.id || "self"}>
              <div>
                <div className="ctj-person-name">{p.label}</div>
                <div className="ctj-person-state">Member · not on this team yet</div>
              </div>
              <button className="ctj-btn" disabled={busyId !== null} onClick={() => assign(p.id, p.label)}>
                {busyId === (p.id || "self") ? "Joining…" : "Join"}
              </button>
            </div>
          ))}
        </>
      )}

      {onTeam.length > 0 && (
        <>
          <div className="ctj-section">In the team</div>
          {onTeam.map((p) => (
            <div className="ctj-person" key={p.id || "self-in"}>
              <div className="ctj-person-name">{p.label}</div>
              <span className="ctj-in">✓ In {team.name}</span>
            </div>
          ))}
        </>
      )}

      {actionErr && <p className="ctj-err">{actionErr}</p>}

      {wizardOpen ? (
        <div style={{ marginTop: 16 }}>
          <div className="ctj-section">Register &amp; join</div>
          <MembershipSignup
            code={data.venue_landing_code}
            club={signup?.club ?? null}
            documents={signup?.documents ?? []}
            tiers={signup?.tiers ?? []}
            clubTeamCode={code}
            onEnrolled={onEnrolled}
          />
        </div>
      ) : (
        !selfNeedsMembership && (
          <button className="ctj-cta" style={{ marginTop: 14 }} onClick={() => setShowWizard(true)}>
            Register another member
          </button>
        )
      )}

      <AuthGateModal {...gateProps} />
    </div></div>
  );
}
