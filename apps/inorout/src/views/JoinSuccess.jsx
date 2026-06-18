import { useEffect } from "react";
import InstallSection, { detectPlatform } from "../components/InstallSection.jsx";

export default function JoinSuccess({ player, team }) {
  const playerUrl = player?.token ? `/p/${player.token}` : "/";
  const joinUrl   = `https://app.in-or-out.com/join/${team?.join_code || team?.id || ""}`;
  const platform  = detectPlatform();

  useEffect(() => {
    if (platform === "installed") {
      window.location.href = playerUrl;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!player?.token) return;
    try {
      const path = `/p/${player.token}`;
      localStorage.setItem("ioo_last_visited", path);
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone = window.navigator.standalone === true
        || window.matchMedia("(display-mode: standalone)").matches;
      if (isIOS && !isStandalone) {
        localStorage.setItem("ioo_redirect_to", JSON.stringify({ path, ts: Date.now() }));
      }
    } catch (e) {
      console.error("[JoinSuccess] localStorage bridge write failed:", e);
    }
  }, [player?.token]);

  const navigate = (url) => { window.location.href = url; };

  const handleCta = () => {
    window.posthog?.capture("install_screen_cta_tapped", { platform, flow: "join" });
    navigate(playerUrl);
  };

  const handleSkip = () => {
    window.posthog?.capture("install_screen_skipped", { platform, flow: "join" });
    navigate(playerUrl);
  };

  if (platform === "installed") return null;

  return (
    <div style={{
      minHeight: "100dvh", background: "var(--bg)",
      color: "var(--t1)", fontFamily: "var(--font-body)",
      display: "flex", flexDirection: "column",
      maxWidth: 430, margin: "0 auto",
    }}>
      <div style={{ flex: 1, padding: "40px 20px 0", overflowY: "auto" }}>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
          <img
            src="/icons/web-app-manifest-192x192.png"
            alt="In or Out"
            style={{ width: 72, height: 72, borderRadius: 16, marginBottom: 10, display: "block" }}
          />
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: "0.05em", lineHeight: 1 }}>
            <span style={{ color: "var(--green)" }}>I</span>
            <span style={{ color: "var(--t1)" }}>n or </span>
            <span style={{ color: "var(--red)" }}>O</span>
            <span style={{ color: "var(--t1)" }}>ut</span>
          </div>
          {team?.name && (
            <div style={{ fontSize: 14, color: "var(--t2)", fontWeight: 300, marginTop: 6, textAlign: "center" }}>
              You've joined {team.name}
            </div>
          )}
        </div>

        <InstallSection installTargetUrl={joinUrl} />
      </div>

      <div style={{ padding: "16px 20px 0", background: "var(--bg)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingBottom: 40 }}>
          <button
            onClick={handleCta}
            style={{
              width: "100%", height: 52, borderRadius: 12, border: "none", cursor: "pointer",
              background: "var(--green)", color: "var(--bg)",
              fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 600,
            }}
          >
            Open In or Out
          </button>
          <button
            onClick={handleSkip}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 11, color: "var(--t2)", fontWeight: 300, padding: "4px 8px",
            }}
          >
            skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
