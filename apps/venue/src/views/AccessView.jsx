import React, { useState, useEffect, useCallback } from "react";
import { venueListAdmins, venueInviteAdmin, venueUpdateAdmin, venueRevokeAdmin } from "@platform/core/storage/supabase.js";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { getInitials } from "../lib/format.js";

// The 5 gated capabilities (mig 237/238). Everything else is open to any member.
const CAPS = [
  { key: "reverse_money",    label: "Reverse money",          hint: "refunds, undo payments, void charges" },
  { key: "booking_settings", label: "Booking settings",       hint: "hours, slot length, pricing, on/off" },
  { key: "manage_facility",  label: "Pitches, refs & display", hint: "facility & reception-display setup" },
  { key: "staff_directory",  label: "Staff directory",         hint: "the contact address book" },
  { key: "manage_logins",    label: "Manage logins",           hint: "invite & manage people" },
];
const ROLES = ["owner", "manager", "staff"];
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Effective capability for a row = role default, overlaid with per-person grant/deny.
function effCap(role, grant = [], deny = [], cap) {
  if (role === "owner") return true;
  if ((deny || []).includes(cap)) return false;
  if ((grant || []).includes(cap)) return true;
  return role === "manager";
}
// Normalise a desired capability set back into minimal grant/deny arrays.
function normalize(role, desired) {
  const grant = [], deny = [];
  for (const c of CAPS) {
    const def = role !== "staff";            // owner/manager default ON, staff OFF
    const want = desired.has(c.key);
    if (want && !def) grant.push(c.key);
    if (!want && def) deny.push(c.key);
  }
  return { grant, deny };
}
function humanErr(e) {
  const m = e?.message || "";
  if (m.includes("insufficient_role")) return "You don’t have permission to manage access.";
  if (m.includes("last_owner")) return "You can’t remove or demote the only owner.";
  if (m.includes("already_member")) return "That email already has access here.";
  if (m.includes("role_above_caller") || m.includes("target_above_caller")) return "You can only manage staff.";
  if (m.includes("cap_not_grantable")) return "You can’t grant a permission you don’t hold yourself.";
  if (m.includes("email_required")) return "Enter an email address.";
  return "Something went wrong — try again.";
}

export default function AccessView({ venueToken, me }) {
  const callerRole = me?.mode === "token" ? "owner" : (me?.role || "staff");
  const callerCan = (cap) => (me?.mode === "token" ? true : effCap(me?.role, me?.capsGrant, me?.capsDeny, cap));
  const canManage = (t) => callerRole === "owner" || (callerRole === "manager" && t.role === "staff");
  const assignableRoles = callerRole === "owner" ? ROLES : ["staff"];

  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("staff");

  const load = useCallback(async () => {
    try { const r = await venueListAdmins(venueToken); setAdmins(r?.admins ?? []); }
    catch (e) { setError(humanErr(e)); setAdmins([]); }
  }, [venueToken]);
  useEffect(() => { load(); }, [load]);

  const onRole = async (a, role) => {
    setBusy(a.id); setError(null);
    try { await venueUpdateAdmin(venueToken, a.id, role); await load(); }
    catch (e) { setError(humanErr(e)); } finally { setBusy(null); }
  };
  const onToggleCap = async (a, cap) => {
    const desired = new Set(CAPS.filter((c) => effCap(a.role, a.caps_grant, a.caps_deny, c.key)).map((c) => c.key));
    if (effCap(a.role, a.caps_grant, a.caps_deny, cap)) desired.delete(cap); else desired.add(cap);
    const { grant, deny } = normalize(a.role, desired);
    setBusy(a.id); setError(null);
    try { await venueUpdateAdmin(venueToken, a.id, null, grant, deny); await load(); }
    catch (e) { setError(humanErr(e)); } finally { setBusy(null); }
  };
  const onRemove = async (a) => {
    if (!window.confirm(`Remove ${a.email}? They’ll lose access immediately.`)) return;
    setBusy(a.id); setError(null);
    try { await venueRevokeAdmin(venueToken, a.id); await load(); }
    catch (e) { setError(humanErr(e)); } finally { setBusy(null); }
  };
  const onInvite = async (e) => {
    e.preventDefault();
    if (!invEmail.trim()) return;
    setBusy("invite"); setError(null);
    try {
      await venueInviteAdmin(venueToken, invEmail.trim(), invRole);
      setInvEmail(""); setInvRole("staff"); setInviteOpen(false); await load();
    } catch (err) { setError(humanErr(err)); } finally { setBusy(null); }
  };

  if (admins === null) return <div className="text-mute" style={{ padding: 24 }}>Loading access…</div>;

  return (
    <div className="access">
      {error && <div className="banner banner-warn" style={{ marginBottom: "var(--gap)" }}>{error}</div>}

      <SectionHead label="Access" count={admins.length}>
        <button className="btn btn-sm btn-primary" onClick={() => setInviteOpen((v) => !v)}>
          <Icon name="plus" size={14} /> Invite
        </button>
      </SectionHead>

      {inviteOpen && (
        <form className="access-invite" onSubmit={onInvite}>
          <input className="input" type="email" placeholder="colleague@email.com" autoFocus
                 value={invEmail} onChange={(e) => setInvEmail(e.target.value)} />
          <select className="input" value={invRole} onChange={(e) => setInvRole(e.target.value)}>
            {assignableRoles.map((r) => <option key={r} value={r}>{cap1(r)}</option>)}
          </select>
          <button className="btn btn-primary" type="submit" disabled={busy === "invite"}>
            {busy === "invite" ? "Sending…" : "Send invite"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setInviteOpen(false)}>Cancel</button>
        </form>
      )}

      {admins.length === 0 ? (
        <EmptyState title="No one yet" body="Invite a colleague to give them access." />
      ) : (
        <div className="access-list">
          {admins.map((a) => {
            const manage = canManage(a) && !a.is_self;
            return (
              <div className="access-row" key={a.id}>
                <div className="who">
                  <div className="avatar">{getInitials(a.email)}</div>
                  <div className="meta">
                    <div className="email">{a.email}{a.is_self && <span className="tag-you">you</span>}</div>
                    <div className="sub">{a.status === "invited" ? "Invited · activates on first sign-in" : "Active"}</div>
                  </div>
                </div>
                <div className="ctrl">
                  <select className="input input-sm" value={a.role} disabled={!manage || busy === a.id}
                          onChange={(e) => onRole(a, e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r} disabled={!assignableRoles.includes(r) && r !== a.role}>{cap1(r)}</option>
                    ))}
                  </select>
                  {manage && (
                    <button className="btn btn-sm btn-ghost" disabled={busy === a.id} onClick={() => onRemove(a)}>Remove</button>
                  )}
                </div>
                {a.role !== "owner" && (
                  <div className="caps">
                    {CAPS.map((c) => {
                      const on = effCap(a.role, a.caps_grant, a.caps_deny, c.key);
                      const editable = manage && callerCan(c.key);
                      return (
                        <button key={c.key} type="button" title={c.hint}
                                className={"cap-chip" + (on ? " on" : "") + (editable ? "" : " locked")}
                                disabled={!editable || busy === a.id}
                                onClick={() => onToggleCap(a, c.key)}>
                          {on ? "✓ " : ""}{c.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="access-foot text-mute">
        Staff run the floor and the league. Owners and Managers also handle money reversals, settings,
        facility setup and people. Toggle a chip to give one person an exception.
      </p>
    </div>
  );
}
