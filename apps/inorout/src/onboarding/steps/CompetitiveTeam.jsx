import { useState, useRef } from "react";
import { Trophy, CheckCircle, CaretRight } from "@phosphor-icons/react";
import { ONBOARDING_CONFIG as CFG } from "../config.js";
import { WizardShell, Field, FInput, StepTitle } from "./CreateTeam.jsx";
import {
  createTeam,
  joinGetLeagueByCode,
  joinRegisterTeam,
} from "@platform/core/storage/supabase.js";

// PR2 — Competitive / league team self-serve. A short 3-step wizard reached from
// the /create vertical chooser when "League / competitive team" is picked.
//
// Two create paths, chosen by whether the user has a league code that resolves to
// an OPEN competition (SELF_SERVE_MULTI_VERTICAL_HANDOFF.md Decision #4):
//   • code + open competition → join_register_team MINTS a new competitive team AND
//     registers it (mig 158 — a league squad is always a separate, new squad; a
//     casual team is never promoted in place). No create_team call.
//   • no code / no open competition → create_team(teamType:'competitive') creates a
//     plain competitive team. "No open competition" degrades gracefully — never a
//     dead end — the user still leaves with a working team.
// Both paths land on /admin/<admin_token>?just_created=1, same as casual create.
//
// Reuses the casual wizard primitives (WizardShell / Field / FInput / StepTitle)
// verbatim so the casual flow stays byte-identical (mandatory casual-regression).

const TOTAL_STEPS = 3;

export default function CompetitiveTeam({ authUser, cancelTo }) {
  const [subStep, setSubStep] = useState(1);

  // Step 1
  const [teamName, setTeamName]   = useState("");
  const [shortName, setShortName] = useState("");

  // Step 2 — league by code
  const [leagueCode, setLeagueCode] = useState("");
  const [lookup, setLookup]         = useState(null);   // { league, venue, competitions_open }
  const [selectedCompId, setSelectedCompId] = useState(null);
  const [lookupLoading, setLookupLoading]   = useState(false);
  const [lookupError, setLookupError]       = useState(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const submittingRef = useRef(false);

  const nameValid = teamName.trim().length > 0;
  const openComps = lookup?.competitions_open ?? [];
  const selectedComp = openComps.find(c => c.id === selectedCompId) || null;
  // A valid league resolved with open competitions but none chosen yet: force an
  // explicit pick so a user who clearly wants to register doesn't silently fall
  // through to a plain, unregistered team. Clearing the code re-enables Continue.
  const mustPickComp = !!lookup && openComps.length > 0 && !selectedCompId;

  const goNext = () => setSubStep(s => Math.min(TOTAL_STEPS, s + 1));
  const goBack = () => setSubStep(s => Math.max(1, s - 1));

  // ── League lookup ──────────────────────────────────────────────────────────
  const findLeague = async () => {
    const code = leagueCode.trim();
    if (!code) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookup(null);
    setSelectedCompId(null);
    try {
      const res = await joinGetLeagueByCode(code);
      setLookup(res);
      // Auto-select when exactly one competition is open — the common case.
      const comps = res?.competitions_open ?? [];
      if (comps.length === 1) setSelectedCompId(comps[0].id);
    } catch (e) {
      const msg = e?.message || String(e);
      setLookupError(
        msg === "league_not_found" ? "No active league found for that code. Check it with your league organiser."
        : msg === "venue_inactive" ? "That league's venue isn't active right now."
        : "Couldn't look up that code. Please try again."
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const clearLookup = () => {
    setLookup(null);
    setSelectedCompId(null);
    setLookupError(null);
  };

  // ── Create ───────────────────────────────────────────────────────────────
  const landOnAdmin = (adminToken, joinCode = null, adminPlayerToken = null) => {
    try {
      sessionStorage.setItem("ioo_just_created", JSON.stringify({
        groupName: teamName.trim(),
        joinCode,
        adminPlayerToken,
        ts: Date.now(),
      }));
    } catch (e) { /* best-effort overlay stash */ }
    window.location.replace(`/admin/${adminToken}?just_created=1`);
  };

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (selectedComp) {
        // Path A — mint a new competitive team AND register it in one call.
        const data = await joinRegisterTeam(lookup.league.league_code, selectedComp.id, {
          name:        teamName.trim(),
          short_name:  shortName.trim() || undefined,
          admin_email: authUser?.email || undefined,
        });
        landOnAdmin(data.admin_token);
        return;
      }
      // Path B — plain competitive team (no league, or no open competition).
      const data = await createTeam({
        adminEmail:  authUser?.email || null,
        teamName:    teamName.trim(),
        dayOfWeek:   CFG.defaults.dayOfWeek,
        kickoff:     CFG.defaults.kickoff,
        squadSize:   CFG.defaults.squadSize,
        venue:       null,
        city:        null,
        price:       0,
        bibsEnabled: true,
        playerNames: [],
        teamType:    "competitive",
      });
      landOnAdmin(data.admin_token, data.join_code ?? null, data.admin_player_token ?? null);
      return;
    } catch (e) {
      const msg = e?.message || String(e);
      setSubmitError(
        msg === "team_already_registered" ? "That team is already registered for this competition."
        : msg === "competition_closed_to_registration" ? "This competition has just closed to new registrations."
        : msg === "admin_email_required" ? "We couldn't read your email — please sign in again and retry."
        : "Something went wrong creating your team. Please try again."
      );
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  // ── Step 1: team name ──────────────────────────────────────────────────────
  if (subStep === 1) {
    return (
      <WizardShell
        subStep={1}
        total={TOTAL_STEPS}
        goBack={goBack}
        cancelTo={cancelTo}
        onContinue={goNext}
        continueDisabled={!nameValid}
      >
        <div style={{ marginBottom: 24 }}>
          <Trophy size={40} weight="thin" color="var(--gold)" style={{ marginBottom: 12 }} />
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 26,
            letterSpacing: "0.06em", lineHeight: 1.05, marginBottom: 8,
          }}>
            LEAGUE / COMPETITIVE TEAM
          </div>
          <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5 }}>
            Name your team. If you're playing in a league, you can register with your code in a moment.
          </div>
        </div>
        <Field label="WHAT'S YOUR TEAM CALLED?">
          <FInput
            value={teamName}
            onChange={e => setTeamName(e.target.value)}
            placeholder="e.g. Thursday Rovers"
            maxLength={120}
          />
        </Field>
        <Field label="SHORT NAME (OPTIONAL)">
          <FInput
            value={shortName}
            onChange={e => setShortName(e.target.value)}
            placeholder="e.g. ROV"
            maxLength={20}
          />
        </Field>
      </WizardShell>
    );
  }

  // ── Step 2: league by code (optional) ──────────────────────────────────────
  if (subStep === 2) {
    return (
      <WizardShell subStep={2} total={TOTAL_STEPS} goBack={goBack} onContinue={goNext} continueDisabled={mustPickComp}>
        <StepTitle
          title="PLAYING IN A LEAGUE?"
          subtitle="Enter the code from your league organiser to register. No code yet? Skip — you can add one later from Admin."
        />
        <Field label="LEAGUE CODE" error={lookupError}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <FInput
                value={leagueCode}
                onChange={e => { setLeagueCode(e.target.value.toUpperCase()); clearLookup(); }}
                placeholder="e.g. FINB2024"
                maxLength={40}
                autoCapitalize="characters"
              />
            </div>
            <button
              type="button"
              onClick={findLeague}
              disabled={lookupLoading || !leagueCode.trim()}
              style={{
                padding: "0 16px", borderRadius: 10, border: "none", whiteSpace: "nowrap",
                background: (!lookupLoading && leagueCode.trim()) ? "var(--gold)" : "var(--s3)",
                color: (!lookupLoading && leagueCode.trim()) ? "var(--bg)" : "var(--t2)",
                fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.06em",
                cursor: (!lookupLoading && leagueCode.trim()) ? "pointer" : "not-allowed",
              }}
            >
              {lookupLoading ? "…" : "Find"}
            </button>
          </div>
        </Field>

        {lookup && (
          <div style={{
            marginTop: 8, padding: 14, borderRadius: 12,
            background: "var(--s2)", border: "1px solid var(--s3)",
          }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 17, letterSpacing: "0.04em" }}>
              {lookup.league?.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
              {lookup.venue?.name}{lookup.venue?.city ? ` · ${lookup.venue.city}` : ""}
            </div>

            {openComps.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5, marginTop: 12 }}>
                No competition is open for registration right now. We'll let you know when one opens — you can
                still create your team now and register later.
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  fontFamily: "var(--font-display)", fontSize: 11, color: "var(--t2)",
                  letterSpacing: "0.08em", marginBottom: 8,
                }}>
                  CHOOSE A COMPETITION
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {openComps.map(c => {
                    const on = c.id === selectedCompId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCompId(c.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                          padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                          background: on ? "rgba(212,175,55,0.10)" : "var(--s2)",
                          border: on ? "1px solid var(--goldb)" : "1px solid var(--s3)",
                          color: "var(--t1)",
                        }}
                      >
                        <CheckCircle
                          size={18} weight="thin"
                          color={on ? "var(--gold)" : "var(--t2)"}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 300 }}>{c.name}</div>
                          {c.season_name && (
                            <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 1 }}>{c.season_name}</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {mustPickComp && (
                  <div style={{ fontSize: 12, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5, marginTop: 10 }}>
                    Pick a competition above to register — or clear the code to create a team without a league.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </WizardShell>
    );
  }

  // ── Step 3: review & create ────────────────────────────────────────────────
  const registrationLine = selectedComp
    ? `${lookup.league?.name} · ${selectedComp.name}`
    : "No league yet — you can register later from Admin";

  const rows = [
    { label: "TEAM NAME",  value: teamName || "—",                       step: 1 },
    { label: "SHORT NAME", value: shortName || "—",                      step: 1 },
    { label: "LEAGUE",     value: registrationLine,                      step: 2 },
  ];

  return (
    <div style={{
      padding: "calc(24px + env(safe-area-inset-top)) 24px calc(48px + env(safe-area-inset-bottom))",
      fontFamily: "var(--font-body)", minHeight: "100dvh",
      boxSizing: "border-box", display: "flex", flexDirection: "column",
    }}>
      <button
        type="button"
        onClick={goBack}
        style={{
          background: "none", border: "none", padding: "0 0 16px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
          color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)", fontWeight: 300,
        }}
      >
        <CaretRight size={16} weight="thin" style={{ transform: "rotate(180deg)" }} />
        Back
      </button>

      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 20, color: "var(--t1)",
          letterSpacing: "0.06em", marginBottom: 8,
        }}>
          REVIEW & CREATE
        </div>
        <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300 }}>
          {selectedComp
            ? "We'll create your team and submit your league registration."
            : "Everything look right? Tap a row to edit."}
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {rows.map(({ label, value, step }) => (
          <button
            key={label}
            type="button"
            onClick={() => setSubStep(step)}
            style={{
              width: "100%", background: "none", border: "none", padding: "12px 0",
              borderBottom: "1px solid var(--s3)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              textAlign: "left",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 11, color: "var(--t2)", fontFamily: "var(--font-display)",
                letterSpacing: "0.08em", marginBottom: 3,
              }}>
                {label}
              </div>
              <div style={{ fontSize: 15, color: "var(--t1)", fontWeight: 300 }}>{value}</div>
            </div>
            <CaretRight size={14} weight="thin" style={{ color: "var(--t2)", flexShrink: 0, marginLeft: 8 }} />
          </button>
        ))}

        {submitError && (
          <div style={{
            padding: "10px 14px", borderRadius: 10, marginTop: 16,
            background: "rgba(255,64,64,0.08)", border: "1px solid rgba(255,64,64,0.3)",
            fontSize: 13, color: "var(--red)", fontWeight: 300,
          }}>
            {submitError}
          </div>
        )}

        {selectedComp && (
          <div style={{
            fontSize: 12, color: "var(--t2)", textAlign: "center",
            margin: "16px 0", fontWeight: 300, lineHeight: 1.5,
          }}>
            Your registration goes to the league organiser for approval. You'll manage your team from Admin either way.
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        style={{
          width: "100%", padding: 16, borderRadius: 12, border: "none", marginTop: 16,
          background: "var(--gold)", color: "var(--bg)",
          fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "0.06em",
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Creating..." : selectedComp ? "Create & register →" : "Create my team →"}
      </button>
    </div>
  );
}
