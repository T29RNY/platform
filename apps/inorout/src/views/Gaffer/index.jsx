import { useState, useRef, useEffect } from "react";
import { colors as C } from "@platform/core";
import SYSTEM_PROMPT from "./systemPrompt.js";

// Inject CSS once for animations
let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes _gafferDot {
      0%, 80%, 100% { opacity: 0.2; transform: scale(0.7); }
      40% { opacity: 1; transform: scale(1); }
    }
    @keyframes _gafferPulse {
      0%   { box-shadow: 0 0 0 0   rgba(251,191,36,0.7); }
      70%  { box-shadow: 0 0 0 14px rgba(251,191,36,0);   }
      100% { box-shadow: 0 0 0 0   rgba(251,191,36,0);   }
    }
    @keyframes _gafferSlideUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);   opacity: 1; }
    }
    .gaffer-highlight {
      animation: _gafferPulse 0.9s ease-out 3;
      border-radius: 6px;
    }
    ._gaffer-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #888; display: inline-block; margin: 0 2px;
    }
    ._gaffer-dot:nth-child(1) { animation: _gafferDot 1.3s infinite 0s; }
    ._gaffer-dot:nth-child(2) { animation: _gafferDot 1.3s infinite 0.2s; }
    ._gaffer-dot:nth-child(3) { animation: _gafferDot 1.3s infinite 0.4s; }
  `;
  document.head.appendChild(style);
}

function parseAction(text) {
  const lines = text.split("\n");
  let action = null;
  const displayLines = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('{"action":')) {
      try {
        const parsed = JSON.parse(t);
        if (parsed.action?.type) { action = parsed.action; continue; }
      } catch {}
    }
    displayLines.push(line);
  }
  return { displayText: displayLines.join("\n").trim(), action };
}

function executeHighlightScroll(action) {
  const el = document.querySelector(`[data-gaffer-target="${action.target}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  if (action.type === "highlight") {
    el.classList.remove("gaffer-highlight");
    void el.offsetWidth; // reflow to restart animation
    el.classList.add("gaffer-highlight");
    setTimeout(() => el.classList.remove("gaffer-highlight"), 3000);
  }
}

// ── Feedback section per message ──────────────────────────────────────────────

function FeedbackRow({ msg, onFeedback }) {
  const [step, setStep]     = useState("idle"); // idle | reasons | text | done
  const [reason, setReason] = useState(null);
  const [freeText, setFree] = useState("");

  if (step === "done") return (
    <div style={{ fontFamily: "Inter,sans-serif", fontSize: 11, color: C.muted, marginTop: 6 }}>
      Thanks for the feedback
    </div>
  );

  if (step === "text") return (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={freeText}
        onChange={e => setFree(e.target.value)}
        placeholder="tell us more (optional)"
        rows={2}
        style={{
          width: "100%", padding: "8px 10px", borderRadius: 6,
          border: `1px solid ${C.border}`, background: "#0a0a0a", color: C.text,
          fontFamily: "Inter,sans-serif", fontSize: 12, outline: "none",
          boxSizing: "border-box", resize: "none", marginBottom: 6,
        }}
      />
      <button
        onClick={() => { onFeedback(reason, freeText); setStep("done"); }}
        style={{
          padding: "5px 14px", borderRadius: 4, border: `1px solid ${C.amber}`,
          background: C.amber + "18", color: C.amber,
          fontFamily: "Inter,sans-serif", fontSize: 11, fontWeight: 700, cursor: "pointer",
        }}
      >
        Send
      </button>
    </div>
  );

  if (step === "reasons") return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
      {[
        ["not_what_i_meant", "Not what I meant"],
        ["didnt_answer",     "Didn't answer my question"],
        ["bug",              "Looks like a bug"],
      ].map(([r, label]) => (
        <button
          key={r}
          onClick={() => { setReason(r); setStep("text"); }}
          style={{
            padding: "5px 11px", borderRadius: 4,
            border: `1px solid ${C.border}`, background: "transparent", color: C.muted,
            fontFamily: "Inter,sans-serif", fontSize: 11, cursor: "pointer",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <button
        onClick={() => { onFeedback("positive", null); setStep("done"); }}
        style={{
          padding: "3px 9px", borderRadius: 4, border: `1px solid ${C.border}`,
          background: "transparent", color: C.muted,
          fontFamily: "Inter,sans-serif", fontSize: 13, cursor: "pointer",
        }}
      >
        👍
      </button>
      <button
        onClick={() => setStep("reasons")}
        style={{
          padding: "3px 9px", borderRadius: 4, border: `1px solid ${C.border}`,
          background: "transparent", color: C.muted,
          fontFamily: "Inter,sans-serif", fontSize: 13, cursor: "pointer",
        }}
      >
        👎
      </button>
    </div>
  );
}

// ── Main Gaffer component ─────────────────────────────────────────────────────

export default function Gaffer({ context, onNavigate, isBlocked }) {
  const [isOpen,   setIsOpen]   = useState(false);
  const [isPeek,   setIsPeek]   = useState(false);
  const [peekMsg,  setPeekMsg]  = useState("");
  const [messages, setMessages] = useState([
    { id: "init", role: "gaffer", content: "How can I help?" },
  ]);
  const [input,       setInput]       = useState("");
  const [isTyping,    setIsTyping]    = useState(false);
  const [slowWarning, setSlowWarning] = useState(false);
  const [lastUserMsg, setLastUserMsg] = useState("");

  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);
  const drawerRef      = useRef(null);
  const timeoutRef     = useRef(null);
  const slowRef        = useRef(null);
  const startTimeRef   = useRef(null);

  useEffect(() => { injectStyles(); }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    if ((isOpen || isPeek) && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping, isOpen]);

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 120);
  }, [isOpen]);

  // Keyboard avoidance via visualViewport
  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      if (!drawerRef.current) return;
      const maxH = Math.floor(vv.height * 0.92);
      drawerRef.current.style.height = `${Math.min(maxH, Math.floor(window.innerHeight * 0.92))}px`;
    };
    vv.addEventListener("resize", handler);
    return () => vv.removeEventListener("resize", handler);
  }, [isOpen]);

  // Posthog logger
  const logQuery = (question, responseTimeMs, errorType, feedback, feedbackReason, feedbackText) => {
    window.posthog?.capture("ref_query", {
      question,
      screen:        context?.currentScreen,
      isAdmin:       context?.isAdmin,
      playerStatus:  context?.playerStatus,
      isMember:      context?.isMember,
      responseTimeMs,
      feedback:      feedback || null,
      feedbackReason: feedbackReason || null,
      feedbackText:  feedbackText || null,
      likelyBug:     feedbackReason === "bug",
      errorType:     errorType || null,
    });
  };

  const sendMessage = async (text) => {
    const trimmed = (text || "").trim();
    if (!trimmed || isTyping) return;

    const userMsg = { id: `u_${Date.now()}`, role: "user", content: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsTyping(true);
    setSlowWarning(false);
    setLastUserMsg(trimmed);
    startTimeRef.current = Date.now();

    // Slow + hard timeout
    slowRef.current    = setTimeout(() => setSlowWarning(true), 60000);
    timeoutRef.current = setTimeout(() => {
      clearTimeout(slowRef.current);
      setIsTyping(false);
      setSlowWarning(false);
      setMessages(prev => [...prev, {
        id: `err_${Date.now()}`, role: "gaffer",
        content: "Taking too long — try again in a sec.",
        errorType: "timeout", userQuestion: trimmed,
      }]);
      logQuery(trimmed, 120000, "timeout", null, null, null);
    }, 120000);

    try {
      const systemPrompt = SYSTEM_PROMPT.replace("{context}", JSON.stringify(context || {}));
      const windowMsgs = newMessages.slice(-10).map(m => ({
        role: m.role === "gaffer" ? "assistant" : "user",
        content: m.content,
      }));

      const res = await fetch("/api/gaffer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: windowMsgs, systemPrompt }),
      });

      clearTimeout(timeoutRef.current);
      clearTimeout(slowRef.current);

      if (!res.ok) throw new Error("network");

      const { text: responseText } = await res.json();
      const responseTimeMs = Date.now() - startTimeRef.current;
      const { displayText, action } = parseAction(responseText);

      const gafferMsg = {
        id: `g_${Date.now()}`, role: "gaffer",
        content: displayText, responseTimeMs,
        userQuestion: trimmed, errorType: null,
      };

      setMessages(prev => [...prev, gafferMsg]);
      setIsTyping(false);
      setSlowWarning(false);
      logQuery(trimmed, responseTimeMs, null, null, null, null);

      // Execute action and enter peek mode
      if (action) {
        if (action.type === "navigate" && !isBlocked) {
          onNavigate?.(action.target);
          setPeekMsg(displayText);
          setIsPeek(true);
          setIsOpen(false);
        } else if (action.type === "highlight" || action.type === "scroll") {
          executeHighlightScroll(action);
          setPeekMsg(displayText);
          setIsPeek(true);
          setIsOpen(false);
        }
      }
    } catch {
      clearTimeout(timeoutRef.current);
      clearTimeout(slowRef.current);
      const elapsed = Date.now() - startTimeRef.current;
      setIsTyping(false);
      setSlowWarning(false);
      setMessages(prev => [...prev, {
        id: `err_${Date.now()}`, role: "gaffer",
        content: "Can't connect right now — check your signal and try again.",
        errorType: "network", userQuestion: trimmed,
      }]);
      logQuery(trimmed, elapsed, "network", null, null, null);
    }
  };

  const handleFeedback = (msgId, userQuestion, responseTimeMs) => (reason, text) => {
    const isPositive = reason === "positive";
    logQuery(
      userQuestion, responseTimeMs, null,
      isPositive ? "positive" : "negative",
      isPositive ? null : reason,
      text || null,
    );
  };

  const openDrawer = () => { setIsOpen(true); setIsPeek(false); };
  const closeDrawer = () => { setIsOpen(false); setIsPeek(false); };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── Peek bar ──────────────────────────────────────────────────────────────

  if (isPeek && !isOpen) {
    return (
      <div
        onClick={openDrawer}
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9997,
          height: 60, background: "#111", cursor: "pointer",
          borderTop: `1px solid ${C.border}`, borderRadius: "14px 14px 0 0",
          display: "flex", alignItems: "center", gap: 10,
          padding: "0 16px",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <span style={{ fontSize: 20, flexShrink: 0 }}>⚽</span>
        <span style={{
          flex: 1, fontFamily: "Inter,sans-serif", fontSize: 12, color: C.muted,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {peekMsg}
        </span>
        <span style={{
          fontFamily: "Inter,sans-serif", fontSize: 11, color: C.amber,
          fontWeight: 700, flexShrink: 0,
        }}>
          tap to expand
        </span>
      </div>
    );
  }

  // ── Floating ball ─────────────────────────────────────────────────────────

  return (
    <>
      {!isOpen && (
        <button
          onClick={openDrawer}
          aria-label="Ask the Gaffer"
          style={{
            position: "fixed", right: 16,
            bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
            zIndex: 9997, width: 52, height: 52, borderRadius: "50%",
            border: "none", background: C.amber, fontSize: 26, cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ⚽
        </button>
      )}

      {/* Overlay */}
      {isOpen && (
        <div
          onClick={closeDrawer}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            zIndex: 9998,
          }}
        />
      )}

      {/* Drawer */}
      {isOpen && (
        <div
          ref={drawerRef}
          style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999,
            height: "75dvh", maxHeight: "92dvh",
            background: "#111", borderRadius: "16px 16px 0 0",
            border: `1px solid ${C.border}`, borderBottom: "none",
            display: "flex", flexDirection: "column",
            animation: "_gafferSlideUp 0.25s ease",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 18px 12px",
            borderBottom: `1px solid ${C.border}`, flexShrink: 0,
          }}>
            <div style={{ fontFamily: "Bebas Neue,sans-serif", fontSize: 18,
              color: C.amber, letterSpacing: 1.5 }}>
              Ask the Gaffer 🟡
            </div>
            <button
              onClick={closeDrawer}
              style={{
                background: "none", border: "none", color: C.muted,
                fontSize: 18, cursor: "pointer", padding: "2px 4px",
                fontFamily: "Inter,sans-serif",
              }}
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "14px 16px",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            {messages.map((msg) => {
              const isGaffer = msg.role === "gaffer";
              return (
                <div key={msg.id} style={{
                  display: "flex", flexDirection: "column",
                  alignItems: isGaffer ? "flex-start" : "flex-end",
                }}>
                  <div style={{
                    maxWidth: "85%", padding: "10px 13px", borderRadius: 10,
                    background: isGaffer ? "#1e1e1e" : C.amber + "20",
                    border: `1px solid ${isGaffer ? C.border : C.amber + "40"}`,
                    fontFamily: "Inter,sans-serif", fontSize: 13,
                    color: isGaffer ? C.text : C.amber,
                    lineHeight: 1.55, whiteSpace: "pre-wrap",
                  }}>
                    {msg.content}
                  </div>
                  {isGaffer && !msg.errorType && msg.id !== "init" && (
                    <FeedbackRow
                      msg={msg}
                      onFeedback={handleFeedback(msg.id, msg.userQuestion, msg.responseTimeMs)}
                    />
                  )}
                </div>
              );
            })}

            {/* Typing indicator */}
            {isTyping && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: "#1e1e1e", border: `1px solid ${C.border}`,
                  display: "inline-flex", alignItems: "center", gap: 2,
                  alignSelf: "flex-start",
                }}>
                  <span className="_gaffer-dot" />
                  <span className="_gaffer-dot" />
                  <span className="_gaffer-dot" />
                </div>
                {slowWarning && (
                  <div style={{
                    fontFamily: "Inter,sans-serif", fontSize: 11,
                    color: C.muted, paddingLeft: 4,
                  }}>
                    Still thinking... ⚽
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div style={{
            padding: "10px 12px",
            borderTop: `1px solid ${C.border}`,
            display: "flex", gap: 8, flexShrink: 0,
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about the app..."
              disabled={isTyping}
              style={{
                flex: 1, padding: "11px 13px", borderRadius: 8,
                border: `1.5px solid ${input ? C.amber + "80" : C.border}`,
                background: "#0a0a0a", color: C.text,
                fontFamily: "Inter,sans-serif", fontSize: 13,
                outline: "none",
                opacity: isTyping ? 0.5 : 1,
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isTyping}
              style={{
                padding: "11px 16px", borderRadius: 8, border: "none",
                background: input.trim() && !isTyping ? C.amber : "#2a2a2a",
                color: input.trim() && !isTyping ? "#000" : C.muted,
                fontFamily: "Inter,sans-serif", fontSize: 13, fontWeight: 700,
                cursor: input.trim() && !isTyping ? "pointer" : "not-allowed",
                flexShrink: 0,
              }}
            >
              ↑
            </button>
          </div>
        </div>
      )}
    </>
  );
}
