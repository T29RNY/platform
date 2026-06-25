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
import "./theme/mobile-tokens.css";
import { useMobileTheme } from "./theme/useMobileTheme.js";
import { resolveRoles, tabsFor, TAB_META, contextSubline } from "./nav.js";
import MIcon from "./icons.jsx";
import MobileSheet from "./MobileSheet.jsx";
import GuardianMatches from "./screens/GuardianMatches.jsx";
import GuardianLeague from "./screens/GuardianLeague.jsx";

function initials(name) {
  if (!name) return "?";
  const w = String(name).split(/\s+/).filter(Boolean);
  if (w.length === 0) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

export default function MobileShell({ world, authUser, route }) {
  const { pref, resolved, setPref } = useMobileTheme();

  // Resolve hats once from the server payload. Highest-rank role is the default.
  const roles = useMemo(() => resolveRoles(world), [world]);
  const [roleIdx, setRoleIdx] = useState(0);
  const role = roles[roleIdx] || null;

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

  const [sheet, setSheet] = useState(null); // null | 'profile' | node
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((opts) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2700);
  }, []);

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

  return (
    <div data-surface="mobile" data-theme={resolved} className="m-app">
      {/* header */}
      <div className="m-hdr">
        <div className="m-hdr-row">
          <button className="m-avatar" onClick={() => setSheet("profile")} aria-label="Profile">
            {initials(displayName)}
          </button>
          <div className="m-hdr-title">
            <div className="m-title">{TAB_META[tab]?.title || "Home"}</div>
            <div className="m-sub">
              <span>{contextSubline(role, activeChild)}</span>
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
          {isGuardian && tab === "matches" ? (
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

      {/* floating role-aware tab bar */}
      <div className="m-tabbar">
        {tabs.map((id) => {
          const m = TAB_META[id];
          const on = tab === id;
          return (
            <button
              key={id}
              className={"m-tab" + (on ? " on" : "")}
              onClick={() => (id === "more" ? setSheet("profile") : setTab(id))}
            >
              <MIcon name={m.icon} size={23} />
              <span className="m-tlabel">{m.label}</span>
            </button>
          );
        })}
      </div>

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
          roles={roles}
          roleIdx={roleIdx}
          onPickRole={(i) => { setRoleIdx(i); setSheet(null); }}
          pref={pref}
          onPref={setPref}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet && typeof sheet !== "string" && sheet}
    </div>
  );
}

// Minimal Phase 0 profile sheet: identity, appearance (proves theme switching),
// and — only when the person holds more than one hat — a context picker (NOT the
// prototype role switcher; this is the real multi-hat chooser, surfaced only when
// real data shows multiple roles).
function ProfileSheet({ name, email, roles, roleIdx, onPickRole, pref, onPref, onClose }) {
  return (
    <MobileSheet title="Profile" onClose={onClose}>
      <div className="m-card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="m-avatar" style={{ cursor: "default" }}>{name ? name.slice(0, 1).toUpperCase() : "?"}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{name}</div>
          {email && <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>{email}</div>}
        </div>
      </div>

      {roles.length > 1 && (
        <>
          <div className="m-eyebrow" style={{ margin: "20px 2px 10px" }}>Your roles</div>
          {roles.map((r, i) => (
            <button
              key={r.key + ":" + i}
              className="m-card"
              onClick={() => onPickRole(i)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                marginBottom: 8, cursor: "pointer", textAlign: "left",
                borderColor: i === roleIdx ? "var(--amber-glow)" : "var(--hair)",
              }}
            >
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
                {r.name} <span style={{ color: "var(--ink3)", fontWeight: 400 }}>· {r.key.replace("_", " ")}</span>
              </span>
              {i === roleIdx && <MIcon name="check" size={18} color="var(--amber)" />}
            </button>
          ))}
        </>
      )}

      <div className="m-eyebrow" style={{ margin: "20px 2px 10px" }}>Appearance</div>
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
              }}
            >
              {opt === "system" ? "Auto" : opt}
            </button>
          );
        })}
      </div>
    </MobileSheet>
  );
}
