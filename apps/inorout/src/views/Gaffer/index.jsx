import { useEffect, useRef, useState } from "react";
import { askGafferQuestion, gafferProposeAction, gafferConfirmAction } from "@platform/core/storage/supabase.js";
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
// the matching registry action so it renders "Show me" / "Do it for you" —
// only when the sheet was opened by tapping a live nudge (GafferLauncher
// passes null otherwise).
function seedMessages(pendingNudge) {
  if (!pendingNudge) return [];
  const action = actionForNudgeKey(pendingNudge.key);
  return [{
    role: "assistant",
    content: pendingNudge.banter,
    actionChips: action ? [action.actionKey] : [],
  }];
}

// gaffer_propose_action / gaffer_confirm_action raise a specific error
// message text (RAISE EXCEPTION ... MESSAGE='code') that supabase-js
// surfaces as err.message — same pattern as adminSettlePlayer callers
// elsewhere in this app (e.g. AdminPlayerActionSheet.jsx).
function proposeErrorCopy(err) {
  if (err?.message === "act_not_enabled") {
    return "This team isn't opted into Gaffer actions yet.";
  }
  return "Couldn't get that ready right now — try again in a moment.";
}

function confirmErrorCopy(err) {
  if (err?.message === "chase_rate_limited") {
    return "Already chased in the last couple of hours — give it a bit before trying again.";
  }
  if (err?.message === "no_responders_to_chase") {
    return "Looks like everyone's replied now — nothing to chase.";
  }
  if (err?.message === "no_one_owes") {
    return "Looks like everyone's settled up now — nothing to chase.";
  }
  if (err?.message === "no_reserves_to_notify") {
    return "No reserves on the squad right now.";
  }
  if (err?.message === "squad_already_full") {
    return "Squad's full now — no need to notify reserves.";
  }
  if (err?.message === "gaffer_action_already_resolved") {
    return "That's already been handled.";
  }
  return "Couldn't send that just now — try again in a moment.";
}

// The "Done — ..." success message verb phrase, per action.
function doneCopy(actionKey) {
  if (actionKey === "casual.chase_payment") return "sent a payment reminder to";
  if (actionKey === "casual.notify_reserves") return "let the reserves know:";
  return "sent a nudge to"; // casual.chase_no_response
}

// The confirm-screen preview sentence, per action — must describe the RIGHT
// action, not just the right names. Mirrors doneCopy()'s per-action branching:
// chase_payment targets players who owe (they DID reply), notify_reserves
// targets squad reserves, chase_no_response targets non-responders. Names come
// from the propose RPC's live preview (activeConfirm.players), unchanged.
function previewCopy(actionKey, names) {
  if (actionKey === "casual.chase_payment") {
    return names
      ? `Send a payment reminder to ${names} — they've got outstanding fees.`
      : "Everyone's settled up — nothing to chase.";
  }
  if (actionKey === "casual.notify_reserves") {
    return names
      ? `Let the reserves know to stay ready: ${names}.`
      : "No reserves to notify right now.";
  }
  return names // casual.chase_no_response
    ? `Send a nudge to ${names} — they haven't replied yet.`
    : "No one left to chase right now.";
}

export default function Gaffer({ adminToken, teamName, teamId, schedule, pendingNudge, onShowMe }) {
  const [messages, setMessages] = useState(() => seedMessages(pendingNudge));
  // [{ role: 'user'|'assistant', content, actionChips?: string[] }]
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // The one "do it" confirm flow that can be in-flight at a time — tapping
  // "Do it for you" replaces that message's chips with a confirm pair
  // (GAFFER_ACTION_FLOW_HANDOFF.md PR-C Confirm UX spec).
  const [activeConfirm, setActiveConfirm] = useState(null);
  // { messageIndex, actionKey, gafferActionId, players, status: 'confirming'|'sending' }
  const [proposingKey, setProposingKey] = useState(null); // actionKey currently proposing, or null
  const isSendingRef = useRef(false);
  const isProposingRef = useRef(false); // double-fire guard, same pattern as isSavingRef elsewhere
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, activeConfirm]);

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

  // "Do it for you" tap — proposes the action (server re-validates state and
  // returns a live preview), then shows the confirm pair. Only one nudge
  // message can carry actionChips this PR (index 0), so source is always
  // 'nudge' here — kept as a real branch, not hardcoded, for the future
  // chat-suggested path this registry is already shaped for.
  const handleDoIt = async (actionKey, messageIndex) => {
    if (isProposingRef.current) return; // double-fire guard — a re-tap mid-flight
                                         // would otherwise create a second pending
                                         // gaffer_actions row and race activeConfirm
    isProposingRef.current = true;
    setProposingKey(actionKey);
    try {
      const isNudgeOrigin = messageIndex === 0 && !!pendingNudge;
      const result = await gafferProposeAction(
        adminToken,
        actionKey,
        isNudgeOrigin ? pendingNudge.key : null,
        isNudgeOrigin ? "nudge" : "chat"
      );
      setActiveConfirm({
        messageIndex,
        actionKey,
        gafferActionId: result.gaffer_action_id,
        players: result.preview?.players || [],
        status: "confirming",
      });
    } catch (err) {
      console.error("[Gaffer] propose action failed:", err?.message);
      setMessages(prev => [...prev, { role: "assistant", content: proposeErrorCopy(err) }]);
    } finally {
      isProposingRef.current = false;
      setProposingKey(null);
    }
  };

  const handleConfirmNeverMind = () => setActiveConfirm(null);

  const handleConfirmYes = async () => {
    if (!activeConfirm || activeConfirm.status === "sending") return;
    const { actionKey, gafferActionId, players } = activeConfirm;
    setActiveConfirm(c => ({ ...c, status: "sending" }));
    try {
      const result = await gafferConfirmAction(adminToken, gafferActionId, actionKey);
      // casual.chase_no_response (PR-C) leaves the send to the client —
      // identical mechanism to chaseNoResponders() in AdminView/index.jsx,
      // now reachable through Gaffer only via the RPC above (auth + audit +
      // idempotency already done — Locked Decision #2). casual.chase_payment
      // and casual.notify_reserves (PR-D) dispatch the push themselves
      // inside the RPC (result.server_sent === true) — no pre-existing
      // client call to mirror, and net.http_post gets it done in the same
      // transaction as the rate-limit bookkeeping (see migration 472).
      if (!result.server_sent) {
        const gameDate = result.game_date || new Date().toISOString().split("T")[0];
        fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "chaseNoResp",
            teamId,
            playerIds: result.player_ids,
            payload: {
              title: "In or Out ⚽",
              body: `⏰ Are you in or out for ${schedule?.dayOfWeek || "the game"}? Quick reply needed!`,
              icon: "/icons/icon-192.png",
            },
            gameDate,
          }),
        }).catch((err) => console.error("[Gaffer] notify send failed:", err?.message));
      }

      const names = players.map(p => p.name).join(", ") || "the squad";
      setMessages(prev => [...prev, { role: "assistant", content: `Done — ${doneCopy(actionKey)} ${names}.` }]);
      setActiveConfirm(null);
    } catch (err) {
      console.error("[Gaffer] confirm action failed:", err?.message);
      setMessages(prev => [...prev, { role: "assistant", content: confirmErrorCopy(err) }]);
      setActiveConfirm(null);
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
              activeConfirm && activeConfirm.messageIndex === i ? (
                <ConfirmPair confirm={activeConfirm} onYes={handleConfirmYes} onNeverMind={handleConfirmNeverMind} />
              ) : (
                <ActionChips actionKeys={m.actionChips} onShowMe={onShowMe} onDoIt={(key) => handleDoIt(key, i)} proposingKey={proposingKey} />
              )
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
function ActionChips({ actionKeys, onShowMe, onDoIt, proposingKey }) {
  return (
    <div style={chipsRowStyle}>
      {actionKeys.map((actionKey) => {
        const action = GAFFER_ACTIONS[actionKey];
        if (!action) return null;
        const isProposing = proposingKey === actionKey;
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
              <button
                type="button"
                onClick={() => onDoIt?.(actionKey)}
                disabled={isProposing}
                style={chipPrimaryStyle}
              >
                {isProposing ? "Getting ready…" : "Do it for you"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The confirm pair replacing a message's chips once "Do it for you" has been
// tapped: a one-line preview naming the concrete target, then "Yes, do it" /
// "Never mind" (GAFFER_ACTION_FLOW_HANDOFF.md PR-C Confirm UX spec). A
// second tap while status is "sending" is a no-op (handleConfirmYes guards).
function ConfirmPair({ confirm, onYes, onNeverMind }) {
  const names = confirm.players.map(p => p.name).join(", ");
  const preview = previewCopy(confirm.actionKey, names);
  const sending = confirm.status === "sending";
  return (
    <div style={{ paddingTop: 10 }}>
      <div style={{ ...assistantBubbleStyle, maxWidth: "100%", fontSize: 13, opacity: 0.9 }}>
        {preview}
      </div>
      <div style={chipsRowStyle}>
        <button type="button" onClick={onYes} disabled={sending} style={chipPrimaryStyle}>
          {sending ? "Sending…" : "Yes, do it"}
        </button>
        <button type="button" onClick={onNeverMind} disabled={sending} style={chipStyle}>
          Never mind
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
