import { useState, useEffect } from "react";
import { addPlayerToTeam, toggleViceCaptain, disablePlayer } from "@platform/core";
import { insertPlayerInjury, clearPlayerInjury, deletePlayer as removePlayerFromDb, adminSetPlayerPriority } from "@platform/supabase";
import { UsersThree, Star, Shield, LinkSimple, Copy, FirstAid } from "@phosphor-icons/react";

export default function SquadScreen({
  squad, setSquad, teamId, adminToken = null, isViceCaptain = false, onBack, me = null, onPlayerTap,
}) {

  const [name,         setName]         = useState("");
  const [type,         setType]         = useState("regular");
  const [priority,     setPriority]     = useState(false);
  const [vcToggle,     setVcToggle]     = useState(false);
  const [copied,       setCopied]       = useState(false);
  const [injuryToast,  setInjuryToast]  = useState(null);
  const [guestPrompt,  setGuestPrompt]  = useState(null);
  const [errorToast,   setErrorToast]   = useState(null);
  const [addLoading,   setAddLoading]   = useState(false);
  const [focusedInput, setFocusedInput] = useState(false);
  const [copiedId,     setCopiedId]     = useState(null);

  const activeCount = squad.filter(p => !p.disabled).length;
  const joinUrl     = `https://www.in-or-out.com/join/${teamId}`;

  useEffect(() => {
    if (!injuryToast) return;
    const t = setTimeout(() => setInjuryToast(null), 4000);
    return () => clearTimeout(t);
  }, [injuryToast]);

  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 3000);
    return () => clearTimeout(t);
  }, [errorToast]);

  const handleCopy = () => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  async function handleAddPlayer() {
    if (!name.trim()) return;
    setAddLoading(true);
    const trimmedName = name.trim();
    setName(""); setType("regular"); setPriority(false); setVcToggle(false);
    try {
      const player = await addPlayerToTeam(adminToken, trimmedName, type, priority);
      setSquad(prev => [...prev, player]);
    } catch {
      setErrorToast("Failed to add player");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleTogglePriority(player) {
    const newVal = !player.priority;
    setSquad(prev => prev.map(p => p.id === player.id ? { ...p, priority: newVal } : p));
    try {
      await adminSetPlayerPriority(adminToken, player.id, newVal);
    } catch (error) {
      console.error(error);
      setSquad(prev => prev.map(p => p.id === player.id ? { ...p, priority: player.priority } : p));
      setErrorToast("Failed to update priority");
    }
  }

  async function handleToggleViceCapt(player) {
    const newVal = !player.isViceCaptain;
    setSquad(prev => prev.map(p => p.id === player.id ? { ...p, isViceCaptain: newVal } : p));
    try {
      await toggleViceCaptain(adminToken, player.id, newVal);
    } catch (error) {
      console.error(error);
      setSquad(prev => prev.map(p => p.id === player.id ? { ...p, isViceCaptain: player.isViceCaptain } : p));
      setErrorToast("Failed to update vice captain");
    }
  }

  async function handleToggleInjured(player) {
    const newInjured = !player.injured;
    const autoOut = newInjured && ["in", "reserve", "maybe"].includes(player.status);
    const updated = { ...player, injured: newInjured, status: autoOut ? "out" : player.status };
    setSquad(prev => prev.map(p => p.id === player.id ? updated : p));
    if (autoOut) setInjuryToast(`${player.nickname || player.name} set to OUT — marked as injured`);
    if (newInjured) {
      const guest = squad.find(g => g.guestOf === player.id && g.status !== "out");
      if (guest) setGuestPrompt({ guestId: guest.id, guestName: guest.name, hostName: player.nickname || player.name });
    }
    try {
      if (newInjured) {
        await insertPlayerInjury(adminToken, player.id);
      } else {
        await clearPlayerInjury(adminToken, player.id);
      }
    } catch (error) {
      console.error(error);
      setSquad(prev => prev.map(p => p.id === player.id ? player : p));
      setErrorToast("Failed to update injury status");
    }
  }

  async function handleToggleDisable(player) {
    const newVal = !player.disabled;
    setSquad(prev => prev.map(p => p.id === player.id ? { ...p, disabled: newVal } : p));
    try {
      await disablePlayer(adminToken, player.id, newVal);
    } catch (error) {
      console.error(error);
      setSquad(prev => prev.map(p => p.id === player.id ? { ...p, disabled: player.disabled } : p));
      setErrorToast("Failed to update player");
    }
  }

  const keepGuest = () => setGuestPrompt(null);

  const removeGuest = async () => {
    if (!guestPrompt) return;
    try {
      await removePlayerFromDb(adminToken, guestPrompt.guestId);
      setSquad(prev => prev.filter(p => p.id !== guestPrompt.guestId));
    } catch (error) {
      console.error(error);
      setErrorToast("Failed to remove guest");
    }
    setGuestPrompt(null);
  };

  const sortedSquad = [...squad].sort((a, b) => {
    if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
    return (a.nickname || a.name).localeCompare(b.nickname || b.name);
  });

  const btnBase = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
    flex: 1, borderRadius: 6, padding: "6px 10px", cursor: "pointer",
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: "0.06em",
    border: "0.5px solid var(--s3)", background: "var(--s3)", color: "var(--t2)",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ padding: 16, paddingBottom: 200, maxWidth: 480, margin: "0 auto" }}>

      {/* BACK BUTTON */}
      <div onClick={onBack} style={{ cursor: "pointer", marginBottom: 16 }}>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 14, color: "var(--t2)" }}>
          ← Back
        </span>
      </div>

      {/* HEADER ROW */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--gold)",
            margin: 0, letterSpacing: "0.04em",
          }}>
            MANAGE SQUAD
          </h1>
          <p style={{
            fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 13,
            color: "var(--t2)", margin: "4px 0 0",
          }}>
            Add players, set availability and roles.
          </p>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "var(--s2)", border: "0.5px solid var(--s3)",
          borderRadius: 8, padding: "6px 12px",
        }}>
          <UsersThree size={16} color="var(--t2)" weight="thin" />
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--t1)" }}>
            {activeCount}
          </span>
          <span style={{
            fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 9,
            color: "var(--t2)", letterSpacing: "0.06em",
          }}>
            TOTAL PLAYERS
          </span>
        </div>
      </div>

      {/* PLAYER INVITE LINK CARD */}
      {teamId && (
        <div style={{
          background: "var(--s2)", border: "0.5px solid var(--greenb)",
          borderRadius: 8, padding: 16, marginTop: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <LinkSimple size={16} color="var(--green)" weight="thin" />
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, color: "var(--green)",
              letterSpacing: "0.08em",
            }}>
              PLAYER INVITE LINK
            </span>
          </div>
          <p style={{
            fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 13,
            color: "var(--t2)", marginTop: 4,
          }}>
            Share this link with players to join your team.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <div style={{
              flex: 1, background: "var(--s3)", borderRadius: 8, padding: "10px 12px",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "var(--t1)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              in-or-out.com/join/{teamId}
            </div>
            <button
              onClick={handleCopy}
              style={{
                background: copied ? "var(--green)" : "transparent",
                border: "0.5px solid var(--green)",
                color: copied ? "#fff" : "var(--green)",
                borderRadius: 8, padding: "8px 16px", cursor: "pointer",
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
                letterSpacing: "0.04em", transition: "all 0.2s",
              }}
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
        </div>
      )}

      {/* ADD PLAYER CARD */}
      <div style={{ background: "var(--s2)", borderRadius: 8, padding: 16, marginTop: 12 }}>
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, color: "var(--green)",
          letterSpacing: "0.08em",
        }}>
          ADD PLAYER
        </span>
        <input
          type="text"
          placeholder="Enter player name"
          value={name}
          onChange={e => setName(e.target.value)}
          onFocus={() => setFocusedInput(true)}
          onBlur={() => setFocusedInput(false)}
          style={{
            width: "100%", background: "var(--s3)",
            border: focusedInput ? "0.5px solid var(--gold)" : "0.5px solid var(--s3)",
            borderRadius: 8, padding: 12, fontSize: 15,
            fontFamily: "'DM Sans', sans-serif", color: "var(--t1)",
            marginTop: 12, outline: "none", boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          {/* REGULAR pill */}
          <button
            onClick={() => setType("regular")}
            style={{
              border: type === "regular" ? "0.5px solid var(--gold)" : "0.5px solid var(--s3)",
              color: type === "regular" ? "var(--gold)" : "var(--t2)",
              background: type === "regular" ? "var(--gold2)" : "var(--s3)",
              borderRadius: 6, padding: "6px 14px",
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 12,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            REGULAR
          </button>
          {/* GUEST pill */}
          <button
            onClick={() => setType("guest")}
            style={{
              border: type === "guest" ? "0.5px solid var(--gold)" : "0.5px solid var(--s3)",
              color: type === "guest" ? "var(--gold)" : "var(--t2)",
              background: type === "guest" ? "var(--gold2)" : "var(--s3)",
              borderRadius: 6, padding: "6px 14px",
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 12,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            GUEST
          </button>
          {/* Priority toggle */}
          <button
            onClick={() => setPriority(!priority)}
            style={{
              border: priority ? "0.5px solid var(--gold)" : "0.5px solid var(--s3)",
              background: priority ? "var(--gold2)" : "var(--s3)",
              borderRadius: 4, padding: "4px 8px", cursor: "pointer",
              display: "flex", alignItems: "center",
            }}
          >
            <Star size={14} color={priority ? "var(--gold)" : "var(--t2)"} weight="thin" />
          </button>
          {/* Vice Captain toggle — hidden when caller is already a VC */}
          {!isViceCaptain && (
            <button
              onClick={() => setVcToggle(!vcToggle)}
              style={{
                border: vcToggle ? "0.5px solid var(--gold)" : "0.5px solid var(--s3)",
                background: vcToggle ? "var(--gold2)" : "var(--s3)",
                borderRadius: 4, padding: "4px 8px", cursor: "pointer",
                display: "flex", alignItems: "center",
              }}
            >
              <Shield size={14} color={vcToggle ? "var(--gold)" : "var(--t2)"} weight="thin" />
            </button>
          )}
        </div>
        {/* ADD TO SQUAD button */}
        <button
          onClick={handleAddPlayer}
          disabled={!name.trim() || addLoading}
          style={{
            width: "100%", marginTop: 12, height: 44, borderRadius: 8,
            border: name.trim() && !addLoading ? "0.5px solid var(--greenb)" : "none",
            cursor: name.trim() && !addLoading ? "pointer" : "default",
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.06em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            background: name.trim() && !addLoading ? "var(--green2)" : "var(--s3)",
            color: name.trim() && !addLoading ? "var(--green)" : "var(--t2)",
            opacity: name.trim() && !addLoading ? 1 : 0.5,
            pointerEvents: name.trim() && !addLoading ? "auto" : "none",
          }}
        >
          {addLoading ? "ADDING..." : "+ ADD TO SQUAD"}
        </button>
      </div>

      {/* SQUAD LIST */}
      <div style={{ marginTop: 24 }}>
        <div style={{
          fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 11,
          color: "var(--t2)", letterSpacing: "0.1em", marginBottom: 8,
        }}>
          SQUAD ({activeCount})
        </div>

        {sortedSquad.map(p => {
          const displayName = p.nickname || p.name;
          const host        = p.guestOf ? squad.find(h => h.id === p.guestOf) : null;
          const nameParts   = (displayName || "").trim().split(/\s+/);
          const initial     = nameParts.length >= 2
            ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
            : (displayName || "?").slice(0, 2).toUpperCase();
          const isGuest     = p.isGuest || p.type === "guest";
          const vcDisabled  = p.id === me?.id;
          const avBg        = p.injured ? "rgba(120,20,20,0.3)"             : "rgba(61,220,106,0.14)";
          const avBorder    = p.injured ? "0.5px solid rgba(255,80,80,0.3)" : "0.5px solid rgba(61,220,106,0.45)";
          const avColor     = p.injured ? "rgba(255,100,100,0.8)"           : "var(--green)";
          const avShadow    = p.injured ? "none"                            : "0 0 8px rgba(61,220,106,0.22)";

          return (
            <div key={p.id} style={{
              background: "var(--s2)", borderRadius: 8, padding: 14, marginTop: 8,
              opacity: p.disabled ? 0.4 : 1,
            }}>
              {/* Top row: avatar, name, type pill */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                {/* Avatar — matches Avatar.jsx circle style */}
                <div
                  onClick={() => onPlayerTap?.(p)}
                  style={{
                    width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                    background: avBg, border: avBorder, boxShadow: avShadow,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", position: "relative",
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 500, color: avColor }}>
                    {initial}
                  </span>
                  {p.injured && (
                    <span style={{ position: "absolute", bottom: -2, right: -2, fontSize: 10, lineHeight: 1 }}>
                      🤕
                    </span>
                  )}
                </div>
                {/* Name + subtitle */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 15,
                    color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {displayName}
                  </div>
                  {host && (
                    <div style={{
                      fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 12,
                      color: "var(--t2)", marginTop: 2,
                    }}>
                      Guest of {host.nickname || host.name}
                    </div>
                  )}
                </div>
                {/* Right column: type pill + copy link */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  <span style={{
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: "0.06em",
                    color: isGuest ? "var(--t2)" : "var(--gold)",
                    border: `0.5px solid ${isGuest ? "var(--s3)" : "var(--goldb)"}`,
                    borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap",
                    background: isGuest ? "var(--s3)" : "var(--gold2)",
                  }}>
                    {isGuest ? "GUEST" : "REGULAR"}
                  </span>
                  {!isGuest && (
                    <div
                      onClick={() => {
                        const url = `https://www.in-or-out.com/p/${p.token || p.id}`;
                        navigator.clipboard.writeText(url).then(() => {
                          setCopiedId(p.id);
                          setTimeout(() => setCopiedId(id => id === p.id ? null : id), 2000);
                        });
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 3, cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 11,
                        color: "var(--green)",
                      }}
                    >
                      <Copy size={12} color="var(--green)" weight="thin" />
                      {copiedId === p.id ? "Copied!" : "Copy Link"}
                    </div>
                  )}
                </div>
              </div>

              {/* Action row */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {/* PRIORITY */}
                <button
                  onClick={() => handleTogglePriority(p)}
                  style={{
                    ...btnBase,
                    border:     p.priority ? "0.5px solid var(--goldb)" : "0.5px solid var(--s3)",
                    background: p.priority ? "var(--gold2)" : "var(--s3)",
                    color:      p.priority ? "var(--gold)"  : "var(--t2)",
                  }}
                >
                  <Star size={12} color={p.priority ? "var(--gold)" : "var(--t2)"} weight="thin" />
                  PRIORITY
                </button>

                {/* VICE CAPTAIN — hidden for guests, hidden when caller is VC */}
                {!isGuest && !isViceCaptain && (
                  <button
                    onClick={() => !vcDisabled && handleToggleViceCapt(p)}
                    disabled={vcDisabled}
                    style={{
                      ...btnBase,
                      border:     p.isViceCaptain ? "0.5px solid var(--goldb)" : "0.5px solid var(--s3)",
                      background: p.isViceCaptain ? "var(--gold2)" : "var(--s3)",
                      color:      p.isViceCaptain ? "var(--gold)"  : "var(--t2)",
                      opacity: vcDisabled ? 0.4 : 1,
                      cursor:  vcDisabled ? "default" : "pointer",
                    }}
                  >
                    <Shield size={12} color={p.isViceCaptain ? "var(--gold)" : "var(--t2)"} weight="thin" />
                    VICE CAPTAIN
                  </button>
                )}

                {/* INJURED */}
                <button
                  onClick={() => handleToggleInjured(p)}
                  style={{
                    ...btnBase,
                    border:     p.injured ? "0.5px solid var(--amberb)" : "0.5px solid var(--s3)",
                    background: p.injured ? "var(--amber2)" : "var(--s3)",
                    color:      p.injured ? "var(--amber)"  : "var(--t2)",
                  }}
                >
                  🤕 INJURED
                </button>

                {/* DISABLE / ENABLE */}
                <button
                  onClick={() => handleToggleDisable(p)}
                  style={{
                    ...btnBase,
                    border:     p.disabled ? "0.5px solid var(--goldb)" : "0.5px solid var(--s3)",
                    background: p.disabled ? "var(--gold2)" : "var(--s3)",
                    color:      p.disabled ? "var(--gold)"  : "var(--t2)",
                  }}
                >
                  {p.disabled ? "ENABLE" : "DISABLE"}
                </button>

              </div>
            </div>
          );
        })}
      </div>

      {/* GUEST PROMPT OVERLAY */}
      {guestPrompt && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 50,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div style={{
            background: "var(--s2)", border: "0.5px solid var(--amberb)",
            borderRadius: 12, padding: 24, maxWidth: 360, width: "100%",
          }}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--amber)",
              letterSpacing: "0.04em", marginBottom: 8,
            }}>
              {guestPrompt.hostName} is injured
            </div>
            <p style={{
              fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 14,
              color: "var(--t2)", margin: "0 0 20px",
            }}>
              Keep {guestPrompt.guestName} in the game as a guest?
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={keepGuest}
                style={{
                  flex: 1, height: 44, borderRadius: 8,
                  border: "0.5px solid var(--greenb)", background: "var(--green2)",
                  color: "var(--green)", cursor: "pointer",
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.06em",
                }}
              >
                KEEP
              </button>
              <button
                onClick={removeGuest}
                style={{
                  flex: 1, height: 44, borderRadius: 8,
                  border: "0.5px solid var(--redb)", background: "var(--red2)",
                  color: "var(--red)", cursor: "pointer",
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.06em",
                }}
              >
                REMOVE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INJURY TOAST — 4s auto-dismiss via useEffect */}
      {injuryToast && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          zIndex: 60, maxWidth: 340, width: "calc(100% - 32px)",
          background: "var(--s2)", border: "0.5px solid var(--amberb)",
          borderRadius: 8, padding: "12px 16px",
          fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 13,
          color: "var(--amber)", textAlign: "center",
        }}>
          {injuryToast}
        </div>
      )}

      {/* ERROR TOAST — 3s auto-dismiss via useEffect */}
      {errorToast && (
        <div style={{
          position: "fixed", bottom: 136, left: "50%", transform: "translateX(-50%)",
          zIndex: 60, maxWidth: 340, width: "calc(100% - 32px)",
          background: "var(--s2)", border: "0.5px solid var(--redb)",
          borderRadius: 8, padding: "12px 16px",
          fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 13,
          color: "var(--red)", textAlign: "center",
        }}>
          {errorToast}
        </div>
      )}

    </div>
  );
}
