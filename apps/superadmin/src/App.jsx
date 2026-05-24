import React, { useEffect, useState } from "react";
import { supabase } from "@platform/core/storage/supabase.js";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { superadminWhoami } from "@platform/core/storage/supabase.js";
import Activity from "./views/Activity.jsx";
import Teams from "./views/Teams.jsx";
import TeamDetail from "./views/TeamDetail.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [whoami, setWhoami] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("activity");
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setWhoami(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await superadminWhoami();
        if (!cancelled) setWhoami(data);
      } catch (err) {
        console.error("whoami failed", err);
        if (!cancelled) setWhoami({ signed_in: true, is_platform_admin: false });
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  if (loading) {
    return (
      <div className="center">
        <div className="muted">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="center">
        <div className="card">
          <h1>Platform Admin</h1>
          <p>Sign in with your platform account to continue.</p>
          <Auth
            supabaseClient={supabase}
            providers={["google"]}
            appearance={{ theme: ThemeSupa }}
            theme="dark"
            redirectTo={typeof window !== "undefined" ? window.location.origin : undefined}
            onlyThirdPartyProviders={false}
          />
        </div>
      </div>
    );
  }

  if (whoami && !whoami.is_platform_admin) {
    return (
      <div className="center">
        <div className="card">
          <h1>Access denied</h1>
          <p>
            Signed in as <strong>{whoami.email}</strong> but this account is not a platform
            admin. If this is a mistake, add yourself to <code className="mono">platform_admins</code>{" "}
            via SQL.
          </p>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  const openTeam = (teamId) => {
    setSelectedTeamId(teamId);
    setTab("team_detail");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          IN OR OUT <span className="pill">PLATFORM</span>
        </div>
        <nav>
          <button
            className={tab === "activity" ? "active" : ""}
            onClick={() => setTab("activity")}
          >
            Activity
          </button>
          <button
            className={tab === "teams" ? "active" : ""}
            onClick={() => { setTab("teams"); setSelectedTeamId(null); }}
          >
            Teams
          </button>
          {selectedTeamId && (
            <button
              className={tab === "team_detail" ? "active" : ""}
              onClick={() => setTab("team_detail")}
            >
              Team Detail
            </button>
          )}
        </nav>
        <div className="user">
          <span>{whoami?.email}</span>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <main className="content">
        {tab === "activity" && <Activity onOpenTeam={openTeam} />}
        {tab === "teams" && <Teams onOpenTeam={openTeam} />}
        {tab === "team_detail" && selectedTeamId && (
          <TeamDetail teamId={selectedTeamId} />
        )}
      </main>
    </div>
  );
}
