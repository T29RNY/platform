import React, { useState, useEffect, useCallback } from "react";
import { venueGetBillingStatus } from "@platform/core/storage/supabase.js";
import { SectionHead } from "./atoms.jsx";

function ProviderCard({ label, logo, description, status, accountId, connectedAt }) {
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
            <span style={{
              fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
              padding: "2px 8px", borderRadius: 20,
              background: isConnected ? "var(--good-bg, #1a3a2a)" : "var(--surface-2)",
              color: isConnected ? "var(--good, #4ade80)" : "var(--text-muted)",
              border: `1px solid ${isConnected ? "var(--good, #4ade80)" : "var(--border)"}`,
            }}>
              {isConnected ? "CONNECTED" : "NOT CONNECTED"}
            </span>
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
        </div>
      </div>
      {!isConnected && (
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

  if (loading && !billing) {
    return <div className="view-body"><div className="text-mute">Loading…</div></div>;
  }
  if (error) {
    return <div className="view-body"><div className="text-mute">Couldn't load integrations: {error}</div></div>;
  }

  const stripe = billing?.stripe ?? {};
  const gc = billing?.gocardless ?? {};

  return (
    <div className="view-body">
      <SectionHead title="Payment providers" hint="Connect your payment accounts so members can pay by card or Direct Debit." />
      <ProviderCard
        label="Stripe"
        logo="💳"
        description="Card payments, Apple Pay, and Google Pay — for one-off match fees, tournament entries, equipment deposits, and recurring membership subscriptions."
        status={stripe.status ?? "pending"}
        accountId={stripe.account_id}
        connectedAt={stripe.connected_at}
      />
      <ProviderCard
        label="GoCardless"
        logo="🏦"
        description="Direct Debit from bank account — lower recurring failure rate, cheaper per-transaction, and the preferred payment method for club memberships in the UK."
        status={gc.status ?? "pending"}
        accountId={gc.account_id}
        connectedAt={gc.connected_at}
      />
    </div>
  );
}
