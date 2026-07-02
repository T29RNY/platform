import { useEffect, useRef, useState } from "react";
import { askGafferQuestion } from "@platform/core/storage/supabase.js";

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

export default function Gaffer({ adminToken, teamName }) {
  const [messages, setMessages] = useState([]);  // [{ role: 'user'|'assistant', content }]
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
          <div
            key={i}
            className="gaffer-message"
            style={m.role === "user" ? userBubbleStyle : assistantBubbleStyle}
          >
            {m.content}
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
