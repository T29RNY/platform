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

  // This component may claim ONLY what the send path can actually DO today — never what
  // _team_debtors merely KNOWS about the player. That distinction is not pedantry: an earlier
  // version rendered reachable_email straight through and told a live admin "14 will get an
  // email" when the RPC had no email leg at all and would send exactly zero. Build was green,
  // EV was 9/9, both reviewers were clean — every gate verified the RPC against itself, and
  // none could see a sheet promising a channel that didn't exist. The operator caught it on
  // his own squad.
  //
  // PR #4 (migs 594) added the email leg for real: the RPC now posts for anyone with push OR
  // email, and notify.js falls back to email when a debtor has no push subscription. So the
  // email line is restored HERE, in the SAME PR that made it true — which is the rule.
  const push        = targets.filter(t => t.has_push).length;
  const email       = targets.filter(t => !t.has_push && t.has_email).length;
  const unreachable = targets.filter(t => !t.has_push && !t.has_email).map(t => t.player_id);

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
          {email > 0 && <div style={row}>✉️ <span>{email} will get an email</span></div>}

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
            // "pushes", not "this" — emails are deliberately NOT quiet-gated (they don't buzz
            // anyone, and the queue only ever re-sends push, so gating them would mean an
            // email-only debtor chased at 22:30 gets nothing at all, ever). Saying "this'll
            // send in the morning" would now be false for them.
            <div style={{ ...row, color:"var(--amber)", fontWeight:300, marginTop:8 }}>
              ⏰ <span>Quiet hours — pushes send in the morning{email > 0 ? "; emails go now" : ""}</span>
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
