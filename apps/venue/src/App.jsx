import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  venueGetState, getPitchOccupancy, venueGetBookingIns, venueGetRefResponses,
  venueWhoami, venueClaimMemberships, getVenueFeatureFlags, venueListClubs, supabase,
} from "@platform/core/storage/supabase.js";
import Dashboard from "./views/Dashboard.jsx";
import VenueSignIn from "./views/VenueSignIn.jsx";
import { todayIso, addDays } from "./bookingUtil.js";

const BOOKING_REASONS = new Set([
  "booking_requested", "booking_confirmed", "booking_declined",
  "booking_cancelled", "booking_superseded",
]);

// Legacy / dev-demo backdoor: a shared venue_admin_token in the URL skips login
// entirely (resolve_venue_caller stage 1). Real staff use the sign-in screen.
function readTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get("token");
  if (t) return t;
  const m = window.location.pathname.match(/\/venue\/([^/?]+)/);
  return m ? m[1] : null;
}

export default function App() {
  const urlToken = useMemo(() => readTokenFromUrl(), []);

  // ── Auth (skipped entirely when the URL backdoor token is present) ──
  const [session, setSession] = useState(undefined);   // undefined = checking, null = none
  const [venues, setVenues] = useState(null);           // null = not loaded, [] = none, [...] = member
  const [selectedVenueId, setSelectedVenueId] = useState(null);
  const [authError, setAuthError] = useState(null);

  // ── Club lens (Club Console Consolidation PR #1) ──
  // `clubContext` = the currently-focused club id, or null for the default
  // venue-operator view. It is NOT a credential: `selectedVenueId` stays the RPC
  // credential; clubContext is a narrowing FILTER threaded into the club-touching
  // views. It lives here (not in Dashboard's `view` string) so it survives view
  // changes. Seeded from `?club=<id>` at mount (survives refresh / bookmarkable),
  // validated against the venue's real club list once loaded.
  const initialClubParam = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("club");
  }, []);
  const [clubs, setClubs] = useState([]);                       // clubs this venue operates (switcher options)
  const [clubContext, setClubContext] = useState(() => initialClubParam);

  // The credential passed to every venue RPC: the shared token (backdoor) OR,
  // for a logged-in member, their venue_id (resolve_venue_caller stage 1b —
  // venue ids never collide with the long random tokens).
  const credential = urlToken || selectedVenueId;

  // Identity for the chosen venue — drives the rail account chip + (later) gating.
  const me = useMemo(() => {
    if (urlToken) return { mode: "token" };
    const v = (venues || []).find((x) => x.venue_id === selectedVenueId);
    return v
      ? { mode: "login", email: session?.user?.email, role: v.role, capsGrant: v.caps_grant, capsDeny: v.caps_deny }
      : null;
  }, [urlToken, venues, selectedVenueId, session]);

  // ── Dashboard data ──
  const [state, setState] = useState(null);
  const [occupancy, setOccupancy] = useState([]);
  const [bookingIns, setBookingIns] = useState({});
  const [features, setFeatures] = useState(null);   // modular feature flags (mig 399); null = loading
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (t) => {
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const data = await venueGetState(t);
      // Referee accept/decline + availability (mig 442) — best-effort, merged onto
      // the dashboard state so FixtureCard/FixtureActions read it without new props.
      // A failure never blocks the dashboard (refs surface just stays neutral).
      const refResponses = {}; const officialUnavail = {};
      try {
        const rr = await venueGetRefResponses(t);
        (rr?.fixture_responses || []).forEach((r) => { refResponses[r.fixture_id] = { response: r.response, responded_at: r.responded_at }; });
        (rr?.official_unavailability || []).forEach((u) => {
          (officialUnavail[u.official_id] ||= []).push({ start_date: u.start_date, end_date: u.end_date });
        });
      } catch (err) { console.error("venue_get_ref_responses failed", err); }
      data.refResponses = refResponses;
      data.officialUnavail = officialUnavail;
      setState(data);
    } catch (err) {
      console.error("venue_get_state failed", err);
      setError(err?.message || String(err));
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOccupancy = useCallback(async (t) => {
    if (!t) return;
    try {
      const rows = await getPitchOccupancy(t, todayIso(), addDays(todayIso(), 90));
      setOccupancy(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error("get_pitch_occupancy failed", err);
      setOccupancy([]);
    }
  }, []);

  const loadIns = useCallback(async (t) => {
    if (!t) return;
    try {
      setBookingIns(await venueGetBookingIns(t));
    } catch (err) {
      console.error("venue_get_booking_ins failed", err);
    }
  }, []);

  // Modular feature flags drive the rail (nav) + route gates. Fails open inside
  // the wrapper, so a failure leaves every feature visible (never hides paid ones).
  const loadFeatures = useCallback(async (t) => {
    if (!t) return;
    setFeatures(await getVenueFeatureFlags(t));
  }, []);

  // ── Auth bootstrap: track the Supabase session (unless using the backdoor) ──
  useEffect(() => {
    if (urlToken) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session ?? null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [urlToken]);

  // On a fresh session: claim any pending email invites, then load memberships.
  useEffect(() => {
    if (urlToken) return;
    if (!session) { setVenues(null); setSelectedVenueId(null); return; }
    let active = true;
    (async () => {
      try {
        await venueClaimMemberships();
        const who = await venueWhoami();
        if (!active) return;
        const vs = who?.venues ?? [];
        setVenues(vs);
        setSelectedVenueId((prev) => prev || (vs.length === 1 ? vs[0].venue_id : null));
      } catch (err) {
        if (active) setAuthError(err?.message || String(err));
      }
    })();
    return () => { active = false; };
  }, [session, urlToken]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setVenues(null);
    setSelectedVenueId(null);
    setState(null);
  }, []);

  // ── Load dashboard data once a credential is resolved ──
  useEffect(() => {
    if (credential) { load(credential); loadOccupancy(credential); loadIns(credential); loadFeatures(credential); }
  }, [credential, load, loadOccupancy, loadIns, loadFeatures]);

  // ── Club switcher options: the clubs this venue operates ──
  // Venue-token keyed, so it works under both the URL backdoor and a logged-in
  // member. On a venue switch the list reloads and any club focus that isn't in
  // the new venue's clubs is dropped (no cross-venue bleed); this also validates
  // the `?club` URL seed against real clubs.
  useEffect(() => {
    if (!credential) { setClubs([]); return; }
    let active = true;
    (async () => {
      try {
        const cs = await venueListClubs(credential);
        if (!active) return;
        const list = Array.isArray(cs) ? cs : [];
        setClubs(list);
        setClubContext((prev) => (prev && list.some((c) => c.id === prev) ? prev : null));
      } catch (err) {
        console.error("venue_list_clubs failed", err);
        if (active) { setClubs([]); setClubContext(null); }
      }
    })();
    return () => { active = false; };
  }, [credential]);

  // Keep `?club=<id>` in the URL in sync so the club lens survives a refresh and
  // the club-focused console is bookmarkable. The venue router is URL-less by
  // design (Dashboard reads params only at mount) — this is minimal param sync,
  // NOT a router conversion. replaceState (not push) to avoid history spam.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (clubContext) sp.set("club", clubContext); else sp.delete("club");
    const qs = sp.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
  }, [clubContext]);

  // 60s fallback poll for the live "ins" counts.
  useEffect(() => {
    if (!credential) return;
    const id = setInterval(() => loadIns(credential), 60000);
    return () => clearInterval(id);
  }, [credential, loadIns]);

  // Venue-level realtime broadcasts (mig 121). Mirror the publisher byte-for-byte.
  const venueChannelKey = state?.venue?.live_channel_key ?? null;
  const reloadRef = useRef(load);          reloadRef.current = load;
  const reloadOccRef = useRef(loadOccupancy); reloadOccRef.current = loadOccupancy;
  const reloadInsRef = useRef(loadIns);    reloadInsRef.current = loadIns;
  // Membership-scoped live signal: bumped on a self-signup / approval so the
  // Memberships view (which owns its own data) re-fetches without a full reload.
  const [membershipTick, setMembershipTick] = useState(0);
  useEffect(() => {
    if (!venueChannelKey || !credential) return;
    const ch = supabase.channel(`venue_live:${venueChannelKey}`);
    ch.on("broadcast", { event: "broadcast" }, (payload) => {
      const reason = payload?.payload?.reason;
      console.info("[venue] live update", reason);
      if (reason === "customer_self_signup" || reason === "customer_approved") setMembershipTick((t) => t + 1);
      if (reason === "booking_ins_changed") { reloadInsRef.current(credential); return; }
      reloadOccRef.current(credential);
      if (!BOOKING_REASONS.has(reason)) reloadRef.current(credential);
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") console.info("[venue] subscribed to", `venue_live:${venueChannelKey.slice(0, 8)}…`);
    });
    return () => { supabase.removeChannel(ch); };
  }, [venueChannelKey, credential]);

  // ── Render gates ──────────────────────────────────────────────────────────
  // Auth flow (no backdoor token): checking → sign-in → claim/whoami →
  // no-access / venue-picker → dashboard.
  if (!urlToken) {
    if (session === undefined) {
      return <div className="token-screen"><div className="text-mute">Loading…</div></div>;
    }
    if (!session) return <VenueSignIn />;

    if (authError) {
      return (
        <div className="token-screen">
          <div className="token-card">
            <div className="brand-row"><div className="mark">io</div><div className="wm">In or Out</div></div>
            <h1>Couldn’t load your access</h1>
            <p>{authError}</p>
            <button className="btn btn-primary" onClick={signOut}>Sign out</button>
          </div>
        </div>
      );
    }
    if (venues === null) {
      return <div className="token-screen"><div className="text-mute">Loading your venues…</div></div>;
    }
    if (venues.length === 0) {
      return (
        <div className="token-screen">
          <div className="token-card">
            <div className="brand-row"><div className="mark">io</div><div className="wm">In or Out</div></div>
            <h1>No venue access</h1>
            <p>You’re signed in as <strong>{session.user?.email}</strong>, but this account isn’t a member of any venue yet. Ask a venue owner to invite you.</p>
            <button className="btn btn-primary" onClick={signOut}>Sign out</button>
          </div>
        </div>
      );
    }
    if (!selectedVenueId) {
      return (
        <div className="token-screen">
          <div className="token-card">
            <div className="brand-row"><div className="mark">io</div><div className="wm">In or Out</div></div>
            <h1>Choose a venue</h1>
            <p>You manage more than one venue. Which are you working on?</p>
            <div className="venue-picker">
              {venues.map((v) => (
                <button key={v.venue_id} className="pick" onClick={() => setSelectedVenueId(v.venue_id)}>
                  <span>{v.name}</span>
                  <span className="role">{v.role}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={signOut}>Sign out</button>
          </div>
        </div>
      );
    }
  }

  if (loading && !state) {
    return <div className="token-screen"><div className="text-mute">Loading dashboard…</div></div>;
  }

  if (error) {
    return (
      <div className="token-screen">
        <div className="token-card">
          <div className="brand-row"><div className="mark">io</div><div className="wm">In or Out</div></div>
          <h1>Couldn’t load</h1>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => (urlToken ? load(credential) : signOut())}>
            {urlToken ? "Retry" : "Sign out"}
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  return (
    <Dashboard
      state={state}
      venueToken={credential}
      occupancy={occupancy}
      bookingIns={bookingIns}
      features={features}
      me={me}
      clubs={clubs}
      clubContext={clubContext}
      onSelectClub={setClubContext}
      onSignOut={me?.mode === "login" ? signOut : null}
      onSwitchVenue={(venues && venues.length > 1) ? () => setSelectedVenueId(null) : null}
      onRefresh={() => load(credential)}
      onRefreshOccupancy={() => loadOccupancy(credential)}
      onRefreshFeatures={() => loadFeatures(credential)}
      refreshing={loading}
      membershipTick={membershipTick}
    />
  );
}
