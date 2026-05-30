import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@platform/core/storage/supabase.js";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import {
  companyAdminWhoami,
  hqGetCompanyState,
  hqGetVenueDetail,
  hqResolveIncident,
  hqGeneratePreviewToken,
} from "@platform/core/storage/supabase.js";
import VenueHealthGrid from "./views/VenueHealthGrid.jsx";
import VenueDetail from "./views/VenueDetail.jsx";
import AlertsActions from "./views/AlertsActions.jsx";
import AnalyticsView from "./views/AnalyticsView.jsx";
import UtilisationPanel from "./views/UtilisationPanel.jsx";
import ActivityFeed from "./views/ActivityFeed.jsx";
import PreviewView from "./views/PreviewView.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [whoami, setWhoami] = useState(null);

  const [companyId, setCompanyId] = useState(null);
  const [state, setState] = useState(null);
  const [stateErr, setStateErr] = useState(null);

  const [selectedVenueId, setSelectedVenueId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [view, setView] = useState("dashboard"); // "dashboard" | "analytics"
  const [previewLink, setPreviewLink] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Public preview route (/hq/preview/TOKEN or /preview/TOKEN) — no auth.
  const previewToken = useMemo(() => {
    if (typeof window === "undefined") return null;
    const m = window.location.pathname.match(/\/preview\/([^/]+)/);
    return m ? m[1] : null;
  }, []);

  // ── auth session ──────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ── whoami → pick a company ─────────────────────────────────────────────────
  useEffect(() => {
    if (!session) { setWhoami(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await companyAdminWhoami();
        if (cancelled) return;
        setWhoami(data);
        const first = data?.companies?.[0]?.company_id || null;
        setCompanyId((prev) => prev || first);
      } catch (err) {
        console.error("whoami failed", err);
        if (!cancelled) setWhoami({ signed_in: true, companies: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // ── load company state ──────────────────────────────────────────────────────
  const loadState = useCallback(async () => {
    if (!companyId) return;
    try {
      const data = await hqGetCompanyState(companyId);
      setState(data);
      setStateErr(null);
    } catch (err) {
      setStateErr(err?.message || String(err));
    }
  }, [companyId]);

  useEffect(() => { loadState(); }, [loadState]);

  // ── load venue detail when selection changes ────────────────────────────────
  const loadDetail = useCallback(async (venueId) => {
    if (!companyId || !venueId) { setDetail(null); return; }
    setDetailLoading(true);
    try {
      const data = await hqGetVenueDetail(companyId, venueId);
      setDetail(data);
    } catch (err) {
      console.error("venue detail failed", err);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadDetail(selectedVenueId); }, [selectedVenueId, loadDetail]);

  const onResolve = useCallback(async (incidentId, note) => {
    await hqResolveIncident(companyId, incidentId, note || null);
    await Promise.all([loadState(), loadDetail(selectedVenueId)]);
  }, [companyId, loadState, loadDetail, selectedVenueId]);

  const generatePreview = useCallback(async () => {
    if (!companyId) return;
    setPreviewBusy(true);
    try {
      const r = await hqGeneratePreviewToken(companyId);
      if (r?.token) setPreviewLink(`${window.location.origin}/preview/${r.token}`);
    } catch (e) {
      setPreviewLink(null);
      console.error("generate preview failed", e);
    } finally {
      setPreviewBusy(false);
    }
  }, [companyId]);

  // ── render gates ────────────────────────────────────────────────────────────
  // Public preview link takes precedence over auth — no login required.
  if (previewToken) return <PreviewView token={previewToken} />;

  if (loading) return <div className="center"><div className="muted">Loading…</div></div>;

  if (!session) {
    return (
      <div className="center">
        <div className="card">
          <h1>In or Out — HQ</h1>
          <p>Sign in with your company account to continue.</p>
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

  if (whoami && (!whoami.companies || whoami.companies.length === 0)) {
    return (
      <div className="center">
        <div className="card">
          <h1>Access denied</h1>
          <p>
            Signed in as <strong>{whoami.email}</strong> but this account isn’t an HQ admin
            of any company. Ask your platform admin to add you to{" "}
            <code className="mono">company_admins</code>.
          </p>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  const companies = whoami?.companies || [];
  const activeCompany = companies.find((c) => c.company_id === companyId) || companies[0];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          IN OR OUT <span className="pill">HQ</span>
          {state?.company?.name && <span className="muted">{state.company.name}</span>}
          {activeCompany?.role && <span className="badge">{activeCompany.role}</span>}
        </div>
        <nav>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
          <button className={view === "utilisation" ? "active" : ""} onClick={() => setView("utilisation")}>Utilisation</button>
          <button className={view === "analytics" ? "active" : ""} onClick={() => setView("analytics")}>Analytics</button>
        </nav>
        <div className="user">
          {companies.length > 1 && (
            <select
              value={companyId || ""}
              onChange={(e) => { setCompanyId(e.target.value); setSelectedVenueId(null); }}
            >
              {companies.map((c) => (
                <option key={c.company_id} value={c.company_id}>{c.name}</option>
              ))}
            </select>
          )}
          {activeCompany?.role === "super_admin" && (
            <button className="small" onClick={generatePreview} disabled={previewBusy}>
              {previewBusy ? "…" : "Share preview"}
            </button>
          )}
          <span>{whoami?.email}</span>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <main className="content">
        {previewLink && (
          <div style={{ padding: "12px 16px 0" }}>
            <div className="preview-share">
              <span className="muted">7-day preview link:</span>
              <input readOnly value={previewLink} onFocus={(e) => e.target.select()} />
              <button className="small" onClick={() => navigator.clipboard?.writeText(previewLink)}>Copy</button>
              <button className="small" onClick={() => setPreviewLink(null)}>Dismiss</button>
            </div>
          </div>
        )}
        {stateErr && <div style={{ padding: 16 }}><div className="error">{stateErr}</div></div>}
        {view === "analytics" ? (
          <AnalyticsView companyId={companyId} />
        ) : view === "utilisation" ? (
          <UtilisationPanel companyId={companyId} />
        ) : (
        <div className="cols">
          <div className="col">
            <VenueHealthGrid
              summary={state?.summary}
              venues={state?.venues || []}
              selectedVenueId={selectedVenueId}
              onSelect={setSelectedVenueId}
            />
          </div>
          <div className="col">
            {selectedVenueId ? (
              <>
                <button className="small" style={{ marginBottom: 12 }} onClick={() => setSelectedVenueId(null)}>
                  ← Back to live feed
                </button>
                <VenueDetail
                  detail={detail}
                  loading={detailLoading}
                  hasSelection={true}
                  role={state?.caller?.role}
                  onResolve={onResolve}
                />
              </>
            ) : (
              <ActivityFeed companyId={companyId} />
            )}
          </div>
          <div className="col">
            <AlertsActions
              venues={state?.venues || []}
              selectedVenueId={selectedVenueId}
              onSelect={setSelectedVenueId}
            />
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
