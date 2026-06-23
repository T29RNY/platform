import React, { useEffect, useMemo, useRef, useState } from "react";
import { venueListCustomersPeople, venueCreateCustomer, venueSetTeamMainContact, venueListClubStaff } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { getInitials } from "../lib/format.js";

// ContactPicker — set/clear one of a team's contact slots (Venue People & Spaces IA,
// Phase 4). A team has two slots: primary ("main") and secondary. The pick source
// depends on the team kind:
//   • LEAGUE teams → the venue_customers directory (search / pick / create inline).
//   • CLUB teams   → that team's active staff (manager / assistant manager / coach
//     from the club roster). A guardian becomes selectable once they're made a coach
//     in Memberships → Coaches & DBS.
//
// Props:
//   venueToken, teamKind ('league'|'club'), teamId (text), teamName, clubId (club only),
//   rank ('primary'|'secondary'), current { contact_id, name } | null,
//   onClose(), onSaved(rank, contact|null) — contact = { contact_id, name } after a set,
//     or null after a clear; lets the parent patch its row without a refetch.
const RANK_LABEL = { primary: "Main contact", secondary: "Secondary contact" };
const ROLE_ORDER = { manager: 0, assistant_manager: 1, coach: 2 };
const ROLE_LABEL = { manager: "Manager", assistant_manager: "Assistant manager", coach: "Coach" };

export default function ContactPicker({ venueToken, teamKind, teamId, teamName, clubId, rank, current, onClose, onSaved }) {
  const isClub = teamKind === "club";
  const [people, setPeople] = useState(null);   // candidate list (customers OR staff)
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("search");   // "search" | "create" (league only)
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const load = isClub
      ? venueListClubStaff(venueToken, clubId).then((rows) =>
          (Array.isArray(rows) ? rows : [])
            .filter((r) => String(r.team_id) === String(teamId) && r.is_active && ROLE_ORDER[r.role] != null)
            .reduce((acc, r) => { if (!acc.some((x) => x.id === r.member_profile_id)) acc.push({ id: r.member_profile_id, first_name: r.first_name, last_name: r.last_name, role: r.role }); return acc; }, [])
            .sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || (a.first_name || "").localeCompare(b.first_name || "")))
      : venueListCustomersPeople(venueToken).then((rows) => (Array.isArray(rows) ? rows : []));
    load.then((rows) => { if (alive) setPeople(rows); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken, isClub, clubId, teamId]);

  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!people) return [];
    if (!needle) return isClub ? people : people.slice(0, 50);
    return people.filter((p) => {
      const name = `${p.first_name || ""} ${p.last_name || ""}`.toLowerCase();
      return name.includes(needle) || (p.email || "").toLowerCase().includes(needle) || (p.phone || "").toLowerCase().includes(needle);
    });
  }, [people, needle, isClub]);

  const fullName = (p) => `${p.first_name || ""} ${p.last_name || ""}`.trim();

  const doSet = async (contactId) => {
    if (savingRef.current) return;
    savingRef.current = true; setBusy(true); setError(null);
    try {
      const r = await venueSetTeamMainContact(venueToken, teamKind, teamId, rank, contactId);
      onSaved(rank, contactId == null ? null : { contact_id: r.contact_id, name: r.name });
      onClose();
    } catch (e) {
      setError(messageFor(e));
      savingRef.current = false; setBusy(false);
    }
  };

  const title = `${RANK_LABEL[rank] || "Contact"} — ${teamName}`;

  return (
    <Modal onClose={onClose} title={title}
      foot={
        <>
          {current && mode === "search" && (
            <button className="btn btn-ghost" onClick={() => doSet(null)} disabled={busy}>Clear</button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }>
      {current && (
        <p className="text-mute" style={{ marginBottom: 12, fontSize: 13 }}>
          Current: <strong style={{ color: "var(--ink-1)" }}>{current.name}</strong>
        </p>
      )}

      {mode === "search" ? (
        <>
          <span className="search" style={{ width: "100%", marginBottom: 12 }}>
            <span className="ico"><Icon name="search" size={15} /></span>
            <input autoFocus placeholder={isClub ? "Search the team’s coaches…" : "Search people by name, email or phone…"} value={q} onChange={(e) => setQ(e.target.value)} />
          </span>

          {error && <p style={{ color: "var(--live)", fontSize: 12, marginBottom: 10 }}>{error}</p>}
          {people == null && <p className="text-mute" style={{ fontSize: 13 }}>Loading…</p>}
          {people && results.length === 0 && (
            <p className="text-mute" style={{ fontSize: 13 }}>
              {isClub
                ? "This team has no managers or coaches yet. Add one in Memberships → Coaches & DBS — a member or a guardian can be made a coach."
                : `No one matches “${q}”.`}
            </p>
          )}

          <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {results.map((p) => {
              const selected = current && current.contact_id === p.id;
              return (
                <button key={p.id} type="button" className="charge-opt" disabled={busy}
                  onClick={() => doSet(p.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", borderColor: selected ? "var(--accent)" : "var(--border)" }}>
                  <span className="cu-crest" style={{ width: 30, height: 30, background: "var(--bg-3)", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, fontSize: 11, color: "var(--ink-2)" }}>{getInitials(fullName(p))}</span>
                  <span style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{fullName(p) || "—"}</div>
                    <div className="text-mute" style={{ fontSize: 12 }}>{isClub ? (ROLE_LABEL[p.role] || p.role) : (p.email || p.phone || "No contact details")}</div>
                  </span>
                  {selected && <span className="dt-pill is-league">Current</span>}
                </button>
              );
            })}
          </div>

          {!isClub && (
            <button className="btn btn-ghost" style={{ marginTop: 12 }} disabled={busy} onClick={() => { setMode("create"); setError(null); }}>
              <Icon name="plus" size={14} /> Add a new person
            </button>
          )}
        </>
      ) : (
        <CreatePersonForm venueToken={venueToken} busy={busy} error={error}
          onCancel={() => { setMode("search"); setError(null); }}
          onCreated={(id) => doSet(id)}
          onError={setError} setBusy={setBusy} savingRef={savingRef} />
      )}
    </Modal>
  );
}

function messageFor(e) {
  const m = e?.message || "";
  if (m === "contact_already_other_rank") return "That person is already the team’s other contact.";
  if (m === "contact_not_team_staff") return "That person isn’t a coach of this team any more — refresh and try again.";
  return "Couldn’t save the contact — try again.";
}

function CreatePersonForm({ venueToken, busy, error, onCancel, onCreated, onError, setBusy, savingRef }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const create = async () => {
    if (savingRef.current) return;
    if (!firstName.trim()) { onError("First name is required."); return; }
    savingRef.current = true; setBusy(true); onError(null);
    try {
      const r = await venueCreateCustomer(venueToken, {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      });
      savingRef.current = false;
      onCreated(r.customer_id);
    } catch (e) {
      savingRef.current = false; setBusy(false);
      onError(e?.message === "customer_exists"
        ? "Someone with that email is already in your directory — search for them instead."
        : "Couldn’t create the person — check the details and try again.");
    }
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div>
        <label className="field-label">First name *</label>
        <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="field-label">Last name</label>
        <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Email</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Phone</label>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {error && <p style={{ color: "var(--live)", fontSize: 12 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Back</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? "Saving…" : "Create & set as contact"}</button>
      </div>
    </div>
  );
}
