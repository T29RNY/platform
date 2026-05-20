import { useState, useRef } from "react";
import { supabase } from "@platform/supabase";
import { EnvelopeSimple, PaperPlaneTilt, User } from "@phosphor-icons/react";

function JoinStyles() {
  return (
    <style>{`
      .join-shell {
        min-height: 100dvh;
        width: 100%;
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: max(28px, env(safe-area-inset-top)) 20px max(28px, env(safe-area-inset-bottom));
        background: var(--bg);
        color: var(--t1);
        font-family: "DM Sans", sans-serif;
      }

      .join-shell--checking {}

      .join-orb {
        position: absolute;
        width: 220px;
        height: 220px;
        border-radius: 999px;
        filter: blur(54px);
        opacity: 0.32;
        pointer-events: none;
      }

      .join-orb--green {
        top: 12%;
        left: -120px;
        background: rgba(61, 220, 106, 0.28);
      }

      .join-orb--red {
        top: 8%;
        right: -130px;
        background: rgba(255, 64, 64, 0.22);
      }

      .join-orb--gold {
        bottom: -110px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(232, 160, 32, 0.24);
      }

      .join-inner {
        width: 100%;
        max-width: 410px;
        position: relative;
        z-index: 2;
      }

      .join-brand {
        display: flex;
        justify-content: center;
        align-items: baseline;
        font-family: "Bebas Neue", sans-serif;
        font-size: clamp(64px, 17vw, 92px);
        line-height: 0.9;
        letter-spacing: 0.045em;
        color: var(--t1);
        text-transform: uppercase;
        user-select: none;
      }

      .join-brand--small {
        font-size: clamp(32px, 10vw, 44px);
        letter-spacing: 0.07em;
        margin-bottom: 48px;
      }

      .join-brand--quiet {
        animation: joinQuietPulse 1.8s ease-in-out infinite;
      }

      .join-brand__green {
        color: var(--green);
        text-shadow: 0 0 24px rgba(61, 220, 106, 0.48);
      }

      .join-brand__red {
        color: var(--red);
        text-shadow: 0 0 24px rgba(255, 64, 64, 0.42);
      }

      @keyframes joinQuietPulse {
        0%, 100% { opacity: 0.62; transform: scale(0.985); }
        50%       { opacity: 1;    transform: scale(1);     }
      }

      @media (max-width: 380px) {
        .join-shell  { padding-left: 16px; padding-right: 16px; }
        .join-brand  { font-size: clamp(58px, 16vw, 78px); }
        .join-brand--small { font-size: 34px; }
      }
    `}</style>
  );
}

function BrandMark({ size = "large", quiet = false }) {
  const cls = "join-brand"
    + (size === "small" ? " join-brand--small" : "")
    + (quiet ? " join-brand--quiet" : "");
  return (
    <div className={cls}>
      <span className="join-brand__green">I</span>
      N OR{" "}
      <span className="join-brand__red">O</span>
      UT
    </div>
  );
}

function JoinShell({ children, checking = false }) {
  return (
    <main className={"join-shell" + (checking ? " join-shell--checking" : "")}>
      <div className="join-orb join-orb--green" />
      <div className="join-orb join-orb--red" />
      <div className="join-orb join-orb--gold" />
      <div className="join-inner">{children}</div>
    </main>
  );
}

export default function JoinTeam({
  team, authUser, onNameSubmit, loading,
  error, prefillName, checking
}) {
  return (
    <>
      <JoinStyles />
      <JoinShell>
        <BrandMark />
      </JoinShell>
    </>
  );
}
