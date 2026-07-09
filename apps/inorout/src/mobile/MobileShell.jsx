// MobileShell.jsx — the shared, role-aware shell for the multi-role mobile app
// (guardian + operator + team-manager), mounted at /hub/* inside apps/inorout.
//
// SCOPE GUARANTEE: the whole tree renders inside ONE
// <div data-surface="mobile" data-theme={resolved} class="m-app"> wrapper, so the
// scoped amber tokens (mobile-tokens.css) apply here and ONLY here. The existing
// :root gold theme — casual player view, internal-league "Member" view, every
// laptop/dashboard page — is untouched.
//
// Phase 0 = foundation only: header, child-switcher, floating role-aware tab bar,
// bottom-sheet host, toast host, profile/appearance sheet. Each tab renders a
// labelled placeholder; real screens land per-track on top of this shell.
//
// Role + identity come from get_my_world() (passed in as `world` from App.jsx) —
// there is NO role switcher (prototype affordance only).

import { useState, useMemo, useCallback, useEffect } from "react";
import { guardianListChildNotices, memberGetSelf } from "@platform/core";
import { enableMemberPush } from "../native/native-push.js";
import PushOptInModal from "../components/PushOptInModal.jsx";
import "./theme/mobile-tokens.css";
import { useMobileTheme } from "./theme/useMobileTheme.js";
import { resolveRoles, tabsFor, TAB_META, contextSubline, entityKey, roleLabel } from "./nav.js";
import MIcon from "./icons.jsx";
import ProfileSheet from "./ProfileSheet.jsx";
import GuardianMatches from "./screens/GuardianMatches.jsx";
import GuardianLeague from "./screens/GuardianLeague.jsx";
import GuardianMembership from "./screens/GuardianMembership.jsx";
import GuardianMore from "./screens/GuardianMore.jsx";
import GuardianDocs from "./screens/GuardianDocs.jsx";
import GuardianSchedule from "./screens/GuardianSchedule.jsx";
import GuardianNotices from "./screens/GuardianNotices.jsx";
import GuardianTeam from "./screens/GuardianTeam.jsx";
import MemberReliability from "./screens/MemberReliability.jsx";
import OperationsTonight from "./screens/OperationsTonight.jsx";
import OperatorBookings from "./screens/OperatorBookings.jsx";
import OperatorPayments from "./screens/OperatorPayments.jsx";
import OperatorPeople from "./screens/OperatorPeople.jsx";
import OperatorSetup from "./screens/OperatorSetup.jsx";
import OperatorMore from "./screens/OperatorMore.jsx";
import OperatorTournaments from "./screens/OperatorTournaments.jsx";
import TournamentView from "./screens/TournamentView.jsx";
import RefFixtures from "./screens/RefFixtures.jsx";
import RefMatch from "./screens/RefMatch.jsx";
import TeamManagerLeague from "./screens/TeamManagerLeague.jsx";
import TeamManagerTonight from "./screens/TeamManagerTonight.jsx";
import TeamManagerPeople from "./screens/TeamManagerPeople.jsx";
import ClubAdminToday from "./screens/ClubAdminToday.jsx";
import ClubAdminPeople from "./screens/ClubAdminPeople.jsx";
import ClubAdminMoney from "./screens/ClubAdminMoney.jsx";
import ClubAdminComms from "./screens/ClubAdminComms.jsx";
import ClubAdminMore from "./screens/ClubAdminMore.jsx";
import ClubAdminSchedule from "./screens/ClubAdminSchedule.jsx";
import ClubAdminMemberships from "./screens/ClubAdminMemberships.jsx";
import ClubAdminClubPage from "./screens/ClubAdminClubPage.jsx";
import ClubAdminSafeguarding from "./screens/ClubAdminSafeguarding.jsx";

function initials(name) {
  if (!name) return "?";
  const w = String(name).split(/\s+/).filter(Boolean);
  if (w.length === 0) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

export default function MobileShell({ world, authUser, route, onSignOut }) {
  const { pref, resolved, setPref } = useMobileTheme();

  // Resolve hats once from the server payload. Highest-rank role is the default.
  const roles = useMemo(() => resolveRoles(world), [world]);
  const [roleIdx, setRoleIdx] = useState(0);
  const role = roles[roleIdx] || null;

  // Roles held AT THE CURRENT ENTITY (e.g. Admin + Player at one club). >1 makes the
  // header role pill a tappable switch; tapping cycles to the next role here and the
  // tab-valid effect below re-homes the tab bar to that role's tabs.
  const entityRoles = role
    ? roles.map((r, i) => ({ r, i })).filter((x) => entityKey(x.r) === entityKey(role))
    : [];
  const canSwitchRole = entityRoles.length > 1;
  const cycleRole = () => {
    if (!canSwitchRole) return;
    const order = entityRoles.map((x) => x.i);
    setRoleIdx(order[(order.indexOf(roleIdx) + 1) % order.length]);
  };

  // Active child (guardian only). Re-keys consumer screens on switch.
  const children = role?.key === "guardian" ? role.children : [];
  const [childId, setChildId] = useState(children[0]?.child_profile_id || null);
  const activeChild = children.find((c) => c.child_profile_id === childId) || children[0] || null;

  // Tabs for this role; current tab derives from the URL sub-path (/hub/<tab>).
  const tabs = tabsFor(role);
  const routeTab = route?.sub?.[0];
  const [tab, setTab] = useState(tabs.includes(routeTab) ? routeTab : tabs[0]);

  // Keep tab valid if the role changes underneath us.
  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [tabs, tab]);

  // Guardian "More" sub-view (null | 'documents' | 'schedule' | 'notices') + operator
  // More sub-view (null | 'cups' | 'setup'). Resets when the tab or child changes.
  const [moreView, setMoreView] = useState(null);
  // Tournament spectator overlay (null | {slug, id}) — opened from the Cups index, closes on tab nav.
  const [tournament, setTournament] = useState(null);
  // Referee officiating overlay (null | game) — full-screen iframe of the ref app, closes on tab nav.
  const [refMatch, setRefMatch] = useState(null);
  useEffect(() => { setMoreView(null); setTournament(null); setRefMatch(null); }, [tab, childId]);

  // Unread club-notices count for the active child → drives the "Club notices" More-row badge.
  const [noticesUnread, setNoticesUnread] = useState(0);
  const guardianActive = role?.key === "guardian";
  // Use the resolved active child's id (childId state is only set by the child-switcher and
  // stays null for a single-child guardian, where activeChild falls back to children[0]).
  const activeChildId = activeChild?.child_profile_id || null;
  useEffect(() => {
    let cancelled = false;
    if (!guardianActive || !activeChildId) { setNoticesUnread(0); return; }
    guardianListChildNotices(activeChildId)
      .then((res) => { if (!cancelled) setNoticesUnread(res?.unread_count ?? 0); })
      .catch(() => { if (!cancelled) setNoticesUnread(0); });
    return () => { cancelled = true; };
  }, [guardianActive, activeChildId]);

  // Adult club member self-view (Club Console PR #6). When the member hat is
  // active, fetch the caller's OWN profile from member_get_self — the SELF
  // member_profiles.id (NOT world.person_id, which is people.id, and NOT a child
  // id). This id is threaded into the reused guardian screens with selfMode, so
  // the self track shows only the member's own data and never mixes with the
  // guardian child-proxy view.
  const memberActive = role?.key === "member";
  const [selfProfile, setSelfProfile] = useState(null); // { member_profile_id, first_name, ... }
  useEffect(() => {
    let cancelled = false;
    if (!memberActive) { setSelfProfile(null); return; }
    memberGetSelf()
      .then((r) => { if (!cancelled) setSelfProfile(r?.found ? r : null); })
      .catch(() => { if (!cancelled) setSelfProfile(null); });
    return () => { cancelled = true; };
  }, [memberActive]);
  const selfProfileId = selfProfile?.member_profile_id || null;
  const selfFirst = selfProfile?.first_name || "You";

  const [sheet, setSheet] = useState(null); // null | 'profile' | node
  const [toasts, setToasts] = useState([]);

  // A member has no in-page "More" view — the tab-bar routes their More tap to the
  // profile sheet. If a member deep-links to /hub/more, mirror that (open the sheet
  // + fall back to schedule) so Schedule content never renders under a "More" title.
  useEffect(() => {
    if (memberActive && tab === "more") { setSheet("profile"); setTab("schedule"); }
  }, [memberActive, tab]);

  const toast = useCallback((opts) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2700);
  }, []);

  // Push opt-in — the SAME modal casual players + managers see, amber-themed for
  // the /hub shell. Shown once on landing for every member role (guardian,
  // operator, team-manager, referee); re-asks up to a cap; Never stops it. Shares
  // the member_notif localStorage keys with SessionsScreen + MemberProfile, so a
  // yes/no on any surface carries across all of them on this device.
  const PUSH_ASK_CAP = 3;
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushState, setPushState] = useState("idle"); // idle | asking | subscribed | denied
  useEffect(() => {
    let cur, asks = 0;
    try {
      cur = localStorage.getItem("member_notif");
      asks = parseInt(localStorage.getItem("member_notif_asks") || "0", 10) || 0;
    } catch { return; }
    if (cur === "subscribed" || cur === "denied" || cur === "never") return;
    if (asks >= PUSH_ASK_CAP) return;
    // Let the shell paint before asking — a modal on the very first frame reads
    // as a spam wall.
    const t = setTimeout(() => setShowPushModal(true), 1200);
    return () => clearTimeout(t);
  }, []);
  const handlePushAllow = async () => {
    setPushState("asking");
    try {
      const r = await enableMemberPush({
        onRegistered: () => { try { localStorage.setItem("member_notif", "subscribed"); } catch { /* noop */ } setPushState("subscribed"); },
        onError:      () => setPushState("idle"),
      });
      if (r === "subscribed")       { try { localStorage.setItem("member_notif", "subscribed"); } catch { /* noop */ } setPushState("subscribed"); }
      else if (r === "denied")      { try { localStorage.setItem("member_notif", "denied"); }     catch { /* noop */ } setPushState("denied"); }
      else if (r === "unsupported") setShowPushModal(false);
      // 'registering' (native): the onRegistered callback resolves it
    } catch (e) {
      console.error("[hub] enable push failed", e);
      setPushState("idle");
    }
  };
  const handlePushNotNow = () => {
    try {
      const a = (parseInt(localStorage.getItem("member_notif_asks") || "0", 10) || 0) + 1;
      localStorage.setItem("member_notif_asks", String(a));
    } catch { /* noop */ }
    setShowPushModal(false);
  };
  const handlePushNever = () => {
    try { localStorage.setItem("member_notif", "never"); } catch { /* noop */ }
    setShowPushModal(false);
  };
  useEffect(() => {
    if (showPushModal && pushState === "subscribed") {
      const t = setTimeout(() => setShowPushModal(false), 1600);
      return () => clearTimeout(t);
    }
  }, [showPushModal, pushState]);

  const displayName = authUser?.user_metadata?.full_name || authUser?.email || "You";

  // No mobile hats → render nothing; App.jsx will have bounced squad-only users.
  if (!role) {
    return (
      <div data-surface="mobile" data-theme={resolved} className="m-app">
        <div className="m-scroll">
          <div className="m-card" style={{ marginTop: 40 }}>
            <div className="m-eyebrow">No mobile views</div>
            <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>
              This account has no guardian, operator, or team-manager role yet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isGuardian = role.key === "guardian";
  const MORE_TITLES = { documents: "Documents", schedule: "Schedule", notices: "Club notices", team: "Team" };
  const CLUB_MORE_TITLES = { schedule: "Schedule", memberships: "Memberships", clubpage: "Club page", safeguarding: "Safeguarding" };
  const OPERATOR_MORE_TITLES = { cups: "Tournaments", setup: "Set up venue" };
  const headerTitle = tournament
    ? "Tournament"
    : role.key === "operator" && tab === "more" && moreView
      ? (OPERATOR_MORE_TITLES[moreView] || TAB_META[tab]?.title || "Home")
      : role.key === "club_admin" && tab === "more" && moreView
        ? (CLUB_MORE_TITLES[moreView] || TAB_META[tab]?.title || "Home")
        : isGuardian && tab === "more" && moreView
          ? (MORE_TITLES[moreView] || TAB_META[tab]?.title || "Home")
          : TAB_META[tab]?.title || "Home";

  return (
    <div data-surface="mobile" data-theme={resolved} className="m-app">
      {/* header */}
      <div className="m-hdr">
        <div className="m-hdr-row">
          <button className="m-avatar" onClick={() => setSheet("profile")} aria-label="Profile">
            {initials(displayName)}
          </button>
          <div className="m-hdr-title">
            <div className="m-title">{headerTitle}</div>
            <div className="m-sub" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <span>{contextSubline(role, activeChild)}</span>
              {role && (
                <button
                  onClick={canSwitchRole ? cycleRole : undefined}
                  aria-label={canSwitchRole ? "Switch role" : undefined}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 3,
                    padding: "2px 8px", borderRadius: "var(--r-pill)",
                    background: "var(--amber-soft)", border: "1px solid var(--amber-glow)",
                    color: "var(--amber)", fontSize: 10.5, fontWeight: 800,
                    letterSpacing: "0.04em", textTransform: "uppercase",
                    fontFamily: "var(--m-font)", cursor: canSwitchRole ? "pointer" : "default",
                  }}>
                  {roleLabel(role)}
                  {canSwitchRole && <MIcon name="chevdown" size={11} color="var(--amber)" />}
                </button>
              )}
            </div>
          </div>
          {!isGuardian && (
            <button className="m-icon-btn" onClick={() => toast({ icon: "search", text: "Search" })} aria-label="Search">
              <MIcon name="search" size={19} />
            </button>
          )}
          <button className="m-icon-btn" onClick={() => toast({ icon: "bell", text: "Notifications" })} aria-label="Notifications">
            <MIcon name="bell" size={19} />
          </button>
        </div>

        {/* child switcher — guardian with 2+ children */}
        {isGuardian && children.length > 1 && (
          <div className="m-child-strip">
            {children.map((c) => {
              const on = c.child_profile_id === childId;
              return (
                <button
                  key={c.child_profile_id}
                  className={"m-child-chip" + (on ? " on" : "")}
                  onClick={() => {
                    if (!on) {
                      setChildId(c.child_profile_id);
                      toast({ icon: "spark", text: `Viewing ${c.first_name || "child"}` });
                    }
                  }}
                >
                  <span>{c.first_name || "Child"}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* scroll body — re-keyed on tab + child so per-screen state resets */}
      <div className="m-scroll" key={tab + "·" + (childId || "")}>
        <div className="m-view-enter">
          {tournament ? (
            <TournamentView
              slug={tournament.slug}
              tournamentId={tournament.id}
              onBack={() => setTournament(null)}
              toast={toast}
            />
          ) : isGuardian && tab === "matches" ? (
            <GuardianMatches
              childId={activeChild?.child_profile_id || null}
              childFirst={activeChild?.first_name || "your child"}
              toast={toast}
            />
          ) : isGuardian && tab === "league" ? (
            <GuardianLeague
              childId={activeChild?.child_profile_id || null}
              childFirst={activeChild?.first_name || "your child"}
            />
          ) : isGuardian && tab === "membership" ? (
            <GuardianMembership
              childId={activeChild?.child_profile_id || null}
              childFirst={activeChild?.first_name || "your child"}
              toast={toast}
            />
          ) : isGuardian && tab === "more" ? (
            moreView === "documents" ? (
              <GuardianDocs
                childId={activeChild?.child_profile_id || null}
                childFirst={activeChild?.first_name || "your child"}
                toast={toast}
                onBack={() => setMoreView(null)}
              />
            ) : moreView === "schedule" ? (
              <GuardianSchedule
                childId={activeChild?.child_profile_id || null}
                childFirst={activeChild?.first_name || "your child"}
                toast={toast}
                onBack={() => setMoreView(null)}
              />
            ) : moreView === "notices" ? (
              <GuardianNotices
                childId={activeChild?.child_profile_id || null}
                childFirst={activeChild?.first_name || "your child"}
                toast={toast}
                onBack={() => setMoreView(null)}
                onUnreadChange={setNoticesUnread}
              />
            ) : moreView === "team" ? (
              <GuardianTeam
                childId={activeChild?.child_profile_id || null}
                childFirst={activeChild?.first_name || "your child"}
                onBack={() => setMoreView(null)}
              />
            ) : (
              <GuardianMore
                childFirst={activeChild?.first_name || "your child"}
                noticesUnread={noticesUnread}
                onOpenTeam={() => setMoreView("team")}
                onOpenDocuments={() => setMoreView("documents")}
                onOpenSchedule={() => setMoreView("schedule")}
                onOpenNotices={() => setMoreView("notices")}
                onOpenProfile={() => setSheet("profile")}
              />
            )
          ) : role.key === "operator" && tab === "tonight" ? (
            <OperationsTonight
              venueId={role.entityId}
              venueName={role.name}
              toast={toast}
            />
          ) : role.key === "operator" && tab === "bookings" ? (
            <OperatorBookings
              venueId={role.entityId}
              venueName={role.name}
              toast={toast}
            />
          ) : role.key === "operator" && tab === "payments" ? (
            <OperatorPayments
              venueId={role.entityId}
              venueName={role.name}
              toast={toast}
            />
          ) : role.key === "operator" && tab === "people" ? (
            <OperatorPeople
              venueId={role.entityId}
              venueName={role.name}
              roleSub={role.sub}
              toast={toast}
            />
          ) : role.key === "operator" && tab === "more" ? (
            moreView === "cups" ? (
              <OperatorTournaments
                venueId={role.entityId}
                venueName={role.name}
                onOpenTournament={(slug, id) => setTournament({ slug, id })}
                onBack={() => setMoreView(null)}
                toast={toast}
              />
            ) : moreView === "setup" ? (
              <OperatorSetup
                venueId={role.entityId}
                venueName={role.name}
                onNavigate={(t) => { setMoreView(null); setTab(t); }}
                onBack={() => setMoreView(null)}
                toast={toast}
              />
            ) : (
              <OperatorMore
                roleSub={role.sub}
                venueName={role.name}
                onOpenProfile={() => setSheet("profile")}
                onOpenCups={() => setMoreView("cups")}
                onOpenSetup={() => setMoreView("setup")}
                toast={toast}
              />
            )
          ) : role.key === "club_admin" && tab === "today" ? (
            <ClubAdminToday
              venueToken={role.entityId}
              clubId={role.clubId}
              clubName={role.name}
              toast={toast}
            />
          ) : role.key === "club_admin" && tab === "people" ? (
            <ClubAdminPeople
              venueToken={role.entityId}
              clubId={role.clubId}
              clubName={role.name}
              toast={toast}
            />
          ) : role.key === "club_admin" && tab === "money" ? (
            <ClubAdminMoney
              venueToken={role.entityId}
              clubId={role.clubId}
              clubName={role.name}
              toast={toast}
            />
          ) : role.key === "club_admin" && tab === "comms" ? (
            <ClubAdminComms
              venueToken={role.entityId}
              clubId={role.clubId}
              clubName={role.name}
              toast={toast}
            />
          ) : role.key === "club_admin" && tab === "more" ? (
            moreView === "schedule" ? (
              <ClubAdminSchedule venueToken={role.entityId} clubId={role.clubId} clubName={role.name} toast={toast} onBack={() => setMoreView(null)} />
            ) : moreView === "memberships" ? (
              <ClubAdminMemberships venueToken={role.entityId} clubId={role.clubId} clubName={role.name} toast={toast} onBack={() => setMoreView(null)} />
            ) : moreView === "clubpage" ? (
              <ClubAdminClubPage venueToken={role.entityId} clubId={role.clubId} clubName={role.name} toast={toast} onBack={() => setMoreView(null)} />
            ) : moreView === "safeguarding" ? (
              <ClubAdminSafeguarding venueToken={role.entityId} clubId={role.clubId} clubName={role.name} toast={toast} onBack={() => setMoreView(null)} />
            ) : (
              <ClubAdminMore
                clubName={role.name}
                onOpenSchedule={() => setMoreView("schedule")}
                onOpenMemberships={() => setMoreView("memberships")}
                onOpenClubPage={() => setMoreView("clubpage")}
                onOpenSafeguarding={() => setMoreView("safeguarding")}
                onOpenProfile={() => setSheet("profile")}
              />
            )
          ) : role.key === "referee" && tab === "fixtures" ? (
            <RefFixtures onOpenMatch={setRefMatch} toast={toast} />
          ) : role.key === "team_manager" && tab === "league" ? (
            <TeamManagerLeague toast={toast} />
          ) : role.key === "team_manager" && tab === "tonight" ? (
            <TeamManagerTonight toast={toast} />
          ) : role.key === "team_manager" && tab === "people" ? (
            <TeamManagerPeople toast={toast} />
          ) : role.key === "member" ? (
            tab === "stats" ? (
              // Own reliability/POTM (Phase B). Self-scopes server-side via auth.uid,
              // so it renders without waiting on the member_get_self profile id.
              <MemberReliability toast={toast} />
            ) : !selfProfileId ? (
              <div className="m-card" style={{ marginTop: 8 }}>
                <div className="m-eyebrow">{TAB_META[tab]?.title}</div>
                <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading your club…</p>
              </div>
            ) : tab === "matches" ? (
              <GuardianMatches childId={selfProfileId} childFirst={selfFirst} toast={toast} selfMode />
            ) : tab === "membership" ? (
              <GuardianMembership childId={selfProfileId} childFirst={selfFirst} toast={toast} selfMode selfClubId={role.clubId} />
            ) : (
              // "schedule" (default member tab) — own training + fixtures in/out.
              <GuardianSchedule childId={selfProfileId} childFirst={selfFirst} toast={toast} selfMode selfClubs={role.clubs} />
            )
          ) : (
            <div className="m-card">
              <div className="m-eyebrow">{TAB_META[tab]?.title}</div>
              <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>
                Foundation ready. The <strong style={{ color: "var(--ink)" }}>{TAB_META[tab]?.title}</strong>{" "}
                screen for the <strong style={{ color: "var(--amber)" }}>{role.key.replace("_", " ")}</strong>{" "}
                role mounts here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* floating role-aware tab bar — hidden while the officiating overlay is open */}
      {!refMatch && (
      <div className="m-tabbar">
        {tabs.map((id) => {
          const m = TAB_META[id];
          const on = tab === id;
          return (
            <button
              key={id}
              className={"m-tab" + (on ? " on" : "")}
              onClick={() => {
                if (id === "more" && (isGuardian || role.key === "operator" || role.key === "club_admin")) { setTab("more"); setMoreView(null); }
                else if (id === "more") setSheet("profile");
                else setTab(id);
              }}
            >
              <MIcon name={m.icon} size={23} />
              <span className="m-tlabel">{m.label}</span>
            </button>
          );
        })}
      </div>
      )}

      {/* referee officiating overlay — full-screen iframe of the existing ref app */}
      {refMatch && <RefMatch game={refMatch} onBack={() => setRefMatch(null)} />}

      {/* toasts */}
      {toasts.length > 0 && (
        <div className="m-toast-wrap">
          {toasts.map((t) => (
            <div key={t.id} className="m-toast">
              <div
                style={{
                  width: 30, height: 30, borderRadius: "var(--r-sm)", flex: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--amber-soft)",
                }}
              >
                <MIcon name={t.icon || "check"} size={17} color="var(--amber)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t.text}</div>
                {t.sub && <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>{t.sub}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* sheets */}
      {sheet === "profile" && (
        <ProfileSheet
          name={displayName}
          email={authUser?.email}
          role={role}
          roles={roles}
          roleIdx={roleIdx}
          onPickRole={(i) => { setRoleIdx(i); setSheet(null); }}
          world={world}
          children={children}
          childId={activeChildId}
          childFirst={activeChild?.first_name || "your child"}
          onPickChild={setChildId}
          onGoToMembership={isGuardian ? () => { setTab("membership"); setSheet(null); } : undefined}
          onSignOut={onSignOut}
          toast={toast}
          pref={pref}
          onPref={setPref}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet && typeof sheet !== "string" && sheet}

      {/* Push opt-in — shared modal, amber-themed for the /hub shell. Inside the
          data-surface="mobile" wrapper so the amber tokens resolve. */}
      <PushOptInModal
        open={showPushModal}
        tone="amber"
        state={pushState}
        bullets={[
          "Club and team announcements",
          "Schedule, pitch or kick-off changes",
          "Booking and payment updates",
        ]}
        subscribedText="We'll send these straight to your phone."
        deniedText="Turn them on in your device settings to start getting pinged."
        onAllow={handlePushAllow}
        onNotNow={handlePushNotNow}
        onNever={handlePushNever}
        onClose={() => setShowPushModal(false)}
      />
    </div>
  );
}
