import { useEffect, useRef, useState } from "react";
import { askGafferQuestion } from "@platform/supabase";

// Ask the Gaffer — admin Q&A panel.
// Replaces the previous player-facing app-help chatbot (archived as _archived_chatbot.jsx).
// Surfaces other than 'qa' use <GafferCard surface=... /> inline elsewhere.
//
// Gated by ENABLE_GAFFER in App.jsx — not rendered by default until per-team canary.

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

  const handleSend = async () => {
    const q = input.trim();
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

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div style={titleStyle}>Ask the Gaffer</div>
        <div style={subtitleStyle}>
          Your AI assistant for {teamName || "your team"}. Ask anything about attendance, scoring, payments, or this week's squad.
        </div>
      </div>

      <div ref={scrollRef} style={messagesStyle}>
        {messages.length === 0 && (
          <div style={emptyStyle}>
            Try asking: "Who's been most reliable this month?" or "How much do we have outstanding?"
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={m.role === "user" ? userBubbleStyle : assistantBubbleStyle}>
            {m.content}
          </div>
        ))}
        {sending && (
          <div style={assistantBubbleStyle}>
            <span style={{ opacity: 0.6 }}>Reading the data…</span>
          </div>
        )}
      </div>

      <div style={composerStyle}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the Gaffer…"
          rows={2}
          style={inputStyle}
          disabled={sending}
        />
        <button onClick={handleSend} disabled={sending || !input.trim()} style={sendButtonStyle}>
          Send
        </button>
      </div>
    </div>
  );
}

const containerStyle = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "var(--bg)",
  fontFamily: "var(--font-body)",
};

const headerStyle = {
  padding: "16px 16px 12px",
  borderBottom: "1px solid var(--line)",
};

const titleStyle = {
  fontFamily: "var(--font-display)",
  fontSize: 22,
  letterSpacing: 1.5,
  color: "var(--t1)",
};

const subtitleStyle = {
  fontSize: 13,
  color: "var(--t3)",
  marginTop: 4,
  lineHeight: 1.4,
};

const messagesStyle = {
  flex: 1,
  overflowY: "auto",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const emptyStyle = {
  fontSize: 13,
  color: "var(--t3)",
  fontStyle: "italic",
  textAlign: "center",
  marginTop: 40,
  padding: "0 24px",
  lineHeight: 1.5,
};

const userBubbleStyle = {
  alignSelf: "flex-end",
  maxWidth: "85%",
  background: "var(--bg2)",
  color: "var(--t1)",
  padding: "10px 14px",
  borderRadius: 14,
  fontSize: 14,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

const assistantBubbleStyle = {
  alignSelf: "flex-start",
  maxWidth: "85%",
  background: "transparent",
  color: "var(--t1)",
  padding: "10px 0",
  fontSize: 15,
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
};

const composerStyle = {
  borderTop: "1px solid var(--line)",
  padding: 12,
  display: "flex",
  gap: 8,
  alignItems: "flex-end",
};

const inputStyle = {
  flex: 1,
  background: "var(--bg2)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 15,
  color: "var(--t1)",
  fontFamily: "var(--font-body)",
  resize: "none",
  outline: "none",
};

const sendButtonStyle = {
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: 10,
  padding: "10px 18px",
  fontSize: 14,
  fontFamily: "var(--font-display)",
  letterSpacing: 1,
  cursor: "pointer",
};
