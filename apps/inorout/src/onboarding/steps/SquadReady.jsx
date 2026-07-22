import { useEffect, useState } from "react";
import { WhatsappLogo, CopySimple, ArrowRight } from "@phosphor-icons/react";
import { track } from "@platform/core";

const BASE_URL = "https://app.in-or-out.com";

function SquadReadyStyles() {
  return (
    <style>{`
      @keyframes squadReadyFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      .squad-ready-shell {
        min-height: 100dvh;
        width: 100%;
        position: relative;
        display: flex;
        flex-direction: column;
        background: var(--bg);
      }

      .squad-ready-scroll {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: max(28px, env(safe-area-inset-top)) 24px 24px;
        animation: squadReadyFadeIn 400ms ease both;
      }

      .squad-ready-orb {
        position: fixed;
        width: 200px;
        height: 200px;
        border-radius: 999px;
        filter: blur(60px);
        opacity: 0.32;
        pointer-events: none;
        z-index: 0;
      }

      .squad-ready-orb--green {
        top: -60px;
        left: -60px;
        background: rgba(61, 220, 106, 0.28);
      }

      .squad-ready-orb--gold {
        bottom: -60px;
        right: -60px;
        background: rgba(232, 160, 32, 0.24);
      }

      .squad-ready-inner {
        width: 100%;
        max-width: 410px;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        position: relative;
        z-index: 2;
      }

      .squad-ready-team {
        font-family: "Bebas Neue", sans-serif;
        font-size: clamp(32px, 9vw, 44px);
        letter-spacing: 0.045em;
        color: var(--gold);
        line-height: 1;
        margin: 0 0 8px;
        text-shadow: 0 0 28px rgba(232, 160, 32, 0.22);
      }

      .squad-ready-title {
        font-family: "Bebas Neue", sans-serif;
        font-size: clamp(46px, 13vw, 58px);
        letter-spacing: 0.045em;
        color: var(--t1);
        line-height: 0.95;
        margin: 0 0 12px;
      }

      .squad-ready-sub {
        font-family: "DM Sans", sans-serif;
        font-weight: 300;
        font-size: 14px;
        color: var(--t2);
        margin: 0 0 32px;
        line-height: 1.4;
      }

      .squad-ready-whatsapp {
        width: 100%;
        min-height: 56px;
        border-radius: 14px;
        border: none;
        background: var(--whatsapp);
        color: var(--t1);
        font-family: "DM Sans", sans-serif;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease, opacity 160ms ease;
        margin-bottom: 12px;
        text-decoration: none;
      }

      .squad-ready-whatsapp:active {
        transform: scale(0.98);
      }

      .squad-ready-copy {
        width: 100%;
        min-height: 48px;
        border-radius: 14px;
        border: 1px solid rgba(242, 240, 234, 0.15);
        background: var(--s1);
        color: var(--t2);
        font-family: "DM Sans", sans-serif;
        font-size: 14px;
        font-weight: 400;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        -webkit-tap-highlight-color: transparent;
        transition: all 160ms ease;
      }

      .squad-ready-copy--copied {
        border-color: rgba(61, 220, 106, 0.4);
        color: var(--green);
      }

      .squad-ready-divider {
        width: 100%;
        height: 1px;
        background: rgba(242, 240, 234, 0.08);
        margin: 32px 0;
      }

      .squad-ready-footer {
        position: sticky;
        bottom: 0;
        width: 100%;
        background: var(--bg);
        padding: 16px 24px max(24px, env(safe-area-inset-bottom));
        border-top: 1px solid rgba(242, 240, 234, 0.06);
        z-index: 3;
      }

      .squad-ready-footer-inner {
        max-width: 410px;
        margin: 0 auto;
      }

      .squad-ready-cta {
        width: 100%;
        height: 52px;
        border-radius: 12px;
        border: none;
        cursor: pointer;
        background: var(--green);
        color: var(--bg);
        font-family: "DM Sans", sans-serif;
        font-size: 16px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease;
      }

      .squad-ready-cta:active {
        transform: scale(0.98);
      }
    `}</style>
  );
}

export default function SquadReady({ groupName, joinCode, adminToken, adminPlayerToken }) {
  const joinUrl  = `${BASE_URL}/join/${joinCode}`;
  const adminUrl = `${BASE_URL}/admin/${adminToken}`;
  const waText   = encodeURIComponent(`Join ${groupName} on In or Out 👊\n${joinUrl}`);
  const waUrl    = `https://wa.me/?text=${waText}`;

  const [copied, setCopied] = useState(false);

  const handleAdvance = () => {
    track("squad_ready_cta_tapped", { flow: "create" });
    window.location.href = adminUrl;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent fail — clipboard unavailable
    }
  };

  useEffect(() => {
    navigator.vibrate?.(200);
    // Belt-and-braces breadcrumb. Survives if iOS PWA shares localStorage
    // with Safari on this version (it usually doesn't — see manifest swap
    // below for the actual fix).
    const path = `/admin/${adminToken}`;
    localStorage.setItem('ioo_last_visited', path);
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
      localStorage.setItem('ioo_redirect_to', JSON.stringify({ path, ts: Date.now() }));
    }
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // CRITICAL — iOS PWA install path. Do NOT remove or refactor without
  // reading apps/inorout/api/manifest.js + apps/inorout/vercel.json headers
  // config FIRST.
  //
  // Swaps the linked manifest to /api/manifest?admin=<token> so iOS bakes
  // /admin/<token> as the home-screen launch URL at install time.
  // localStorage breadcrumbs above are belt-and-braces — iOS partitions PWA
  // storage from Safari storage on most versions, so the manifest swap is
  // the only reliable path.
  //
  // Rules:
  // - useEffect deps MUST include adminToken (NOT empty array). adminToken
  //   may be undefined on first render under StrictMode or render races.
  // - early-return guard MUST check adminToken before swapping.
  // - NO cleanup function. App.jsx's root-level effect owns restoration on
  //   route change. Restoring here would thrash under StrictMode.
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!adminToken) return;
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    link.setAttribute('href', `/api/manifest?admin=${encodeURIComponent(adminToken)}`);
  }, [adminToken]);

  return (
    <>
      <SquadReadyStyles />
      <main className="squad-ready-shell" data-tour-suppress="squad-ready">
        <div className="squad-ready-orb squad-ready-orb--green" />
        <div className="squad-ready-orb squad-ready-orb--gold" />

        <div className="squad-ready-scroll">
          <div className="squad-ready-inner">
            <p className="squad-ready-team">
              {groupName}
            </p>
            <h1 className="squad-ready-title">
              Squad Ready
            </h1>
            <p className="squad-ready-sub">
              Now invite your players
            </p>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="squad-ready-whatsapp"
            >
              <WhatsappLogo size={22} weight="thin" />
              Share on WhatsApp
            </a>
            <button
              type="button"
              className={"squad-ready-copy" + (copied ? " squad-ready-copy--copied" : "")}
              onClick={handleCopy}
            >
              <CopySimple size={18} weight="thin" />
              {copied ? "Copied!" : "Copy squad link"}
            </button>
          </div>
        </div>

        <div className="squad-ready-footer">
          <div className="squad-ready-footer-inner">
            <button
              type="button"
              className="squad-ready-cta"
              onClick={handleAdvance}
            >
              Go to my team
              <ArrowRight size={16} weight="thin" />
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
