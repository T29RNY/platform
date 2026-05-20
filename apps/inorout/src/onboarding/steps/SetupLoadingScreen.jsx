import { useEffect, useState } from "react";
import { BellSimple, CurrencyGbp, TShirt, UsersThree } from "@phosphor-icons/react";

function SetupLoadingStyles() {
  return (
    <style>{`
      .setup-shell {
        min-height: 100dvh;
        width: 100%;
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: max(28px, env(safe-area-inset-top)) 24px max(28px, env(safe-area-inset-bottom));
        background: var(--bg);
      }

      .setup-orb {
        position: absolute;
        width: 200px;
        height: 200px;
        border-radius: 999px;
        filter: blur(60px);
        opacity: 0.32;
        pointer-events: none;
      }

      .setup-orb--green {
        top: -60px;
        left: -60px;
        background: rgba(61, 220, 106, 0.28);
      }

      .setup-orb--gold {
        bottom: -60px;
        right: -60px;
        background: rgba(232, 160, 32, 0.24);
      }

      .setup-title {
        font-family: "Bebas Neue", sans-serif;
        font-size: 32px;
        letter-spacing: 0.06em;
        color: var(--gold);
        text-align: center;
        margin: 0 0 6px;
        line-height: 1;
      }

      .setup-sub {
        font-family: "DM Sans", sans-serif;
        font-weight: 300;
        font-size: 12px;
        color: var(--t2);
        opacity: 0.6;
        text-align: center;
        margin: 0 0 48px;
        line-height: 1.4;
      }

      .setup-tips {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .setup-tip {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 10px 16px;
        border-radius: 8px;
        transition: all 500ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      .setup-tip__icon {
        color: rgba(208, 204, 194, 0.25);
        transition: all 500ms cubic-bezier(0.4, 0, 0.2, 1);
        margin-bottom: 2px;
      }

      .setup-tip__headline {
        font-family: "DM Sans", sans-serif;
        font-weight: 400;
        font-size: 12px;
        color: rgba(208, 204, 194, 0.3);
        transition: all 500ms cubic-bezier(0.4, 0, 0.2, 1);
        line-height: 1.2;
      }

      .setup-tip__sub {
        font-family: "DM Sans", sans-serif;
        font-weight: 300;
        font-size: 11px;
        color: rgba(208, 204, 194, 0);
        max-height: 0;
        overflow: hidden;
        transition: all 500ms cubic-bezier(0.4, 0, 0.2, 1);
        line-height: 1.4;
      }

      .setup-tip.active {
        background: rgba(232, 160, 32, 0.05);
      }

      .setup-tip.active .setup-tip__icon {
        color: var(--gold);
      }

      .setup-tip.active .setup-tip__headline {
        font-family: "Bebas Neue", sans-serif;
        font-size: 19px;
        letter-spacing: 0.04em;
        color: var(--t1);
      }

      .setup-tip.active .setup-tip__sub {
        color: var(--t2);
        opacity: 0.55;
        max-height: 40px;
        margin-top: 4px;
      }
    `}</style>
  );
}

const TIPS = [
  {
    icon: BellSimple,
    headline: "Never chase again",
    sub: "Players get nudged automatically when the game opens",
  },
  {
    icon: CurrencyGbp,
    headline: "Payment Tracking",
    sub: "Track who's paid, who owes — no spreadsheets",
  },
  {
    icon: TShirt,
    headline: "Bibs tracked",
    sub: "Know who's got them before anyone asks",
  },
  {
    icon: UsersThree,
    headline: "Teams in seconds",
    sub: "Random, fair, one tap — no arguments",
  },
];

export default function SetupLoadingScreen() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex(i => (i + 1) % TIPS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <SetupLoadingStyles />
      <main className="setup-shell">
        <div className="setup-orb setup-orb--green" />
        <div className="setup-orb setup-orb--gold" />
        <p className="setup-title">
          Setting up your game
        </p>
        <p className="setup-sub">
          Auto sets up each week — no need to ask
          everyone for their ins
        </p>
        <div className="setup-tips">
          {TIPS.map((tip, i) => {
            const Icon = tip.icon;
            return (
              <div
                key={i}
                className={"setup-tip" + (i === activeIndex ? " active" : "")}
              >
                <Icon
                  size={i === activeIndex ? 24 : 16}
                  weight="thin"
                  className="setup-tip__icon"
                  aria-hidden="true"
                />
                <span className="setup-tip__headline">
                  {tip.headline}
                </span>
                <span className="setup-tip__sub">
                  {tip.sub}
                </span>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
