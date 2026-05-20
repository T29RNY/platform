import { useState } from "react";
import { ONBOARDING_CONFIG as CFG } from "../config.js";

const BASE_URL = "https://www.in-or-out.com";

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ current, total }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i < current ? "var(--gold)" : "var(--s3)",
          }} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--t2)", fontFamily: "var(--font-body)", fontWeight: 300 }}>
        Step {current} of {total}
      </div>
    </div>
  );
}

// ── Copy buttons ──────────────────────────────────────────────────────────────

function AdminCopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} style={{
      padding: "8px 16px", borderRadius: 8, cursor: "pointer",
      border: "1px solid var(--gold)",
      background: "transparent",
      color: "var(--gold)",
      fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300,
      flexShrink: 0, whiteSpace: "nowrap",
    }}>
      {copied ? "Copied ✓" : "Copy link"}
    </button>
  );
}

function PlayerCopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} style={{
      padding: "7px 12px", borderRadius: 7, cursor: "pointer",
      border: "none",
      background: copied ? "var(--green2, #1a3a2a)" : "var(--s3)",
      color: copied ? "var(--green)" : "var(--t2)",
      fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300,
      flexShrink: 0, whiteSpace: "nowrap",
    }}>
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ShareLinks({
  teamId, groupName, adminToken, players,
}) {
  const adminUrl = `${BASE_URL}/admin/${adminToken}`;

  const handleGoAdmin = () => {
    window.location.href = adminUrl;
  };

  return (
    <div style={{ padding: 24, paddingBottom: 48, fontFamily: "var(--font-body)" }}>

      <ProgressBar current={3} total={3} />

      {/* Brand header */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 32,
          letterSpacing: "0.06em", lineHeight: 1, marginBottom: 10,
        }}>
          <span style={{ color: "var(--green)" }}>IN</span>
          <span style={{ color: "var(--t1)" }}> OR </span>
          <span style={{ color: "var(--red)" }}>OUT</span>
        </div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 28, color: "var(--t1)",
          letterSpacing: "0.06em", marginBottom: 6,
        }}>
          YOU'RE LIVE 🎉
        </div>
        <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5 }}>
          {CFG.steps.shareLinks.subtitle}
        </div>
      </div>

      {/* Admin card */}
      <div style={{
        background: "var(--s1)", border: "1px solid var(--goldb)",
        borderRadius: 12, padding: 16, marginBottom: 20,
      }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 11, color: "var(--gold)",
          letterSpacing: "0.08em", marginBottom: 4,
        }}>
          YOUR ADMIN LINK — KEEP THIS PRIVATE
        </div>
        <div style={{ fontSize: 12, color: "var(--t2)", fontWeight: 300, marginBottom: 12, lineHeight: 1.4 }}>
          This is how you manage your team. Bookmark it now.
        </div>
        <div style={{
          fontSize: 12, color: "var(--t1)", fontWeight: 300,
          background: "var(--bg)", padding: "10px 12px", borderRadius: 8,
          border: "1px solid var(--s3)", marginBottom: 12,
          wordBreak: "break-all",
        }}>
          {adminUrl}
        </div>
        <AdminCopyButton text={adminUrl} />
      </div>

      {/* Player rows */}
      {players.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 11, color: "var(--t2)",
            letterSpacing: "0.08em", marginBottom: 12,
          }}>
            PLAYER LINKS — SHARE VIA WHATSAPP
          </div>
          {players.map(p => {
            const playerUrl = `${BASE_URL}/p/${p.token}`;
            const waMsg = CFG.whatsappMessage(groupName, playerUrl);
            const waUrl = `https://wa.me/?text=${encodeURIComponent(waMsg)}`;
            return (
              <div key={p.id} style={{
                background: "var(--s2)", borderRadius: 10,
                padding: "12px 14px", marginBottom: 8,
              }}>
                <div style={{ fontSize: 14, color: "var(--t1)", fontWeight: 300, marginBottom: 8 }}>
                  {p.name}
                </div>
                <div style={{
                  fontSize: 11, color: "var(--t2)", fontWeight: 300,
                  marginBottom: 10, wordBreak: "break-all",
                }}>
                  {playerUrl}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <PlayerCopyButton text={playerUrl} />
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "7px 12px", borderRadius: 7, border: "none",
                      background: "#25D366", color: "#000",
                      fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.06em",
                      cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
                      textDecoration: "none", display: "inline-block",
                    }}
                  >
                    WHATSAPP
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* No-players fallback */}
      {players.length === 0 && (
        <div style={{
          padding: "14px 16px", borderRadius: 10, marginBottom: 20,
          background: "var(--s2)", border: "1px solid var(--s3)",
          fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5,
        }}>
          No players added yet. You can add them from Admin → Squad anytime.
        </div>
      )}

      {/* CTA */}
      <button
        onClick={handleGoAdmin}
        style={{
          width: "100%", padding: 16, borderRadius: 12, border: "none",
          background: "var(--gold)", color: "#000",
          fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "0.06em",
          cursor: "pointer",
        }}
      >
        {CFG.steps.shareLinks.cta}
      </button>

    </div>
  );
}
