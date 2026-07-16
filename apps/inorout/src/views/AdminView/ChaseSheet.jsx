import { useState } from "react";

// Confirm sheet for the debt chase (PR #2 of ADMIN_DEBT_CHASE_HANDOFF.md).
//
// Geometry is lifted from AnnounceModal (same bottom-sheet shell) — its BEHAVIOUR
// deliberately is not. AnnounceModal fires `fetch(...).catch(console.error)` and closes,
// never reading the response; chaseNoResponders does the same and then toasts the count it
// AIMED AT. So both report success even when they reached nobody. That's the bug this whole
// epic exists to remove, so neither is copied here: this sheet shows the truth BEFORE the
// send (while the admin can still act on it) and reports what actually happened after.
//
// Why the truth matters more than it sounds: told "chased Barry" when Barry got nothing,
// the admin doesn't conclude "the push failed" — he concludes "Barry's blanking me". A false
// toast doesn't lose a notification, it manufactures a grudge between mates.

const nameOf = (squad, id) => {
  const p = squad.find(x => x.id === id);
  return p ? (p.nickname || p.name) : "Someone";
};

const money = (n) => `£${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2)}`;

// Names + amounts ONLY — never a /p/<token> link.
// A player's token IS their identity (it opens their whole squad view with no login), so
// pasting one into the team group chat would hand every member that player's access. The
// manifest originally specced a link here; it's a leak, so it's dropped.
export function buildShareText(preview, squad) {
  const parts = (preview?.targets || [])
    .map(t => `${nameOf(squad, t.player_id)} ${money(t.owed)}`)
    .join(", ");
  return `Subs still outstanding — ${parts}. Settle up when you can 👍`;
}

export default function ChaseSheet({ preview, squad, quietHours, onSend, onClose, sending, error }) {
  const [copied, setCopied] = useState(false);

  const targets    = preview?.targets || [];
  const suppressed = preview?.suppressed_count || 0;

  // 🔴 PUSH IS THE ONLY CHANNEL THAT EXISTS TODAY. The RPC returns reachable_email (and
  // an `unreachable` array meaning "no push AND no email AND no phone") because
  // _team_debtors describes the player; but admin_chase_payment can only SEND push —
  // its send loop is `CONTINUE WHEN NOT r.has_push`, and the email leg is PR #4, unbuilt.
  //
  // An earlier version of this sheet rendered reachable_email straight through and told
  // a live admin "14 will get an email" when the RPC would send exactly zero. That is
  // precisely the lie this epic exists to remove — shipped, live, inside the feature
  // built to remove it. Found on the operator's real squad, not by any gate.
  //
  // So the sheet derives reach from has_push ONLY, and says nothing about email until
  // there is an email. Rule: this component may claim ONLY what the RPC can do TODAY —
  // when PR #4 lands the email leg, add it back here IN THE SAME PR, never before.
  const push        = targets.filter(t => t.has_push).length;
  const unreachable = targets.filter(t => !t.has_push).map(t => t.player_id);

  const copyForWhatsApp = async () => {
    const text = buildShareText(preview, squad);
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // A share-sheet dismiss rejects too — not worth surfacing as an error.
      if (e?.name !== "AbortError") console.error("ChaseSheet: share failed", e);
    }
  };

  const row = { display:"flex", alignItems:"center", gap:8, fontSize:13, color:"var(--t1)", marginBottom:6 };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200 }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.55)" }}/>
      <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:430, background:"var(--s1)",
        borderRadius:"var(--r) var(--r) 0 0", padding:"20px 16px 44px",
        border:"0.5px solid var(--border-subtle)" }}>

        <div style={{ fontFamily:"var(--font-display)", fontSize:26, letterSpacing:"0.04em",
          marginBottom:4, color:"var(--t1)" }}>
          Chasing {targets.length} · {money(preview?.total_owed || 0)}
        </div>
        <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginBottom:16 }}>
          The app asks — not you.
        </div>

        {/* Reachability, stated honestly BEFORE the send */}
        <div style={{ marginBottom:14 }}>
          {push > 0 && <div style={row}>📱 <span>{push} will get a push</span></div>}

          {unreachable.length > 0 && (
            <div style={{ marginTop:10, padding:"10px 12px", borderRadius:"var(--rs)",
              background:"rgba(255,64,64,0.08)", border:"0.5px solid var(--redb)" }}>
              <div style={{ fontSize:13, color:"var(--t1)", marginBottom:4 }}>
                ⚠️ {unreachable.length} can&apos;t be reached
              </div>
              <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginBottom:10 }}>
                {unreachable.map(id => nameOf(squad, id)).join(", ")} — no notifications on
              </div>
              <button onClick={copyForWhatsApp}
                style={{ width:"100%", padding:"9px 0", borderRadius:"var(--rs)",
                  background:"transparent", border:"0.5px solid var(--redb)",
                  color:"var(--t1)", fontFamily:"var(--font-body)", fontSize:12,
                  fontWeight:600, cursor:"pointer" }}>
                {copied ? "Copied ✓" : "Copy their names for WhatsApp"}
              </button>
            </div>
          )}

          {suppressed > 0 && (
            <div style={{ ...row, color:"var(--t2)", fontWeight:300, marginTop:8 }}>
              ⏱ <span>{suppressed} already chased in the last 24h — skipped</span>
            </div>
          )}

          {quietHours && (
            <div style={{ ...row, color:"var(--amber)", fontWeight:300, marginTop:8 }}>
              ⏰ <span>Quiet hours — this&apos;ll send in the morning</span>
            </div>
          )}
        </div>

        {error && (
          <div style={{ fontSize:12, color:"var(--red)", fontWeight:300, marginBottom:10 }}>
            {error}
          </div>
        )}

        <button onClick={onSend} disabled={sending || targets.length === 0}
          style={{ width:"100%", padding:"13px 0", borderRadius:"var(--r)", border:"none",
            background: sending || !targets.length ? "var(--s3)" : "var(--gold)",
            color: sending || !targets.length ? "var(--t2)" : "var(--black)",
            fontFamily:"var(--font-body)", fontSize:14, fontWeight:600,
            cursor: sending || !targets.length ? "not-allowed" : "pointer" }}>
          {sending ? "Sending…" : `Chase ${targets.length}`}
        </button>
      </div>
    </div>
  );
}
