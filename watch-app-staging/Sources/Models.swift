//  Models.swift
//  IoO Ref watchOS — domain model
//
//  Mirrors the handoff's State Management section (design_handoff_watchos/README.md)
//  and the casual addendum's data-model deltas. ONE model, two modes — `MatchMode`
//  drives every league-vs-casual difference.
//
//  STAGING: not yet compiled.

import Foundation
import SwiftUI

// MARK: - Mode

/// League fixtures carry competition/crests/home-away and fixed squads; casual is a
/// kickabout — generic Team A/B, jersey colours, ad-hoc/uneven squads, no home/away.
enum MatchMode {
    case league
    case casual
}

// MARK: - Team

struct Team: Identifiable {
    let id: String

    /// League: full club name ("Riverside FC"). Casual: a generic label ("Team A").
    var name: String
    /// Short form for the score row ("RIV" league / "A" casual).
    var abbreviation: String

    /// Team / jersey colour. League: real club colour from match setup.
    /// Casual: one of the two brand colours (Theme.Palette.teamA / .teamB).
    var color: Color

    /// Casual only: kit name for subtitles ("Blue" → "Blue jerseys"). nil in league.
    var jerseyName: String?

    /// League only: crest asset. Absent in casual (a jersey chip is shown instead).
    var crestAssetName: String?

    /// League only: .home / .away. nil/none in casual (no home/away labelling).
    var homeAway: HomeAway?

    var squad: [Player]

    enum HomeAway { case home, away }
}

// MARK: - Player

struct Player: Identifiable {
    let id: String

    /// Shirt / bib number. OPTIONAL — casual squad members frequently have no number
    /// (`player_match.shirt_number` is nullable and usually null in casual).
    var number: Int?

    /// Player name. OPTIONAL — present for league players and most casual squad members
    /// (they signed up), absent only for genuinely unnamed casual players.
    var name: String?

    /// League: position ("Striker"). Casual: kit line ("Blue team"). Optional.
    var role: String?

    var onPitch: Bool
    var booked: Bool          // already shown a yellow → second yellow auto-detects red

    /// LOCKED name-first display. Name is primary; the colour+number form
    /// ("Blue #5") is the FALLBACK for nameless players, not the default.
    func displayName(jerseyName: String?) -> String {
        if let name, !name.isEmpty { return name }
        let kit = jerseyName ?? "Player"
        if let number { return "\(kit) #\(number)" }
        return kit
    }

    /// "#9" when a number exists, else empty. Shown as a secondary chip, never the
    /// primary identifier in casual.
    var numberChip: String { number.map { "#\($0)" } ?? "" }
}

// MARK: - Events

enum EventType: String {
    case goal
    case ownGoal      = "own_goal"
    case yellow
    case red
    case secondYellow = "second_yellow"
    case sub          = "substitution"
    case sinBin       = "sin_bin"
    // event_type stays OPEN TEXT server-side (SCHEMA.md) — extra cases extend safely.
}

/// Per-event sync state to the companion phone / cloud (the match-log "sync dot":
/// green = synced, amber pulsing = pending). Backed by the ported apps/ref offline queue.
enum SyncState {
    case synced
    case pending
}

struct MatchEvent: Identifiable {
    let id: String
    var minute: Int
    var type: EventType
    var teamRef: String                 // Team.id
    var playerRefs: [String]            // [scorer] or [off, on] for a sub
    var syncState: SyncState = .pending
    /// Idempotency key — ported verbatim from apps/ref (client_event_id). Survives
    /// offline replay; the server upserts on it so a re-sent event never double-counts.
    let clientEventId: String
}

// MARK: - Sin bin

struct SinBin: Identifiable {
    let id: String
    var playerRef: String               // Player.id
    var teamRef: String                 // Team.id
    var durationSeconds: Int            // e.g. 2 min = 120
    var startedAt: Date
    var state: State

    enum State { case running, expired, ended }

    /// Seconds left (0 = none). Derived from the clock — never stored.
    func remaining(now: Date = Date()) -> Int {
        guard state == .running else { return 0 }
        let elapsed = Int(now.timeIntervalSince(startedAt))
        return max(0, durationSeconds - elapsed)
    }

    /// 0…1 fill remaining, for the amber strip / countdown ring.
    func fractionRemaining(now: Date = Date()) -> Double {
        guard durationSeconds > 0 else { return 0 }
        return Double(remaining(now: now)) / Double(durationSeconds)
    }
}

// MARK: - Period & clock

enum Period {
    case preMatch
    case firstHalf
    case halfTime
    case secondHalf
    case extraFirst
    case extraHalf
    case extraSecond
    case fullTime

    /// Logging is disabled between periods (the amber "LOGGING PAUSED" pill).
    var loggingEnabled: Bool {
        switch self {
        case .firstHalf, .secondHalf, .extraFirst, .extraSecond: return true
        case .preMatch, .halfTime, .extraHalf, .fullTime:        return false
        }
    }
}

struct MatchClock {
    var elapsedSeconds: Int = 0
    var addedSeconds: Int = 0       // stoppage / "+2 MIN ADDED"
    var running: Bool = false
}

struct Score {
    var home: Int = 0
    var away: Int = 0
}
</content>
