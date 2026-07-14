// ProfileSheet.jsx — the guardian (and operator / team-manager) Profile panel.
//
// The LAST guardian screen from design_handoff_guardian_app ("Screen: Profile").
// It is a bottom SHEET (the prototype renders Profile as a sheet too), opened from
// the header avatar and from More → "Profile & settings". It grows the Phase-0
// stub: identity + appearance + the multi-hat picker were already here; this adds
// "Your children", a compact membership + Payments deep-link, a single honest
// notifications toggle, a Help/Sign-out account block, and — the headline — a
// universal context switcher.
//
// NOTHING new is added server-side: every section re-presents data the app already
// holds. children = world.guardian_of (drives the existing switcher); membership =
// get_my_money() (exactly screen 3); notifications = enable/disableMemberPush
// (mig 422); appearance + sign-out already worked. Delete-account reuses the
// existing delete_my_account_auth RPC (mig 370) — no new server surface.
//
// SHELL-UNIFY PR #4c-followup: both visibility AND render now flow from the shared
// profile registry (components/profile/sections.js). The hub `ctx` drives
// visible(ctx); the BODY map renders each id in the hub's amber chrome; the sheet
// iterates HUB_ORDER. Help + Account are split (their own registry sections), the
// squad fetch is the shared usePlayerTeams hook, and the authed Delete-account path
// lands here. Casual (PR #4d) will supply its own BODY map against the SAME registry.
//
// CONTEXT SWITCHER (operator-requested) — detects EVERY hat the person holds and
// opens the CORRECT, current screen, styled in the amber mobile theme:
//   • guardian / operator / team-manager / referee → switch IN-PLACE in /hub (the new
//                                            amber screens) via roleIdx — no reload.
//   • casual / league football squads      → the live player app  (/p/<token>)
//   • club / gym memberships               → the live club view   (/sessions?club=)
// (The casual app's gold ContextSwitcher is untouched — this is its amber, mobile-
// correct sibling, scoped entirely inside [data-surface="mobile"].)

import { useState, useEffect, useRef, Fragment } from "react";
import { getMyMoney } from "@platform/core";
import { deleteMyAccountAuth } from "@platform/core/storage/supabase.js";
import { enableMemberPush, disableMemberPush } from "../native/native-push.js";
import MIcon from "./icons.jsx";
import MobileSheet from "./MobileSheet.jsx";
import SharedContextSwitcher from "../components/SharedContextSwitcher.jsx";
import { visibleSections, HUB_ORDER } from "../components/profile/sections.js";
import { usePlayerTeams } from "../hooks/usePlayerTeams.js";
import { contextSubline, roleLabel, buildSwitcherSections } from "./nav.js";

// HSL crest tint from a name hash — the established grassroots-crest pattern
// (Matches / League / Team screens). Hex would trip the hygiene hook; HSL is fine.
function hueFor(str) {
  let h = 0; const s = String(str || "x");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function initial(name) { return name ? String(name).trim().slice(0, 1).toUpperCase() : "?"; }
function gbp(pence) { return "£" + (Math.abs(pence || 0) / 100).toFixed(2).replace(/\.00$/, ""); }

function Crest({ name, size = 36 }) {
  const hue = hueFor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: 10, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg, hsl(${hue} 50% 42%), hsl(${(hue + 30) % 360} 48% 30%))`,
      color: "white", fontWeight: 800, fontSize: Math.round(size * 0.4),
    }}>
      {initial(name)}
    </div>
  );
}

// One tappable card row (matches GuardianMore's row visual language). titleColor
// overrides the default ink title (used by the danger Delete-account row).
function PanelRow({ iconName, iconNode, title, sub, trailing, onClick, active, titleColor }) {
  return (
    <button
      onClick={onClick}
      className="m-card"
      style={{
        width: "100%", textAlign: "left", cursor: onClick ? "pointer" : "default",
        padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12,
        fontFamily: "var(--m-font)", color: "inherit",
        borderColor: active ? "var(--amber-glow)" : "var(--hair)",
      }}>
      {iconNode || (
        <div style={{
          width: 36, height: 36, borderRadius: 10, flex: "none", display: "flex",
          alignItems: "center", justifyContent: "center",
          background: active ? "var(--amber-soft)" : "var(--s4)",
        }}>
          <MIcon name={iconName} size={18} color={active ? "var(--amber)" : "var(--ink2)"} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: titleColor || "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{sub}</div>}
      </div>
      {trailing}
    </button>
  );
}

function Eyebrow({ children, style }) {
  return <div className="m-eyebrow" style={{ margin: "20px 2px 10px", ...style }}>{children}</div>;
}

export default function ProfileSheet({
  name, email, role, roles, roleIdx, onPickRole,
  world, children = [], childId, childFirst, onPickChild,
  pref, onPref, onGoToMembership, onSignOut, toast, onClose,
}) {
  const isGuardian = role?.key === "guardian";

  // Cross-surface football squads (casual + league) — tokens are NOT in get_my_world.
  // The shared hook fetches them (player_get_teams), identically to the casual switcher.
  const { teams: squads } = usePlayerTeams();

  // Club memberships are NOT listed separately any more — the `member` hat groups
  // into its club's entity row (dedup). Referee is a first-class /hub hat rendered
  // in-place, not a deep-link. So the only cross-surface links left are the casual/
  // league football squads (the live player app), built below.

  // Compact membership for the active child (guardian only) — same source as screen 3.
  const [money, setMoney] = useState(null);
  useEffect(() => {
    if (!isGuardian || !childId) { setMoney(null); return; }
    let alive = true;
    getMyMoney()
      .then((m) => {
        if (!alive) return;
        setMoney({
          memberships: (m.memberships || []).filter((x) => x.member_profile_id === childId),
          charges: (m.charges || []).filter((x) => x.member_profile_id === childId),
        });
      })
      .catch(() => { if (alive) setMoney(null); });
    return () => { alive = false; };
  }, [isGuardian, childId]);

  // Notifications — ONE honest master toggle (the backend is a single push sub, not
  // per-category). Mirrors MemberProfile's localStorage-mirrored state.
  const [notif, setNotifRaw] = useState(() => {
    try { return localStorage.getItem("member_notif") || "idle"; } catch { return "idle"; }
  });
  const setNotif = (s) => {
    try { s === "idle" ? localStorage.removeItem("member_notif") : localStorage.setItem("member_notif", s); } catch { /* noop */ }
    setNotifRaw(s);
  };
  const [notifBusy, setNotifBusy] = useState(false);
  const notifOn = notif === "subscribed";
  const toggleNotif = async () => {
    if (notifBusy) return;
    setNotifBusy(true);
    try {
      if (notifOn) {
        await disableMemberPush();
        setNotif("idle");
      } else {
        const r = await enableMemberPush({
          onRegistered: () => setNotif("subscribed"),
          onError: () => setNotif("idle"),
        });
        if (r === "registering") { /* native: outcome arrives via callbacks */ }
        else if (r === "subscribed") setNotif("subscribed");
        else if (r === "denied") { setNotif("denied"); toast?.({ icon: "bell", text: "Notifications blocked", sub: "Enable them in your device settings" }); }
        else { setNotif("idle"); toast?.({ icon: "bell", text: "Not supported on this device" }); }
      }
    } catch (e) {
      console.error("[profile] notification toggle failed", e);
      setNotif("idle");
    } finally {
      setNotifBusy(false);
    }
  };

  const go = (href) => { window.location.href = href; };

  // Delete account (authed path). Hub users always hold a session, so this calls
  // deleteMyAccountAuth() — auth.uid()-scoped anonymisation + service-role auth-row
  // delete, and it signs out internally — NEVER the casual token path. The typed
  // DELETE check is the confirmation gate (no OTP step-up needed: the session is
  // guaranteed on hub). last_admin is surfaced with the same copy as casual.
  const [showDelete, setShowDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  // Double-fire guard via ref (the CLAUDE.md convention for irreversible actions) —
  // closes the sub-frame window before the disabled button re-renders. The RPC is
  // auth.uid()-scoped + idempotent, so a duplicate call is already benign; the ref
  // makes a second call impossible rather than merely harmless.
  const deletingRef = useRef(false);
  const canDelete = deleteText.trim().toUpperCase() === "DELETE";
  const handleDelete = async () => {
    if (!canDelete || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true); setDeleteError(null);
    try {
      await deleteMyAccountAuth();
      go("/");
    } catch (e) {
      if (e?.code === "last_admin") {
        const n = e.teamIds?.length || 1;
        setDeleteError(`You're the only admin on ${n} team${n === 1 ? "" : "s"}. Hand over admin first.`);
      } else {
        setDeleteError("Couldn't delete — try again.");
        console.error("[profile] account delete failed", e);
      }
    } finally {
      setDeleting(false);
      deletingRef.current = false;
    }
  };

  // One row per ENTITY (club / venue / team / family), roles at the same entity
  // collapsed in (switched via the header role pill). Casual/league football squads
  // stay cross-surface links (they open the live player app), tagged type "squad"
  // so they slot into the same sectioned list.
  // The hub switch strategy: role rows switch IN-PLACE (onPickRole); tapping the
  // CURRENT context closes the sheet (preserved from the old inline switcher). Squad
  // rows deep-link to the live player app. Both shells now render from the ONE
  // registry (nav.js buildSwitcherSections) — a new hat appears here for free.
  const squadItems = squads.map((s, i) => ({
    key: "squad:" + s.team_id + ":" + i, type: "squad", iconName: "figure",
    title: s.team_name || "Your squad",
    sub: (s.is_competitive ? "League" : "Casual") + " football",
    onSelect: () => go(`/p/${s.token}`),
  }));
  const switcherSections = buildSwitcherSections({
    roles, activeRoleIdx: roleIdx, squadItems,
    onPickEntity: (ent) => {
      const activeHere = ent.roles.some((x) => x.idx === roleIdx);
      return () => (activeHere ? onClose() : onPickRole(ent.roles[0].idx));
    },
  });
  const hasSwitcher = switcherSections.reduce((n, sec) => n + sec.items.length, 0) > 1;
  const membership = money?.memberships?.[0] || null;
  const owedPence = (money?.charges || [])
    .filter((c) => ["unpaid", "partial"].includes(c.status))
    .reduce((sum, c) => sum + (c.amount_pence || 0), 0);

  // Section visibility + render both flow from the shared profile registry (D6). The
  // hub `ctx` drives visible(ctx); BODY maps each id to its amber chrome; the sheet
  // iterates HUB_ORDER so a new section, or a changed visibility rule, propagates
  // from sections.js to both shells.
  const ctx = {
    authState: "authed",
    worldLoadState: world?.ok === true ? "loaded" : "loading",
    isAdminView: false,
    me: null,
    isGuardian,
    childId: childId ?? null,
    childrenCount: children.length,
    canSwitch: hasSwitcher,
    canAppearance: true,
  };

  // One Body per section id — called only when the registry says the section is
  // visible, so a hidden section's body never runs (matches the old && short-circuit).
  const BODY = {
    identity: () => (
      <div className="m-card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="m-avatar" style={{ cursor: "default" }}>{initial(name)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
          {email && <div style={{ fontSize: 12.5, color: "var(--ink3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{email}</div>}
          {role && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
              <span style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase",
                padding: "3px 8px", borderRadius: "var(--r-pill)",
                background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
              }}>
                {roleLabel(role)}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink3)", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {contextSubline(role, children.find((c) => c.child_profile_id === childId) || children[0])}
              </span>
            </div>
          )}
        </div>
      </div>
    ),

    // universal context switcher — the SHARED presentational body. One row per ENTITY
    // (roles at the same entity collapse in, switched via onPickRole); the play-vs-
    // referee clash banner now renders here too.
    "switch-context": () => (
      <SharedContextSwitcher
        variant="hub"
        sections={switcherSections}
        conflicts={world?.conflicts ?? []}
        renderIcon={(name, o) => <MIcon name={name} size={o.size} color={o.color} />}
      />
    ),

    children: () => (
      <>
        <Eyebrow>Your children</Eyebrow>
        {children.map((c) => {
          const cname = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Your child";
          const on = c.child_profile_id === childId;
          return (
            <PanelRow
              key={c.child_profile_id}
              iconNode={<Crest name={cname} />}
              title={cname}
              active={on}
              trailing={on
                ? <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "3px 9px", borderRadius: "var(--r-pill)", background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)" }}>Active</span>
                : <MIcon name="chevron" size={16} color="var(--ink4)" />}
              onClick={() => {
                if (!on) { onPickChild?.(c.child_profile_id); toast?.({ icon: "spark", text: `Viewing ${c.first_name || "child"}` }); onClose(); }
                else onClose();
              }}
            />
          );
        })}
      </>
    ),

    membership: () => (
      <>
        <Eyebrow>Membership</Eyebrow>
        {membership ? (
          <div style={{
            borderRadius: 16, padding: "14px 15px", color: "white", overflow: "hidden",
            background: `linear-gradient(135deg, hsl(${hueFor(membership.club_name || childFirst || "club")} 44% 32%) 0%, hsl(${hueFor(membership.club_name || childFirst || "club")} 44% 22%) 70%)`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {membership.club_name || "Club"}
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>{childFirst || "Member"}</div>
                <div style={{ fontSize: 11.5, opacity: 0.78, marginTop: 2 }}>{membership.tier_name || "Member"}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: "var(--r-pill)", textTransform: "capitalize", background: "rgba(255,255,255,0.2)" }}>
                {membership.status === "ending" ? "Ending" : membership.status === "paused" ? "Paused" : "Active"}
              </span>
            </div>
          </div>
        ) : (
          <div className="m-card" style={{ padding: "13px 14px", color: "var(--ink3)", fontSize: 13 }}>
            {childFirst || "Your child"} isn't enrolled in a paid membership yet.
          </div>
        )}
        <PanelRow
          iconName="pound"
          title="Payments"
          sub={owedPence > 0 ? `${gbp(owedPence)} outstanding` : "Fees, history & pay now"}
          trailing={owedPence > 0
            ? <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: "var(--r-pill)", background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)" }}>{gbp(owedPence)}</span>
            : <MIcon name="chevron" size={16} color="var(--ink4)" />}
          onClick={() => onGoToMembership?.()}
        />
      </>
    ),

    appearance: () => (
      <>
        <Eyebrow>Appearance</Eyebrow>
        <div style={{ display: "flex", gap: 8 }}>
          {["light", "dark", "system"].map((opt) => {
            const on = pref === opt;
            return (
              <button
                key={opt}
                onClick={() => onPref(opt)}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: "var(--r-md)",
                  background: on ? "var(--amber-soft)" : "var(--s2)",
                  border: "1px solid " + (on ? "var(--amber-glow)" : "var(--hair)"),
                  color: on ? "var(--amber)" : "var(--ink2)",
                  fontSize: 13.5, fontWeight: 600, textTransform: "capitalize", cursor: "pointer",
                  fontFamily: "var(--m-font)",
                }}>
                {opt === "system" ? "Auto" : opt}
              </button>
            );
          })}
        </div>
      </>
    ),

    notifications: () => (
      <>
        <Eyebrow>Notifications</Eyebrow>
        <div className="m-card" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MIcon name="bell" size={18} color="var(--ink2)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>Push notifications</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>
              {notif === "denied" ? "Blocked — enable in device settings" : notifOn ? "On — reminders & club notices" : "Match reminders & club notices"}
            </div>
          </div>
          <button
            onClick={toggleNotif}
            disabled={notifBusy}
            role="switch"
            aria-checked={notifOn}
            aria-label="Toggle notifications"
            style={{
              flex: "none", width: 46, height: 28, borderRadius: 999, cursor: notifBusy ? "default" : "pointer",
              border: "1px solid " + (notifOn ? "var(--amber-glow)" : "var(--hair2)"),
              background: notifOn ? "var(--amber)" : "var(--s3)", position: "relative", transition: "background .15s",
              opacity: notifBusy ? 0.6 : 1,
            }}>
            <span style={{
              position: "absolute", top: 2, left: notifOn ? 20 : 2, width: 22, height: 22, borderRadius: "50%",
              background: "white", transition: "left .15s",
            }} />
          </button>
        </div>
      </>
    ),

    help: () => (
      <>
        <Eyebrow>Help</Eyebrow>
        <PanelRow
          iconName="mail" title="Help & support" sub="Get in touch with the team"
          trailing={<MIcon name="arrow" size={16} color="var(--ink4)" />}
          onClick={() => go("mailto:hello@in-or-out.com")}
        />
      </>
    ),

    account: () => (
      <>
        <Eyebrow>Account</Eyebrow>
        <PanelRow
          iconNode={<div style={{ width: 36, height: 36, borderRadius: 10, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}><MIcon name="out" size={18} color="var(--ink2)" /></div>}
          title="Sign out"
          onClick={() => onSignOut?.()}
        />
        <PanelRow
          iconNode={<div style={{ width: 36, height: 36, borderRadius: 10, flex: "none", background: "var(--live-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><MIcon name="trash" size={18} color="var(--live)" /></div>}
          title="Delete my account"
          titleColor="var(--live)"
          sub="Permanently remove your account"
          onClick={() => { setDeleteText(""); setDeleteError(null); setShowDelete(true); }}
        />
      </>
    ),
  };

  return (
    <MobileSheet title="Profile" onClose={onClose}>
      {visibleSections(HUB_ORDER, ctx).map((s) => (
        <Fragment key={s.id}>{BODY[s.id]?.()}</Fragment>
      ))}

      {/* Delete-account confirm — a nested MobileSheet so it portals to #m-sheet-host
          and stacks above the profile sheet + docked nav (the iOS stacking trap). */}
      {showDelete && (
        <MobileSheet title="Delete account" onClose={() => { if (!deleting) setShowDelete(false); }}>
          <div className="m-card" style={{ padding: "14px 15px", borderColor: "var(--live-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <MIcon name="alert" size={20} color="var(--live)" />
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>This can't be undone</div>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5 }}>
              Your name is replaced with "Deleted player" in every team, your sign-in is
              removed, and you'll be signed out. Match history stays but is anonymised.
            </div>
          </div>
          <Eyebrow>Type DELETE to confirm</Eyebrow>
          <input
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="DELETE"
            style={{
              width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: "var(--r-md)",
              background: "var(--s2)", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15,
              border: "1px solid " + (canDelete ? "var(--live)" : "var(--hair)"), outline: "none",
            }}
          />
          {deleteError && (
            <div style={{ fontSize: 12.5, color: "var(--live)", margin: "8px 2px 0", lineHeight: 1.4 }}>{deleteError}</div>
          )}
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            style={{
              width: "100%", marginTop: 14, padding: "13px 0", borderRadius: "var(--r-md)",
              background: canDelete && !deleting ? "var(--live)" : "var(--s3)",
              color: canDelete && !deleting ? "white" : "var(--ink4)",
              border: "none", fontFamily: "var(--m-font)", fontSize: 15, fontWeight: 800,
              cursor: !canDelete || deleting ? "default" : "pointer",
            }}>
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
          <button
            onClick={() => { if (!deleting) setShowDelete(false); }}
            style={{
              width: "100%", marginTop: 8, padding: "12px 0", borderRadius: "var(--r-md)",
              background: "transparent", color: "var(--ink3)", border: "1px solid var(--hair)",
              fontFamily: "var(--m-font)", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
            Cancel
          </button>
        </MobileSheet>
      )}
    </MobileSheet>
  );
}
