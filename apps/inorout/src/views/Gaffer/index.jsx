import { useEffect, useRef, useState } from "react";
import { askGafferQuestion } from "@platform/core/storage/supabase.js";
import { GAFFER_ACTIONS, actionForNudgeKey } from "./gafferActions.js";

// Ask the Gaffer — message area + composer, mounted inside GafferLauncher's
// chat sheet (GafferLauncher.jsx owns the scrim/sheet/header chrome per
// GAFFER_UI_HANDOFF.md PR #1). This file owns only the conversation logic:
// state, handleSend, error-message mapping — unchanged from the pre-launcher
// shell this replaces.
//
// Gated by ENABLE_GAFFER in App.jsx — not rendered by default until per-team canary.

const STARTER_PROMPTS = [
  "Who's been most reliable this month?",
  "How much do we have outstanding?",
  "Who's in this week?",
];

// Seeds the conversation with the nudge's banter as message #1, tagged with
// the matching registry action so it renders "Show me" (and, once a PR-C/D
// rpcWrapper exists, "Do it for you") — only when the sheet was opened by
// tapping a live nudge (GafferLauncher passes null otherwise).
function seedMessages(pendingNudge) {
  if (!pendingNudge) return [];
  const action = actionForNudgeKey(pendingNudge.key);
  return [{
    role: "assistant",
    content: pendingNudge.banter,
    actionChips: action ? [action.actionKey] : [],
  }];
}

export default function Gaffer({ adminToken, teamName, pendingNudge, onShowMe }) {
  const [messages, setMessages] = useState(() => seedMessages(pendingNudge));
  // [{ role: 'user'|'assistant', content, actionChips?: string[] }]
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const isSendingRef = useRef(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const sendQuestion = async (q) => {
    if (!q || isSendingRef.current) return;
    isSendingRef.current = true;
    setSending(true);
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: q }]);

    try {
      const res = await askGafferQuestion(adminToken, q);
      if (res?.error) {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: res.error === "ai_key_not_configured"
            ? "Ask the Gaffer isn't connected to AI yet — your admin needs to add the key."
            : res.error === "team_not_enabled"
            ? "Your team isn't on the Gaffer rollout yet. Speak to support."
            : "Couldn't reach the Gaffer right now. Try again in a moment.",
        }]);
      } else {
        // Chat-answer messages don't carry actionChips yet, even though
        // ActionChips/GAFFER_ACTIONS render generically off any message
        // that has them (see the nudge-seeded path above). Deliberate, not
        // an oversight — flagged explicitly per GAFFER_ACTION_FLOW_HANDOFF.md
        // "Missed": askGafferQuestion/apps/inorout/api/gaffer.js is pure
        // free-text Q&A with no tool-calling today, so there is no signal to
        // classify a chat answer into a registry actionKey. Guessing one
        // client-side from res.content would be exactly the free-text-as-
        // action-trigger this epic's Locked Decision #1 forbids. Wiring this
        // path for real needs the edge function constrained to emit a known
        // actionKey (never free text) — a separate, explicitly-scoped change,
        // not a client-side workaround here.
        setMessages(prev => [...prev, { role: "assistant", content: res.content }]);
      }
    } catch (err) {
      console.error("[Gaffer] send failed:", err?.message);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Couldn't reach the Gaffer right now. Try again in a moment.",
      }]);
    } finally {
      isSendingRef.current = false;
      setSending(false);
    }
  };

  const handleSend = () => sendQuestion(input.trim());

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={containerStyle}>
      <div ref={scrollRef} style={messagesStyle}>
        {messages.length === 0 && (
          <div className="gaffer-message" style={greetingBubbleStyle}>
            Ask me anything about {teamName || "your team"} — attendance, payments,
            or this week's squad.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <div
              className="gaffer-message"
              style={m.role === "user" ? userBubbleStyle : assistantBubbleStyle}
            >
              {m.content}
            </div>
            {m.role === "assistant" && m.actionChips?.length > 0 && (
              <ActionChips actionKeys={m.actionChips} onShowMe={onShowMe} />
            )}
          </div>
        ))}
        {sending && (
          <div style={assistantBubbleStyle}>
            <span style={{ opacity: 0.6 }}>Reading the data…</span>
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <div style={chipsRowStyle}>
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendQuestion(prompt)}
              disabled={sending}
              style={chipStyle}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      <div style={composerStyle}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Gaffer…"
          style={inputStyle}
          disabled={sending}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          aria-label="Send message to Gaffer"
          style={sendButtonStyle}
        >
          <span style={playTriangleStyle} />
        </button>
      </div>
    </div>
  );
}

// Renders "Show me" (secondary, always) and "Do it for you" (primary, only
// once the registry row has a real rpcWrapper — PR-C/D). Generic over any
// message carrying actionChips, not just the nudge-seeded first message, so
// a future chat-suggested action (GAFFER_ACTION_FLOW_HANDOFF.md "Missed")
// slots in with no renderer change.
function ActionChips({ actionKeys, onShowMe }) {
  return (
    <div style={chipsRowStyle}>
      {actionKeys.map((actionKey) => {
        const action = GAFFER_ACTIONS[actionKey];
        if (!action) return null;
        return (
          <div key={actionKey} style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => onShowMe?.(action.route)}
              style={chipStyle}
            >
              Show me
            </button>
            {action.rpcWrapper && (
              <button type="button" style={chipPrimaryStyle}>
                Do it for you
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const containerStyle = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  fontFamily: "var(--gaffer-font-body)",
};

const messagesStyle = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  paddingTop: 16,
};

const greetingBubbleStyle = {
  maxWidth: "84%",
  alignSelf: "flex-start",
  background: "var(--gaffer-card)",
  border: "1px solid var(--gaffer-card-border)",
  color: "var(--gaffer-t1)",
  padding: "12px 14px",
  borderRadius: "4px 16px 16px 16px",
  fontSize: 14,
  lineHeight: 1.45,
};

const userBubbleStyle = {
  alignSelf: "flex-end",
  maxWidth: "84%",
  background: "var(--gaffer-accent)",
  color: "var(--gaffer-accent-ink)",
  padding: "10px 14px",
  borderRadius: "16px 16px 4px 16px",
  fontSize: 14,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  fontWeight: 500,
};

const assistantBubbleStyle = {
  alignSelf: "flex-start",
  maxWidth: "84%",
  background: "var(--gaffer-card)",
  border: "1px solid var(--gaffer-card-border)",
  color: "var(--gaffer-t1)",
  padding: "12px 14px",
  borderRadius: "4px 16px 16px 16px",
  fontSize: 14,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
};

const chipsRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  paddingTop: 12,
};

const chipStyle = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--gaffer-t1)",
  background: "var(--gaffer-chip-bg)",
  border: "1px solid var(--gaffer-chip-border)",
  padding: "9px 14px",
  borderRadius: "var(--gaffer-chip-radius)",
  cursor: "pointer",
  fontFamily: "var(--gaffer-font-body)",
};

// Primary chip variant (README §5: "solid accent fill with dark text") —
// distinguishes "Do it for you" from the secondary/translucent "Show me".
const chipPrimaryStyle = {
  ...chipStyle,
  color: "var(--gaffer-accent-ink)",
  background: "var(--gaffer-accent)",
  border: "1px solid var(--gaffer-accent)",
  fontWeight: 600,
};

const composerStyle = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "12px 0 4px",
};

const inputStyle = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  height: 44,
  padding: "0 16px",
  borderRadius: "var(--gaffer-field-radius)",
  background: "var(--gaffer-field-bg)",
  border: "1px solid var(--gaffer-chip-border)",
  fontSize: 13.5,
  color: "var(--gaffer-t1)",
  fontFamily: "var(--gaffer-font-body)",
  outline: "none",
};

const sendButtonStyle = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  background: "var(--gaffer-accent)",
  border: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const playTriangleStyle = {
  width: 0,
  height: 0,
  borderTop: "6px solid transparent",
  borderBottom: "6px solid transparent",
  borderLeft: "10px solid var(--gaffer-accent-ink)",
  marginLeft: 3,
};
