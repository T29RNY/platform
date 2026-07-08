import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@platform/core/storage/supabase.js";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import {
  venueWhoami,
  venueListClubs,
  venueClaimMemberships,
  getMyWorld,
  getClubPublic,
} from "@platform/core/storage/supabase.js";
import ConsoleShell from "./shell/ConsoleShell.jsx";
import { clubIdToSlug } from "./lib/roles.js";

export default function App() {
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [world, setWorld] = useState(null);
  const [venues, setVenues] = useState(null);        // null = not loaded, [] = loaded-empty
  const [selectedVenueId, setSelectedVenueId] = useState(null);

  const [clubs, setClubs] = useState(null);
  const [selectedClubId, setSelectedClubId] = useState(null);

  const [clubPublic, setClubPublic] = useState(null);
  const [clubLoading, setClubLoading] = useState(false);
  const [clubError, setClubError] = useState(false);
  const clubReqRef = useRef(0);

  // Gate boot on the stable user id, not the session object — onAuthStateChange
  // hands a fresh session object on every token refresh / focus, and re-running
  // the boot would re-fire venueClaimMemberships (a write) needlessly.
  const authUserId = session?.user?.id ?? null;

  // ── auth session (SSO — shared *.in-or-out.com cookie, no token in bundle) ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ── boot: resolve the operator's venues + the identity spine ──
  useEffect(() => {
    if (!authUserId) { setVenues(null); setWorld(null); return; }
    let cancelled = false;
    (async () => {
      try { await venueClaimMemberships(); } catch { /* best-effort invite binding */ }
      try {
        const [who, w] = await Promise.all([venueWhoami(), getMyWorld().catch(() => null)]);
        if (cancelled) return;
        setWorld(w);
        const vs = who?.venues || [];
        setVenues(vs);
        setSelectedVenueId((prev) => prev || vs[0]?.venue_id || null);
      } catch (err) {
        console.error("[clubmanager] boot failed", err);
        if (!cancelled) setVenues([]);
      }
    })();
    return () => { cancelled = true; };
  }, [authUserId]);

  // ── clubs for the selected ground ──
  useEffect(() => {
    if (!selectedVenueId) { setClubs(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const cs = await venueListClubs(selectedVenueId);
        if (cancelled) return;
        const list = Array.isArray(cs) ? cs : [];
        setClubs(list);
        setSelectedClubId((prev) => (prev && list.some((c) => c.id === prev)) ? prev : (list[0]?.id || null));
      } catch (err) {
        console.error("[clubmanager] venue clubs failed", err);
        if (!cancelled) setClubs([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedVenueId]);

  // ── selected club's public payload (branding + fixtures + rosters) ──
  const loadClubPublic = useCallback(async () => {
    if (!selectedClubId) { setClubPublic(null); return; }
    const slug = clubIdToSlug(selectedClubId);
    if (!slug) { setClubPublic(null); return; }
    const reqId = ++clubReqRef.current;              // stale-response guard on rapid switch
    setClubLoading(true); setClubError(false);
    try {
      const data = await getClubPublic(slug);
      if (reqId !== clubReqRef.current) return;
      // Identity guard: the slug is DERIVED from the club id, so only trust the
      // public payload if it resolves to the authorised club. Otherwise treat as
      // "no public page" — the console keeps the authenticated club identity and
      // falls back to the default theme rather than showing another club's brand.
      const matches = data && data.found !== false && data.club?.id === selectedClubId;
      setClubPublic(matches ? data : { found: false });
    } catch (err) {
      if (reqId !== clubReqRef.current) return;
      console.error("[clubmanager] club public failed", err);
      setClubError(true);
      setClubPublic(null);
    } finally {
      if (reqId === clubReqRef.current) setClubLoading(false);
    }
  }, [selectedClubId]);

  useEffect(() => { loadClubPublic(); }, [loadClubPublic]);

  // ── render gates ──
  if (sessionLoading) return <div className="center"><div className="muted">Loading…</div></div>;

  if (!session) {
    return (
      <div className="center">
        <div className="card">
          <h1>Club Manager</h1>
          <p className="muted" style={{ marginBottom: 16 }}>Sign in to run your club.</p>
          <Auth
            supabaseClient={supabase}
            providers={["google"]}
            appearance={{ theme: ThemeSupa }}
            theme="dark"
            redirectTo={typeof window !== "undefined" ? window.location.origin : undefined}
            onlyThirdPartyProviders={false}
          />
        </div>
      </div>
    );
  }

  if (venues === null) return <div className="center"><div className="muted">Loading your club…</div></div>;

  if (venues.length === 0) {
    return (
      <div className="center">
        <div className="card">
          <h1>No club access</h1>
          <p className="muted">
            Signed in as <strong>{session.user?.email}</strong>, but this account doesn’t
            administer a club yet. Ask your club owner to add you.
          </p>
          <button className="small" style={{ marginTop: 16 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  if (clubs !== null && clubs.length === 0) {
    return (
      <div className="center">
        <div className="card">
          <h1>No club linked</h1>
          <p className="muted">
            Signed in as <strong>{session.user?.email}</strong>. No club is linked to your
            ground yet — set one up in the venue console first.
          </p>
          <button className="small" style={{ marginTop: 16 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  const club = (clubs || []).find((c) => c.id === selectedClubId) || (clubs || [])[0] || null;

  return (
    <ConsoleShell
      club={club}
      branding={clubPublic?.branding}
      venues={venues}
      selectedVenueId={selectedVenueId}
      onSelectVenue={setSelectedVenueId}
      clubs={clubs || []}
      selectedClubId={selectedClubId}
      onSelectClub={setSelectedClubId}
      world={world}
      email={session.user?.email}
      onSignOut={() => supabase.auth.signOut()}
      venueId={selectedVenueId}
      clubId={selectedClubId}
      clubPublic={clubPublic}
      clubLoading={clubLoading}
      clubError={clubError}
      onRetryClub={loadClubPublic}
    />
  );
}
