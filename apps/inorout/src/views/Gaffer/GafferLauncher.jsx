import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { isDormantGuest } from "@platform/core";
import Gaffer from "./index.jsx";
import "./gaffer-tokens.css";

// GafferLauncher — the orb + drag/snap + bottom-sheet chat chrome specified in
// design_handoff_gaffer/README.md. Wraps the existing Gaffer/index.jsx
// message/composer logic unchanged. Dark-mode only for v1 (Locked Decision #4).
// Reduced-motion handled entirely in gaffer-tokens.css.
//
// Audience-agnostic by design (Locked Decision #1) — App.jsx controls who sees
// it via the ENABLE_GAFFER/isAdmin gate; this component doesn't know or care
// about role.

const ORB_SIZE = 68;
const MARGIN = 14;
const TOP_INSET = 46;
const DRAG_THRESHOLD = 6;
const NUDGE_VISIBLE_MS = 3000;
const NOTCH_WIDTH = 28;
const NOTCH_HEIGHT = 64;
const NOTCH_HIT_WIDTH = 44; // hit target padded wider than the 28px visual, height (64) already clears 44

// Real admin-relevant nudge conditions, computed from squad/schedule state
// App.jsx already has loaded (no new RPC — same filters AdminView uses for
// "Chase No-Responses" / "Outstanding" so the numbers always agree with what
// the admin sees on the panel). Checked in priority order; only the most
// pressing condition nudges. Gated to a live, non-draft, non-cancelled week —
// an admin mid-setup or with a cancelled game doesn't need chasing.
function computeNudge(squad, schedule) {
  if (!schedule || schedule.isDraft || schedule.isCancelled) return null;

  // Copy is deliberately informational, not action-offering ("want me to
  // chase it?") — Gaffer is read-only Q&A today (askGafferQuestion has no
  // write/execute path), so a nudge must never imply it can act on a "yes".
  // Tapping it opens the real capability: asking Gaffer about it.
  const totalOwed = squad
    .filter((p) => !p.disabled)
    .reduce((sum, p) => sum + (p.owes || 0), 0);
  if (totalOwed > 0) {
    return { key: `owed:${totalOwed}`, banter: `£${totalOwed} still outstanding — ask me who owes what.` };
  }

  const noRespCount = squad.filter(
    (p) => p.status === "none" && !p.disabled && !p.injured && !isDormantGuest(p)
  ).length;
  if (noRespCount > 0) {
    return {
      key: `noresp:${noRespCount}`,
      banter: `${noRespCount} ${noRespCount === 1 ? "hasn't" : "haven't"} replied yet — ask me who's missing.`,
    };
  }

  const inCount = squad.filter((p) => p.status === "in" && !p.disabled && !p.injured).length;
  const squadSize = schedule.squadSize || 14;
  if (inCount < squadSize) {
    return {
      key: `shortfall:${inCount}/${squadSize}`,
      banter: `Only ${inCount}/${squadSize} confirmed — ask me who's in.`,
    };
  }

  return null;
}

function clampPosition(px, py) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    px: Math.max(MARGIN, Math.min(W - ORB_SIZE - MARGIN, px)),
    py: Math.max(TOP_INSET, Math.min(H - ORB_SIZE - MARGIN, py)),
  };
}

// Which screen edge the orb currently reads as nearest — used both for the
// existing drag-snap and (new) to pick which side the collapsed notch hugs.
function nearestSide(px) {
  const W = window.innerWidth;
  return px + ORB_SIZE / 2 < W / 2 ? "left" : "right";
}

function loadPosition() {
  const fallback = {
    ...clampPosition(window.innerWidth - ORB_SIZE - MARGIN, Math.round(window.innerHeight * 0.54)),
    collapsed: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem("gafferCorePos"));
    if (saved && typeof saved.px === "number" && typeof saved.py === "number") {
      return { ...clampPosition(saved.px, saved.py), collapsed: saved.collapsed === true };
    }
  } catch (err) {
    console.error("[GafferLauncher] failed to read saved position:", err?.message);
  }
  return fallback;
}

function persistPosition(px, py, collapsed) {
  try {
    localStorage.setItem("gafferCorePos", JSON.stringify({ px, py, collapsed }));
  } catch (err) {
    console.error("[GafferLauncher] failed to persist position:", err?.message);
  }
}

export default function GafferLauncher({ adminToken, teamName, squad, schedule }) {
  const [mode, setMode] = useState("idle"); // idle | nudge | dragging
  const [pos, setPos] = useState(loadPosition);
  const [collapsed, setCollapsed] = useState(() => loadPosition().collapsed);
  const [snapping, setSnapping] = useState(false);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const [banter, setBanter] = useState("");

  const launcherRef = useRef(null);
  const dragRef = useRef(null);
  const nudgeTimeoutRef = useRef(null);
  const nudgedKeyRef = useRef(null);

  useEffect(() => {
    if (open || dragRef.current) return;
    const nudge = computeNudge(squad || [], schedule);
    if (!nudge) {
      // Condition resolved — clear the dedup key so a later recurrence at the
      // exact same value (e.g. owed goes £40 -> £0 -> £40 again) re-nudges
      // instead of silently matching the stale key forever.
      nudgedKeyRef.current = null;
      return;
    }
    if (nudge.key === nudgedKeyRef.current) return;
    nudgedKeyRef.current = nudge.key;
    setBanter(nudge.banter);
    setMode("nudge");
    // Deliberately not cleared on unmount: squad/schedule get new references
    // on most re-renders (realtime updates etc), and an effect cleanup tied to
    // this timeout would also fire on React 18 StrictMode's dev-only mount/
    // cleanup/remount dance, clearing the dismiss before it ever runs (the
    // trigger is correctly guarded against re-firing for the same key, so
    // nothing replaces it). A stray setState after a real unmount is a no-op
    // in React 18 — safe to just let it fire.
    clearTimeout(nudgeTimeoutRef.current);
    nudgeTimeoutRef.current = setTimeout(() => {
      setMode((m) => (m === "nudge" ? "idle" : m));
    }, NUDGE_VISIBLE_MS);
  }, [squad, schedule, open]);

  useEffect(() => {
    const onResize = () => setPos((p) => clampPosition(p.px, p.py));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (e) => {
    e.preventDefault();
    // The collapsed notch renders flush to its edge (0 inset), not at pos.px
    // (which stays wherever the orb last was uncollapsed) — so the drag
    // offset has to be measured against that flush x, not pos.px, or the
    // orb would jump to a stale location the instant a notch-drag crosses
    // DRAG_THRESHOLD and un-collapses.
    const effectiveX = collapsed
      ? (nearestSide(pos.px) === "left" ? 0 : window.innerWidth - NOTCH_WIDTH)
      : pos.px;
    dragRef.current = {
      offX: e.clientX - effectiveX,
      offY: e.clientY - pos.py,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      startedCollapsed: collapsed,
    };
    try {
      launcherRef.current?.setPointerCapture(e.pointerId);
    } catch (err) {
      // pointer capture is best-effort; drag still works without it
    }
    if (hint) setHint(false);
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = clampPosition(e.clientX - drag.offX, e.clientY - drag.offY);
    if (!drag.moved && Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > DRAG_THRESHOLD) {
      drag.moved = true;
      // Dragging the notch outward un-collapses it immediately and continues
      // as a normal drag (spec: PR-A "Exit").
      if (drag.startedCollapsed) setCollapsed(false);
    }
    setSnapping(false);
    setPos(next);
    setMode(drag.moved ? "dragging" : mode);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (!drag.moved) {
      if (drag.startedCollapsed) {
        // Tap the notch -> uncollapse + open in one motion.
        setCollapsed(false);
        persistPosition(pos.px, pos.py, false);
      }
      setOpen(true);
      setMode("idle");
      return;
    }
    const W = window.innerWidth;
    const snapX = pos.px + ORB_SIZE / 2 < W / 2 ? MARGIN : W - ORB_SIZE - MARGIN;
    setSnapping(true);
    setMode("idle");
    setPos((p) => ({ px: snapX, py: p.py }));
    persistPosition(snapX, pos.py, false);
    setTimeout(() => setSnapping(false), 340);
  };

  const collapseNow = () => {
    setCollapsed(true);
    persistPosition(pos.px, pos.py, true);
  };

  const nudge = mode === "nudge" && !open;
  const side = nearestSide(pos.px);
  const showChevron = !open && !collapsed && mode === "idle" && !dragRef.current;
  const showHint = hint && !open && !collapsed;
  const scale = mode === "dragging" ? 1.08 : 1;
  const snapTransition = snapping
    ? "transform .32s cubic-bezier(.22,1,.36,1)"
    : "transform .12s ease-out";
  const collapseTransition = "opacity var(--gaffer-collapse-duration) cubic-bezier(.22,1,.36,1), transform var(--gaffer-collapse-duration) cubic-bezier(.22,1,.36,1)";

  return (
    <div className="gaffer-root">
      {showHint && (
        <div
          className="gaffer-hint"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 96,
            transform: "translateX(-50%)",
            zIndex: 130,
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "rgba(20,26,23,.82)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            border: "1px solid rgba(255,255,255,.08)",
            padding: "6px 12px",
            borderRadius: 20,
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 12, color: "rgba(255,255,255,.82)", fontWeight: 500, fontFamily: "var(--gaffer-font-body)" }}>
            Tap Gaffer to chat · hold to drag aside
          </span>
        </div>
      )}

      {!open && (
        // Single persistent button node for both notch and orb looks — the
        // collapsed<->uncollapsed transition happens via style/children only,
        // never by swapping DOM elements, so an active drag (which holds
        // pointer capture on this node) survives the mid-gesture uncollapse
        // (spec: "drag the notch outward -> collapsed:false, continues as a
        // normal drag"). Swapping elements here would drop pointer capture
        // and truncate the drag.
        <button
          type="button"
          ref={launcherRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Open Gaffer assistant"
          style={
            collapsed
              ? {
                  // Hit target (44px) is wider than the visual notch (28px) —
                  // the visual stays flush to [side]:0 as a child, this outer
                  // box just extends the tappable/draggable area inward.
                  position: "fixed",
                  [side]: 0,
                  top: 0,
                  width: NOTCH_HIT_WIDTH,
                  height: NOTCH_HEIGHT,
                  display: "flex",
                  justifyContent: side === "left" ? "flex-start" : "flex-end",
                  zIndex: 130,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "grab",
                  touchAction: "none",
                  transition: `${snapTransition}, ${collapseTransition}`,
                  transform: `translateY(${pos.py}px)`,
                }
              : {
                  position: "fixed",
                  left: 0,
                  top: 0,
                  width: ORB_SIZE,
                  height: ORB_SIZE,
                  zIndex: 130,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "grab",
                  touchAction: "none",
                  transition: `${snapTransition}, ${collapseTransition}`,
                  transform: `translate(${pos.px}px, ${pos.py}px) scale(${scale})`,
                }
          }
        >
          {collapsed ? (
            <div
              className="gaffer-notch-body"
              style={{
                position: "relative",
                width: NOTCH_WIDTH,
                height: NOTCH_HEIGHT,
                overflow: "hidden",
                borderRadius: side === "left" ? "0 20px 20px 0" : "20px 0 0 20px",
                boxShadow: "var(--gaffer-orb-shadow)",
                background: "var(--gaffer-orb-bg)",
                backdropFilter: "blur(5px) saturate(150%) brightness(1.1)",
                WebkitBackdropFilter: "blur(5px) saturate(150%) brightness(1.1)",
              }}
            >
              {/* the orb's inner half, cropped into the notch window */}
              <div
                style={{
                  position: "absolute",
                  [side]: -(ORB_SIZE - NOTCH_WIDTH),
                  top: (NOTCH_HEIGHT - ORB_SIZE) / 2,
                  width: ORB_SIZE,
                  height: ORB_SIZE,
                  borderRadius: "50%",
                  background: "var(--gaffer-orb-bg)",
                  boxShadow: "inset 0 0 7px rgba(255,212,140,.18)",
                }}
              />
              <div
                className={nudge ? "gaffer-notch-q-nudge" : "gaffer-notch-q-idle"}
                style={{
                  position: "absolute",
                  top: "50%",
                  [side === "left" ? "right" : "left"]: 4,
                  transform: "translateY(-50%)",
                  fontFamily: "var(--gaffer-font-body)",
                  fontWeight: 800,
                  fontSize: 22,
                  lineHeight: 1,
                  color: "var(--gaffer-q-color)",
                  textShadow: "var(--gaffer-q-shadow)",
                  opacity: 0.85,
                }}
                aria-hidden="true"
              >
                ?
              </div>
              {nudge && (
                <>
                  <div
                    className="gaffer-orb-dot"
                    role="status"
                    aria-label="Gaffer has an update"
                    style={{
                      position: "absolute",
                      top: 6,
                      [side]: 2,
                      width: "var(--gaffer-dot-size)",
                      height: "var(--gaffer-dot-size)",
                      borderRadius: "50%",
                      background: "var(--gaffer-accent)",
                      boxShadow: "0 0 10px rgba(245,166,35,.95)",
                      zIndex: 3,
                    }}
                  />
                  <div
                    className="gaffer-orb-ripple"
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top: "50%",
                      [side]: "50%",
                      width: NOTCH_HEIGHT,
                      height: NOTCH_HEIGHT,
                      borderRadius: "50%",
                      border: "1px solid rgba(245,166,35,.4)",
                      clipPath: side === "left" ? "inset(0 0 0 50%)" : "inset(0 50% 0 0)",
                    }}
                  />
                </>
              )}
            </div>
          ) : (
            <>
              {nudge && (
                <div
                  className="gaffer-orb-ripple"
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    border: "1px solid rgba(245,166,35,.4)",
                  }}
                />
              )}
              <div
                className="gaffer-orb-body"
                style={{
                  position: "relative",
                  width: ORB_SIZE,
                  height: ORB_SIZE,
                  borderRadius: "50%",
                  overflow: "hidden",
                  boxShadow: "var(--gaffer-orb-shadow)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    background: "var(--gaffer-orb-bg)",
                    backdropFilter: "blur(5px) saturate(150%) brightness(1.1)",
                    WebkitBackdropFilter: "blur(5px) saturate(150%) brightness(1.1)",
                  }}
                />
                <div
                  className="gaffer-orb-core"
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "var(--gaffer-core-glow)",
                    filter: "blur(4px)",
                  }}
                />
                <div
                  className={nudge ? "gaffer-orb-q-nudge" : "gaffer-orb-q-idle"}
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -56%)",
                    fontFamily: "var(--gaffer-font-body)",
                    fontWeight: 800,
                    fontSize: 34,
                    lineHeight: 1,
                    color: "var(--gaffer-q-color)",
                    textShadow: "var(--gaffer-q-shadow)",
                  }}
                  aria-hidden="true"
                >
                  ?
                </div>
                <div
                  className="gaffer-orb-caustic"
                  style={{
                    position: "absolute",
                    inset: 6,
                    borderRadius: "50%",
                    border: "1px solid transparent",
                    borderTopColor: "rgba(255,212,140,.4)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 8,
                    left: 13,
                    width: 22,
                    height: 13,
                    borderRadius: "50%",
                    background: "linear-gradient(160deg, rgba(255,255,255,.5), rgba(255,255,255,0))",
                    filter: "blur(1px)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    boxShadow: "inset 0 0 7px rgba(255,212,140,.18), inset 0 0 0 1px rgba(255,255,255,.07)",
                  }}
                />
              </div>
              {showChevron && (
                // A nested <button> here would be invalid HTML (the outer
                // launcher is itself a <button>) — browsers auto-flatten
                // nested interactive elements, which breaks the hit target.
                // role="button" on a div gets the same semantics safely.
                <div
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    collapseNow();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      e.preventDefault();
                      collapseNow();
                    }
                  }}
                  aria-label="Tuck Gaffer to the edge"
                  style={{
                    position: "absolute",
                    top: "50%",
                    [side === "left" ? "left" : "right"]: -12,
                    transform: "translateY(-50%)",
                    width: 44,
                    height: 44,
                    marginLeft: side === "left" ? -16 : 0,
                    marginRight: side === "right" ? -16 : 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: side === "left" ? "flex-start" : "flex-end",
                    background: "transparent",
                    cursor: "pointer",
                    zIndex: 4,
                  }}
                >
                  {side === "left" ? (
                    <CaretLeft size={20} weight="thin" color="var(--gaffer-t2)" />
                  ) : (
                    <CaretRight size={20} weight="thin" color="var(--gaffer-t2)" />
                  )}
                </div>
              )}
              {nudge && (
                <>
                  <div
                    className="gaffer-orb-dot"
                    role="status"
                    aria-label="Gaffer has an update"
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      width: "var(--gaffer-dot-size)",
                      height: "var(--gaffer-dot-size)",
                      borderRadius: "50%",
                      background: "var(--gaffer-accent)",
                      boxShadow: "0 0 10px rgba(245,166,35,.95)",
                      zIndex: 3,
                    }}
                  />
                  <div
                    className="gaffer-banter"
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      bottom: 78,
                      right: 0,
                      width: 188,
                      background: "var(--gaffer-bubble-bg)",
                      color: "var(--gaffer-bubble-text)",
                      padding: "10px 13px",
                      borderRadius: "14px 14px 4px 14px",
                      fontSize: 12.5,
                      lineHeight: 1.35,
                      fontWeight: 500,
                      fontFamily: "var(--gaffer-font-body)",
                      boxShadow: "0 12px 26px rgba(0,0,0,.5)",
                      border: "1px solid rgba(255,255,255,.07)",
                    }}
                  >
                    {banter}
                  </div>
                </>
              )}
            </>
          )}
        </button>
      )}

      {open && (
        <>
          <div
            className="gaffer-scrim"
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 130, background: "var(--gaffer-scrim)" }}
          />
          <div
            className="gaffer-sheet"
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 131,
              height: "64%",
              maxHeight: "64vh",
              borderRadius: "var(--gaffer-sheet-radius)",
              overflow: "hidden",
              background: "var(--gaffer-panel-bg)",
              backdropFilter: "blur(22px) saturate(150%)",
              WebkitBackdropFilter: "blur(22px) saturate(150%)",
              borderTop: "1px solid var(--gaffer-panel-border)",
              boxShadow: "0 -20px 50px rgba(0,0,0,.5)",
            }}
          >
            <div style={{ padding: "14px 18px 18px", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
              <div style={{ width: 38, height: 4, borderRadius: 3, background: "var(--gaffer-t3)", margin: "0 auto 14px" }} />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  paddingBottom: 14,
                  borderBottom: "1px solid var(--gaffer-card-border)",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    overflow: "hidden",
                    background: "radial-gradient(130% 130% at 32% 24%, #2a1c08, #0c0803 70%)",
                    boxShadow: "0 0 0 1px rgba(245,166,35,.3), 0 0 14px rgba(224,150,30,.4)",
                  }}
                  aria-hidden="true"
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -54%)",
                      fontWeight: 800,
                      fontSize: 15,
                      color: "var(--gaffer-q-color)",
                      textShadow: "0 0 7px rgba(255,212,140,.9)",
                      fontFamily: "var(--gaffer-font-body)",
                    }}
                  >
                    ?
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--gaffer-t1)", lineHeight: 1.1, fontFamily: "var(--gaffer-font-body)" }}>
                    Gaffer
                  </div>
                  <div style={{ fontSize: 11, color: "var(--gaffer-accent-deep)", fontWeight: 600, fontFamily: "var(--gaffer-font-body)" }}>
                    here to help · always on
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close Gaffer"
                  style={{
                    marginLeft: "auto",
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--gaffer-chip-bg)",
                    border: "none",
                    color: "var(--gaffer-t2)",
                    fontSize: 16,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>

              <Gaffer adminToken={adminToken} teamName={teamName} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
