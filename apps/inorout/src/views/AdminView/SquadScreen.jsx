import { useState, useEffect, useRef, useMemo } from "react";
import { addPlayerToTeam, toggleViceCaptain, disablePlayer } from "@platform/core";
import {
  insertPlayerInjury, clearPlayerInjury,
  deletePlayer as removePlayerFromDb,
  adminSetPlayerPriority,
  setPlayerNickname, resetPlayerToken,
} from "@platform/supabase";
import {
  UsersThree, Star, Shield, LinkSimple, Copy, Plus, Check,
  MagnifyingGlass, DotsThreeVertical, PencilSimple, X,
  ArrowsClockwise, Trash, FirstAid, ShieldCheck,
} from "@phosphor-icons/react";

/* ---------- helpers ---------- */

const initials = (name) => {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const FILTERS = [
  { id: "all",      label: "All"      },
  { id: "regular",  label: "Regulars" },
  { id: "guest",    label: "Guests"   },
  { id: "priority", label: "Priority" },
  { id: "injured",  label: "Injured"  },
];

/* ---------- main ---------- */

export default function SquadScreen({
  squad, setSquad, teamId, adminToken = null,
  isViceCaptain = false, onBack, me = null, onPlayerTap,
}) {
  /* ---- add form (guest-only; regulars self-onboard via invite link) ---- */
  const [name,        setName]        = useState("");
  const [addLoading,  setAddLoading]  = useState(false);
  const [justAddedId, setJustAddedId] = useState(null);

  /* ---- filtering ---- */
  const [filter, setFilter] = useState("all");
  const [query,  setQuery]  = useState("");

  /* ---- feedback ---- */
  const [copied,      setCopied]      = useState(false);
  const [copiedId,    setCopiedId]    = useState(null);
  const [injuryToast, setInjuryToast] = useState(null);
  const [errorToast,  setErrorToast]  = useState(null);
  const [okToast,     setOkToast]     = useState(null);

  /* ---- per-row UI state ---- */
  const [openMenuId,    setOpenMenuId]    = useState(null);
  const [editingId,     setEditingId]     = useState(null);
  const [editValue,     setEditValue]     = useState("");
  const [resetToken,    setResetToken]    = useState(null);  // { playerId, url }
  const [removeConfirm, setRemoveConfirm] = useState(null);  // { id, name }
  const [guestPrompt,   setGuestPrompt]   = useState(null);

  const nameInputRef = useRef(null);
  const editInputRef = useRef(null);
  const menuRef      = useRef(null);

  const joinUrl     = teamId ? `https://www.in-or-out.com/join/${teamId}` : "";
  const activeCount = squad.filter(p => !p.disabled).length;
  const showSearch  = squad.length >= 6;

  /* ---- toast timers ---- */
  useEffect(() => { if (!injuryToast) return; const t = setTimeout(() => setInjuryToast(null), 4000); return () => clearTimeout(t); }, [injuryToast]);
  useEffect(() => { if (!errorToast)  return; const t = setTimeout(() => setErrorToast(null),  3000); return () => clearTimeout(t); }, [errorToast]);
  useEffect(() => { if (!okToast)     return; const t = setTimeout(() => setOkToast(null),     2400); return () => clearTimeout(t); }, [okToast]);
  useEffect(() => { if (!justAddedId) return; const t = setTimeout(() => setJustAddedId(null), 1200); return () => clearTimeout(t); }, [justAddedId]);

  /* ---- close overflow on outside click ---- */
  useEffect(() => {
    if (!openMenuId) return;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenuId(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("touchstart", onDoc); };
  }, [openMenuId]);

  /* ---- focus edit input on open ---- */
  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);

  /* ============================== handlers ============================== */

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || addLoading) return;
    setAddLoading(true);
    setName("");
    try {
      const player = await addPlayerToTeam(adminToken, trimmed, "guest", false);
      setSquad(prev => [...prev, player]);
      setJustAddedId(player.id);
      nameInputRef.current?.focus();
    } catch {
      setErrorToast("Could not add guest");
      setName(trimmed);
    } finally {
      setAddLoading(false);
    }
  }

  const handleCopyJoin = () => {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const handleCopyPlayer = (p) => {
    const url = `https://www.in-or-out.com/p/${p.token || p.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(p.id);
      setTimeout(() => setCopiedId(id => id === p.id ? null : id), 1800);
    });
  };

  async function handleTogglePriority(p) {
    const newVal = !p.priority;
    setSquad(prev => prev.map(x => x.id === p.id ? { ...x, priority: newVal } : x));
    try { await adminSetPlayerPriority(adminToken, p.id, newVal); }
    catch (e) {
      console.error(e);
      setSquad(prev => prev.map(x => x.id === p.id ? { ...x, priority: p.priority } : x));
      setErrorToast("Couldn't update priority");
    }
  }

  async function handleToggleVC(p) {
    if (p.id === me?.id) return;
    const newVal = !p.isViceCaptain;
    setSquad(prev => prev.map(x => x.id === p.id ? { ...x, isViceCaptain: newVal } : x));
    try { await toggleViceCaptain(adminToken, p.id, newVal); }
    catch (e) {
      console.error(e);
      setSquad(prev => prev.map(x => x.id === p.id ? { ...x, isViceCaptain: p.isViceCaptain } : x));
      setErrorToast("Couldn't update vice captain");
    }
  }

  async function handleToggleInjured(p) {
    const newInjured = !p.injured;
    const autoOut = newInjured && ["in", "reserve", "maybe"].includes(p.status);
    const updated = { ...p, injured: newInjured, status: autoOut ? "out" : p.status };
    setSquad(prev => prev.map(x => x.id === p.id ? updated : x));
    if (autoOut) setInjuryToast(`${p.nickname || p.name} set to OUT — marked injured`);
    if (newInjured) {
      const guest = squad.find(g => g.guestOf === p.id && g.status !== "out");
      if (guest) setGuestPrompt({ guestId: guest.id, guestName: guest.name, hostName: p.nickname || p.name });
    }
    try {
      if (newInjured) await insertPlayerInjury(adminToken, p.id);
      else            await clearPlayerInjury(adminToken, p.id);
    } catch (e) {
      console.error(e);
      setSquad(prev => prev.map(x => x.id === p.id ? p : x));
      setErrorToast("Couldn't update injury");
    }
  }

  async function handleToggleDisable(p) {
    const newVal = !p.disabled;
    setSquad(prev => prev.map(x => x.id === p.id ? { ...x, disabled: newVal } : x));
    try { await disablePlayer(adminToken, p.id, newVal); }
    catch (e) {
      console.error(e);
      setSquad(prev => prev.map(x => x.id === p.id ? { ...x, disabled: p.disabled } : x));
      setErrorToast("Couldn't update player");
    }
  }

  function startEdit(p) {
    setEditingId(p.id);
    setEditValue(p.nickname || p.name || "");
    setOpenMenuId(null);
  }

  async function commitEdit(p) {
    const next = editValue.trim();
    setEditingId(null);
    if (!next || next === (p.nickname || p.name)) return;
    const prevNick = p.nickname;
    setSquad(prev => prev.map(x => x.id === p.id ? { ...x, nickname: next } : x));
    try {
      await setPlayerNickname(adminToken, p.id, next);
      setOkToast("Name updated");
    } catch (e) {
      console.error(e);
      setSquad(prev => prev.map(x => x.id === p.id ? { ...x, nickname: prevNick } : x));
      setErrorToast(String(e?.message || "").toLowerCase().includes("taken")
        ? "Name already taken on this squad"
        : "Couldn't rename player");
    }
  }

  async function handleResetLink(p) {
    setOpenMenuId(null);
    try {
      const tok = await resetPlayerToken(adminToken, p.id);
      setSquad(prev => prev.map(x => x.id === p.id ? { ...x, token: tok } : x));
      setResetToken({ playerId: p.id, url: `https://www.in-or-out.com/p/${tok}` });
    } catch (e) {
      console.error(e);
      setErrorToast("Couldn't reset link");
    }
  }

  function askRemove(p) {
    setOpenMenuId(null);
    setRemoveConfirm({ id: p.id, name: p.nickname || p.name, attended: p.attended || 0 });
  }

  async function confirmRemove() {
    if (!removeConfirm) return;
    const id = removeConfirm.id;
    const snapshot = squad;
    setSquad(prev => prev.filter(x => x.id !== id));
    setRemoveConfirm(null);
    try {
      await removePlayerFromDb(adminToken, id);
      setOkToast("Player removed");
    } catch (e) {
      console.error(e);
      setSquad(snapshot);
      setErrorToast("Couldn't remove player");
    }
  }

  async function removeGuestConfirmed() {
    if (!guestPrompt) return;
    const gid = guestPrompt.guestId;
    try {
      await removePlayerFromDb(adminToken, gid);
      setSquad(prev => prev.filter(p => p.id !== gid));
    } catch (e) {
      console.error(e);
      setErrorToast("Couldn't remove guest");
    }
    setGuestPrompt(null);
  }

  /* ============================== derived list ============================== */

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = squad;
    if (q) list = list.filter(p => ((p.nickname || "") + " " + (p.name || "")).toLowerCase().includes(q));
    if (filter === "regular")  list = list.filter(p => !(p.isGuest || p.type === "guest"));
    if (filter === "guest")    list = list.filter(p => p.isGuest || p.type === "guest");
    if (filter === "priority") list = list.filter(p => p.priority);
    if (filter === "injured")  list = list.filter(p => p.injured);
    return [...list].sort((a, b) => {
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
      if (!!a.priority !== !!b.priority) return a.priority ? -1 : 1;
      return (a.nickname || a.name || "").localeCompare(b.nickname || b.name || "");
    });
  }, [squad, query, filter]);

  /* ============================== render ============================== */

  return (
    <div style={{ padding: 16, paddingBottom: 220, maxWidth: 480, margin: "0 auto", position: "relative" }}>

      {/* Inline keyframes */}
      <style>{`
        @keyframes ms-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes ms-pop     { 0% { transform: scale(0.94); opacity: 0; } 60% { transform: scale(1.02); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes ms-gold-pulse { 0%,100% { box-shadow: 0 0 0px rgba(232,160,32,0.0); } 50% { box-shadow: 0 0 14px rgba(232,160,32,0.45); } }
        @keyframes ms-amber-glow { 0%,100% { box-shadow: 0 0 0px rgba(255,176,32,0.0); } 50% { box-shadow: 0 0 12px rgba(255,176,32,0.35); } }
        @keyframes ms-green-flash { 0% { background: rgba(61,220,106,0.18); } 100% { background: var(--s2); } }
        @keyframes ms-slide-down { from { opacity: 0; transform: translateY(-4px); max-height: 0; } to { opacity: 1; transform: translateY(0); max-height: 220px; } }
        .ms-row { animation: ms-fade-in 0.32s ease both; }
        .ms-row.just-added { animation: ms-pop 0.5s cubic-bezier(.2,.9,.3,1.2) both, ms-green-flash 1.1s ease both; }
        .ms-iconbtn { transition: transform 0.15s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.3s ease, color 0.18s ease; }
        .ms-iconbtn:active { transform: scale(0.92); }
        .ms-chip   { transition: all 0.18s ease; }
        .ms-fade   { animation: ms-fade-in 0.25s ease both; }
        .ms-opts   { animation: ms-slide-down 0.22s ease both; overflow: hidden; }
        .ms-menu   { animation: ms-fade-in 0.18s ease both; }
        .ms-link   { transition: all 0.2s ease; }
        .ms-link:hover { color: var(--green); }
        input.ms-input:focus { outline: none; }
      `}</style>

      {/* Back */}
      <div onClick={onBack} style={{ cursor: "pointer", marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "var(--t2)" }}>← Back</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: "var(--gold)",
            margin: 0, letterSpacing: "0.04em", lineHeight: 1,
            textShadow: "0 0 18px rgba(232,160,32,0.22)",
          }}>
            MANAGE SQUAD
          </h1>
          <p style={{
            fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 12,
            color: "var(--t2)", margin: "6px 0 0",
          }}>
            Regulars join via the link below. Add one-off guests inline.
          </p>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(255,255,255,0.04)", backdropFilter: "blur(10px)",
          border: "0.5px solid rgba(255,255,255,0.10)",
          borderRadius: "var(--rs)", padding: "8px 12px",
          boxShadow: "0 0 18px rgba(61,220,106,0.10)",
        }}>
          <UsersThree size={16} color="var(--green)" weight="thin" />
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)",
            lineHeight: 1, letterSpacing: "0.02em",
            textShadow: "0 0 10px rgba(61,220,106,0.35)",
          }}>
            {activeCount}
          </span>
        </div>
      </div>

      {/* Invite link — primary path for regulars to join themselves */}
      {teamId && (
        <div
          onClick={handleCopyJoin}
          style={{
            cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
            background: copied ? "var(--green2)" : "var(--s2)",
            border: `0.5px solid ${copied ? "var(--greenb)" : "var(--greenb)"}`,
            borderRadius: "var(--r)", padding: "12px 14px", marginBottom: 10,
            boxShadow: copied ? "0 0 22px rgba(61,220,106,0.32)" : "0 0 14px rgba(61,220,106,0.10)",
            transition: "all 0.25s ease",
          }}
        >
          <LinkSimple size={16} color="var(--green)" weight="thin" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: "0.1em",
              color: "var(--green)", marginBottom: 1,
            }}>
              PLAYER INVITE LINK
            </div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", fontSize: 12,
              color: copied ? "var(--green)" : "var(--t2)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {copied ? "Copied to clipboard" : `in-or-out.com/join/${teamId}`}
            </div>
          </div>
          {copied
            ? <Check size={16} color="var(--green)" weight="thin" />
            : <Copy  size={16} color="var(--green)" weight="thin" />}
        </div>
      )}

      {/* Add guest — secondary path for one-off players */}
      <div style={{
        background: "var(--s2)", border: "0.5px solid var(--border-subtle)",
        borderRadius: "var(--r)", padding: "10px 12px", marginBottom: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 10, letterSpacing: "0.12em",
            color: "var(--t2)", whiteSpace: "nowrap",
          }}>
            + GUEST
          </span>
          <input
            ref={nameInputRef}
            className="ms-input"
            type="text"
            placeholder="One-off player name…"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            style={{
              flex: 1, background: "transparent", border: "none",
              fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "var(--t1)",
              padding: "6px 4px",
            }}
          />
          <button
            onClick={handleAdd}
            disabled={!name.trim() || addLoading}
            className="ms-iconbtn"
            aria-label="Add guest"
            style={{
              width: 32, height: 32, borderRadius: 10,
              border: name.trim() ? "0.5px solid var(--goldb)" : "0.5px solid var(--s3)",
              background: name.trim() ? "var(--gold2)" : "var(--s3)",
              color: name.trim() ? "var(--gold)" : "var(--t2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: name.trim() && !addLoading ? "pointer" : "default",
              boxShadow: name.trim() ? "0 0 10px rgba(232,160,32,0.20)" : "none",
            }}
          >
            <Plus size={16} weight="thin" />
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
        {FILTERS.map(f => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="ms-chip"
              style={{
                flexShrink: 0,
                background: active ? "var(--gold2)" : "transparent",
                border: `0.5px solid ${active ? "var(--goldb)" : "var(--s3)"}`,
                color: active ? "var(--gold)" : "var(--t2)",
                borderRadius: 999, padding: "5px 12px",
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 11,
                letterSpacing: "0.1em", cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      {showSearch && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--s2)", border: "0.5px solid var(--border-subtle)",
          borderRadius: "var(--rs)", padding: "8px 12px", marginBottom: 12,
        }}>
          <MagnifyingGlass size={14} color="var(--t2)" weight="thin" />
          <input
            className="ms-input"
            type="text"
            placeholder="Search squad"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1, background: "transparent", border: "none",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "var(--t1)",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="ms-iconbtn"
              style={{ background: "transparent", border: "none", color: "var(--t2)", cursor: "pointer", padding: 4, display: "flex" }}
              aria-label="Clear search"
            >
              <X size={12} weight="thin" />
            </button>
          )}
        </div>
      )}

      {/* Empty state */}
      {visible.length === 0 && (
        <div className="ms-fade" style={{
          textAlign: "center", padding: "40px 20px",
          color: "var(--t2)", fontFamily: "'DM Sans', sans-serif", fontSize: 13,
        }}>
          {squad.length === 0
            ? "No players yet — add your first one above."
            : "No players match this filter."}
        </div>
      )}

      {/* Squad list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((p, idx) => {
          const isJustAdded = p.id === justAddedId;
          const displayName = p.nickname || p.name;
          const host        = p.guestOf ? squad.find(h => h.id === p.guestOf) : null;
          const isGuest     = p.isGuest || p.type === "guest";
          const vcSelf      = p.id === me?.id;
          const isInjured   = !!p.injured;
          const isPriority  = !!p.priority;
          const isVC        = !!p.isViceCaptain;
          const isMenuOpen  = openMenuId === p.id;
          const isEditing   = editingId === p.id;
          const hasHistory  = (p.attended || 0) > 0;

          const ringColor =
              isInjured ? "rgba(255,80,80,0.55)"
            : isPriority ? "var(--goldb)"
            : isVC ? "rgba(96,160,255,0.5)"
            : "rgba(61,220,106,0.4)";
          const ringGlow =
              isInjured ? "0 0 12px rgba(255,80,80,0.25)"
            : isPriority ? "0 0 14px rgba(232,160,32,0.35)"
            : isVC ? "0 0 12px rgba(96,160,255,0.25)"
            : "0 0 10px rgba(61,220,106,0.18)";
          const cardBorder =
              isInjured ? "rgba(255,176,32,0.20)"
            : isPriority ? "rgba(232,160,32,0.22)"
            : "var(--border-subtle)";

          return (
            <div
              key={p.id}
              className={`ms-row ${isJustAdded ? "just-added" : ""}`}
              style={{
                animationDelay: `${Math.min(idx, 12) * 28}ms`,
                background: "var(--s2)", borderRadius: "var(--r)",
                border: `0.5px solid ${cardBorder}`,
                padding: "12px 12px 10px",
                opacity: p.disabled ? 0.45 : 1,
                position: "relative",
                zIndex: isMenuOpen ? 30 : "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>

                {/* Avatar */}
                <div
                  onClick={() => onPlayerTap?.(p)}
                  style={{
                    width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
                    background: isInjured ? "rgba(120,20,20,0.28)" : "rgba(61,220,106,0.10)",
                    border: `1px solid ${ringColor}`,
                    boxShadow: ringGlow,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", position: "relative",
                    transition: "box-shadow 0.3s ease, border 0.3s ease",
                  }}
                >
                  <span style={{
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.04em",
                    color: isInjured ? "rgba(255,140,140,0.85)" : "var(--t1)",
                  }}>
                    {initials(displayName)}
                  </span>
                  {isInjured && (
                    <span style={{
                      position: "absolute", bottom: -3, right: -3,
                      width: 16, height: 16, borderRadius: "50%",
                      background: "var(--s1)", border: "0.5px solid var(--amberb)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <FirstAid size={10} color="var(--amber)" weight="thin" />
                    </span>
                  )}
                </div>

                {/* Name + chips */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      className="ms-input"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitEdit(p);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => commitEdit(p)}
                      style={{
                        width: "100%", background: "var(--s3)",
                        border: "0.5px solid var(--goldb)", borderRadius: 8,
                        padding: "6px 10px",
                        fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "var(--t1)",
                      }}
                    />
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 15,
                        color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap", maxWidth: 180,
                      }}>
                        {displayName}
                      </span>
                      <button
                        onClick={() => startEdit(p)}
                        className="ms-iconbtn"
                        aria-label="Rename"
                        style={{
                          background: "transparent", border: "none", padding: 2, cursor: "pointer",
                          color: "var(--t2)", opacity: 0.55, display: "flex",
                        }}
                      >
                        <PencilSimple size={12} weight="thin" />
                      </button>
                    </div>
                  )}
                  {/* status chips */}
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                    {isGuest && host && (
                      <span style={{
                        fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: "var(--t2)",
                      }}>
                        Guest of {host.nickname || host.name}
                      </span>
                    )}
                    {isGuest && !host && (
                      <Pill color="var(--t2)" border="var(--s3)" bg="transparent">GUEST</Pill>
                    )}
                    {isVC      && <Pill icon={<ShieldCheck size={9} weight="thin" color="#60A0FF" />} color="#60A0FF" border="rgba(96,160,255,0.4)" bg="rgba(96,160,255,0.12)">VC</Pill>}
                    {isPriority && <Pill icon={<Star size={9} weight="thin" color="var(--gold)" />} color="var(--gold)" border="var(--goldb)" bg="var(--gold2)">PRIORITY</Pill>}
                    {p.disabled && <Pill color="var(--t2)" border="var(--s3)" bg="var(--s3)">DISABLED</Pill>}
                  </div>
                </div>

                {/* Quick toggle cluster */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <IconToggle
                    active={isPriority}
                    onClick={() => handleTogglePriority(p)}
                    activeColor="var(--gold)"
                    activeBorder="var(--goldb)"
                    activeBg="var(--gold2)"
                    glow="0 0 10px rgba(232,160,32,0.4)"
                    title={isPriority ? "Remove priority" : "Set priority"}
                  >
                    <Star size={14} weight="thin" color={isPriority ? "var(--gold)" : "var(--t2)"} />
                  </IconToggle>

                  {!isGuest && !isViceCaptain && (
                    <IconToggle
                      active={isVC}
                      disabled={vcSelf}
                      onClick={() => handleToggleVC(p)}
                      activeColor="#60A0FF"
                      activeBorder="rgba(96,160,255,0.45)"
                      activeBg="rgba(96,160,255,0.14)"
                      glow="0 0 10px rgba(96,160,255,0.35)"
                      title={vcSelf ? "You're the admin" : (isVC ? "Remove VC" : "Set as vice captain")}
                    >
                      <Shield size={14} weight="thin" color={isVC ? "#60A0FF" : "var(--t2)"} />
                    </IconToggle>
                  )}

                  <IconToggle
                    active={isInjured}
                    onClick={() => handleToggleInjured(p)}
                    activeColor="var(--amber)"
                    activeBorder="var(--amberb)"
                    activeBg="var(--amber2)"
                    glow="0 0 10px rgba(255,176,32,0.35)"
                    title={isInjured ? "Clear injury" : "Mark injured"}
                  >
                    <FirstAid size={14} weight="thin" color={isInjured ? "var(--amber)" : "var(--t2)"} />
                  </IconToggle>

                  <div ref={isMenuOpen ? menuRef : null} style={{ position: "relative" }}>
                    <IconToggle
                      active={isMenuOpen}
                      onClick={() => setOpenMenuId(isMenuOpen ? null : p.id)}
                      activeColor="var(--t1)"
                      activeBorder="var(--s3)"
                      activeBg="var(--s3)"
                      title="More actions"
                    >
                      <DotsThreeVertical size={16} weight="thin" color={isMenuOpen ? "var(--t1)" : "var(--t2)"} />
                    </IconToggle>
                    {isMenuOpen && (
                      <div
                        className="ms-menu"
                        style={{
                          position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 20,
                          background: "var(--s1)", border: "0.5px solid var(--border-subtle)",
                          borderRadius: 12, padding: 6, minWidth: 180,
                          boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
                          backdropFilter: "blur(12px)",
                        }}
                      >
                        <MenuItem icon={<PencilSimple size={14} weight="thin" />} onClick={() => startEdit(p)}>
                          Rename
                        </MenuItem>
                        {!isGuest && (
                          <MenuItem
                            icon={copiedId === p.id
                              ? <Check size={14} weight="thin" color="var(--green)" />
                              : <Copy  size={14} weight="thin" />}
                            onClick={() => handleCopyPlayer(p)}
                          >
                            {copiedId === p.id ? "Copied!" : "Copy personal link"}
                          </MenuItem>
                        )}
                        {!isGuest && (
                          <MenuItem icon={<ArrowsClockwise size={14} weight="thin" />} onClick={() => handleResetLink(p)}>
                            Reset personal link
                          </MenuItem>
                        )}
                        <MenuItem
                          icon={<UsersThree size={14} weight="thin" />}
                          onClick={() => { handleToggleDisable(p); setOpenMenuId(null); }}
                        >
                          {p.disabled ? "Enable player" : "Disable player"}
                        </MenuItem>
                        <MenuItem
                          icon={<Trash size={14} weight="thin" color={hasHistory ? "var(--t2)" : "var(--red)"} />}
                          onClick={() => !hasHistory && askRemove(p)}
                          danger={!hasHistory}
                          disabled={hasHistory}
                          subtitle={hasHistory ? "Has match history — use Disable" : null}
                        >
                          Remove from squad
                        </MenuItem>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          );
        })}
      </div>

      {/* Reset-link modal */}
      {resetToken && (
        <Modal accent="var(--greenb)" onClose={() => setResetToken(null)} title="NEW PERSONAL LINK">
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "var(--t2)", margin: "0 0 12px" }}>
            Old link is now dead. Share the new one with the player.
          </p>
          <div style={{
            background: "var(--s3)", borderRadius: 10, padding: "10px 12px",
            fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "var(--t1)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            marginBottom: 14,
          }}>
            {resetToken.url}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <ModalBtn
              variant="green"
              onClick={() => {
                navigator.clipboard.writeText(resetToken.url);
                setOkToast("Link copied");
                setResetToken(null);
              }}
            >
              COPY LINK
            </ModalBtn>
            <ModalBtn variant="neutral" onClick={() => setResetToken(null)}>CLOSE</ModalBtn>
          </div>
        </Modal>
      )}

      {/* Remove confirmation */}
      {removeConfirm && (
        <Modal accent="var(--redb)" onClose={() => setRemoveConfirm(null)} title="REMOVE PLAYER">
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "var(--t1)", margin: "0 0 16px" }}>
            Remove <strong style={{ color: "var(--t1)" }}>{removeConfirm.name}</strong> from your squad?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <ModalBtn variant="neutral" onClick={() => setRemoveConfirm(null)}>CANCEL</ModalBtn>
            <ModalBtn variant="red" onClick={confirmRemove}>REMOVE</ModalBtn>
          </div>
        </Modal>
      )}

      {/* Guest prompt (host injured) */}
      {guestPrompt && (
        <Modal accent="var(--amberb)" onClose={() => setGuestPrompt(null)} title={`${guestPrompt.hostName} IS INJURED`}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "var(--t2)", margin: "0 0 16px" }}>
            Keep {guestPrompt.guestName} in the game as a guest?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <ModalBtn variant="green"   onClick={() => setGuestPrompt(null)}>KEEP</ModalBtn>
            <ModalBtn variant="red"     onClick={removeGuestConfirmed}>REMOVE</ModalBtn>
          </div>
        </Modal>
      )}

      {/* Toasts */}
      <Toast show={!!injuryToast} variant="amber" bottom={88}>{injuryToast}</Toast>
      <Toast show={!!okToast}     variant="green" bottom={88}>{okToast}</Toast>
      <Toast show={!!errorToast}  variant="red"   bottom={144}>{errorToast}</Toast>

    </div>
  );
}

/* ============================== sub-components ============================== */

function Pill({ children, color, border, bg, icon }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontFamily: "'Bebas Neue', sans-serif", fontSize: 9, letterSpacing: "0.1em",
      color, border: `0.5px solid ${border}`, background: bg,
      borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap",
    }}>
      {icon}
      {children}
    </span>
  );
}

function IconToggle({ active, disabled, onClick, children, activeColor, activeBorder, activeBg, glow, title }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className="ms-iconbtn"
      style={{
        width: 32, height: 32, borderRadius: 10,
        background: active ? activeBg : "transparent",
        border: `0.5px solid ${active ? activeBorder : "var(--s3)"}`,
        color: active ? activeColor : "var(--t2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
        boxShadow: active && glow ? glow : "none",
      }}
    >
      {children}
    </button>
  );
}

function MenuItem({ children, icon, onClick, danger, disabled, subtitle }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        background: "transparent", border: "none", cursor: disabled ? "default" : "pointer",
        padding: "9px 10px", borderRadius: 8,
        color: danger ? "var(--red)" : "var(--t1)",
        fontFamily: "'DM Sans', sans-serif", fontSize: 13, textAlign: "left",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s ease",
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "var(--s3)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ display: "flex", alignItems: "center", color: danger ? "var(--red)" : "var(--t2)" }}>{icon}</span>
      <span style={{ flex: 1 }}>
        {children}
        {subtitle && (
          <div style={{ fontSize: 10, color: "var(--t2)", marginTop: 2 }}>{subtitle}</div>
        )}
      </span>
    </button>
  );
}

function Modal({ children, title, accent, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        animation: "ms-fade-in 0.2s ease both",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--s1)", border: `0.5px solid ${accent}`,
          borderRadius: 16, padding: 22, maxWidth: 360, width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          animation: "ms-pop 0.32s cubic-bezier(.2,.9,.3,1.2) both",
        }}
      >
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 14,
          letterSpacing: "0.1em", color: "var(--t2)", marginBottom: 10,
        }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalBtn({ children, onClick, variant }) {
  const v = {
    green:   { color: "var(--green)", border: "var(--greenb)", bg: "var(--green2)" },
    red:     { color: "var(--red)",   border: "var(--redb)",   bg: "var(--red2)"   },
    neutral: { color: "var(--t2)",    border: "var(--s3)",     bg: "transparent"   },
  }[variant];
  return (
    <button
      onClick={onClick}
      className="ms-iconbtn"
      style={{
        flex: 1, height: 42, borderRadius: 10,
        border: `0.5px solid ${v.border}`, background: v.bg, color: v.color,
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.06em",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Toast({ show, variant, bottom, children }) {
  if (!show) return null;
  const v = {
    amber: { color: "var(--amber)", border: "var(--amberb)" },
    green: { color: "var(--green)", border: "var(--greenb)" },
    red:   { color: "var(--red)",   border: "var(--redb)"   },
  }[variant];
  return (
    <div
      className="ms-fade"
      style={{
        position: "fixed", bottom, left: "50%", transform: "translateX(-50%)",
        zIndex: 90, maxWidth: 340, width: "calc(100% - 32px)",
        background: "var(--s1)", border: `0.5px solid ${v.border}`,
        borderRadius: 12, padding: "11px 16px",
        fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 13,
        color: v.color, textAlign: "center",
        boxShadow: `0 0 24px ${v.border}`,
        backdropFilter: "blur(8px)",
      }}
    >
      {children}
    </div>
  );
}
