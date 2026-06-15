import React, { useState, useEffect, useCallback } from "react";
import { venueGetBillingStatus, venueStripeDisconnect } from "@platform/core/storage/supabase.js";
import { SectionHead } from "./atoms.jsx";

const API_BASE = import.meta.env.VITE_INOROUT_API_URL ?? "";

async function callStripeConnect(venueToken, action) {
  const res = await fetch(`${API_BASE}/api/stripe-connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ venueToken, action }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "stripe_api_error");
  return json;
}

function StatusBadge({ connected }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
      padding: "2px 8px", borderRadius: 20,
      background: connected ? "var(--good-bg, #1a3a2a)" : "var(--surface-2)",
      color: connected ? "var(--good, #4ade80)" : "var(--text-muted)",
      border: `1px solid ${connected ? "var(--good, #4ade80)" : "var(--border)"}`,
    }}>
      {connected ? "CONNECTED" : "NOT CONNECTED"}
    </span>
  );
}

function ProviderCard({ label, logo, description, status, accountId, connectedAt, onConnect, onDisconnect, connecting, disconnecting, error, actionAvailable }) {
  const isConnected = status === "connected";

  return (
    <div className="acard" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 10, background: "var(--surface-2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, flexShrink: 0,
        }}>
          {logo}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{label}</span>
            <StatusBadge connected={isConnected} />
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {description}
          </p>
          {isConnected && accountId && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
              Account: {accountId}
            </p>
          )}
          {isConnected && connectedAt && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
              Connected {new Date(connectedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          )}
          {error && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--danger, #f87171)" }}>{error}</p>
          )}
        </div>
      </div>

      {actionAvailable && (
        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          {!isConnected && onConnect && (
            <button
              className="btn-primary"
              onClick={onConnect}
              disabled={connecting}
              style={{ fontSize: 13, padding: "8px 16px" }}
            >
              {connecting ? "Redirecting to Stripe…" : "Connect Stripe"}
            </button>
          )}
          {isConnected && onDisconnect && (
            <button
              className="btn-outline"
              onClick={onDisconnect}
              disabled={disconnecting}
              style={{ fontSize: 13, padding: "8px 16px", color: "var(--danger, #f87171)", borderColor: "var(--danger, #f87171)" }}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
        </div>
      )}

      {!actionAvailable && !isConnected && (
        <div style={{
          marginTop: 14, padding: "10px 14px", borderRadius: 8,
          background: "var(--surface-2)", fontSize: 13, color: "var(--text-muted)",
        }}>
          Setup required via the operator dashboard. Contact your platform administrator to connect this provider.
        </div>
      )}
    </div>
  );
}

export default function IntegrationsView({ venueToken }) {
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [stripeConnecting, setStripeConnecting] = useState(false);
  const [stripeDisconnecting, setStripeDisconnecting] = useState(false);
  const [stripeRefreshing, setStripeRefreshing] = useState(false);
  const [stripeError, setStripeError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await venueGetBillingStatus(venueToken);
      setBilling(data);
    } catch (err) {
      console.error("[integrations] load failed", err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [venueToken]);

  useEffect(() => { load(); }, [load]);

  // Handle return from Stripe onboarding (?connect=done or ?connect=refresh)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectParam = params.get("connect");
    if (connectParam !== "done" && connectParam !== "refresh") return;

    // Clear the param so a reload doesn't re-trigger
    window.history.replaceState({}, "", window.location.pathname);

    const doRefresh = async () => {
      setStripeRefreshing(true);
      setStripeError(null);
      try {
        await callStripeConnect(venueToken, "refresh");
      } catch (err) {
        console.error("[integrations] stripe refresh failed", err);
        setStripeError(err?.message || "refresh_failed");
      } finally {
        setStripeRefreshing(false);
        load();
      }
    };
    doRefresh();
  }, [venueToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStripeConnect = async () => {
    setStripeConnecting(true);
    setStripeError(null);
    try {
      const json = await callStripeConnect(venueToken, "onboard");
      if (!json.url) throw new Error("no_url_returned");
      window.location.href = json.url;
    } catch (err) {
      console.error("[integrations] stripe connect failed", err);
      if (err?.message === "stripe_not_configured") {
        setStripeError("Stripe is not yet configured on this platform. Contact your administrator.");
      } else {
        setStripeError(err?.message || "connect_failed");
      }
      setStripeConnecting(false);
    }
  };

  const handleStripeDisconnect = async () => {
    if (!window.confirm("Disconnect Stripe? Members cannot pay by card until you reconnect. Your Stripe account will not be deleted.")) return;
    setStripeDisconnecting(true);
    setStripeError(null);
    try {
      await venueStripeDisconnect(venueToken);
      await load();
    } catch (err) {
      console.error("[integrations] stripe disconnect failed", err);
      setStripeError(err?.message || "disconnect_failed");
    } finally {
      setStripeDisconnecting(false);
    }
  };

  if (loading && !billing) {
    return <div className="view-body"><div className="text-mute">Loading…</div></div>;
  }
  if (error) {
    return <div className="view-body"><div className="text-mute">Couldn't load integrations: {error}</div></div>;
  }

  const stripe = billing?.stripe ?? {};
  const gc = billing?.gocardless ?? {};
  const isStripeConfigured = API_BASE !== "";

  return (
    <div className="view-body">
      <SectionHead title="Payment providers" hint="Connect your payment accounts so members can pay by card or Direct Debit." />
      {stripeRefreshing && (
        <div style={{ marginBottom: 12, fontSize: 13, color: "var(--text-muted)" }}>
          Checking Stripe connection…
        </div>
      )}
      <ProviderCard
        label="Stripe"
        logo="💳"
        description="Card payments, Apple Pay, and Google Pay — for one-off match fees, tournament entries, equipment deposits, and recurring membership subscriptions."
        status={stripe.status ?? "pending"}
        accountId={stripe.account_id}
        connectedAt={stripe.connected_at}
        onConnect={handleStripeConnect}
        onDisconnect={handleStripeDisconnect}
        connecting={stripeConnecting}
        disconnecting={stripeDisconnecting}
        error={stripeError}
        actionAvailable={isStripeConfigured}
      />
      <ProviderCard
        label="GoCardless"
        logo="🏦"
        description="Direct Debit from bank account — lower recurring failure rate, cheaper per-transaction, and the preferred payment method for club memberships in the UK."
        status={gc.status ?? "pending"}
        accountId={gc.account_id}
        connectedAt={gc.connected_at}
        actionAvailable={false}
      />
    </div>
  );
}
