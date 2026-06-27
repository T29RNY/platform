//  MatchModel.swift
//  IoO Ref watchOS — single source of truth for a live match
//
//  Per the handoff's State Management section: one @Observable model the whole UI
//  reads. Persistence (survive backgrounding / wrist-down) and the supabase-swift +
//  WatchConnectivity sync are marked TODO — those land in the Xcode phase post-approval,
//  reusing the ported apps/ref offline/idempotency engine.
//
//  STAGING: not yet compiled.

import Foundation
import Observation

@Observable
final class MatchModel {

    // MARK: - Setup

    let mode: MatchMode
    var homeTeam: Team       // in casual, "home"/"away" is just A/B ordering, no label
    var awayTeam: Team

    /// League fixture context — all nil/empty in casual mode.
    var competition: String?
    var round: String?
    var fixtureId: String?

    /// The assignment that opened this match (resolver `get_my_next_assignment`).
    /// League/cohort → official ref_token; casual → matches.ref_token (Phase-5 driver).
    var refToken: String?

    // MARK: - Live state

    var period: Period = .preMatch
    var clock = MatchClock()
    var score = Score()
    var events: [MatchEvent] = []
    var sinBins: [SinBin] = []

    init(mode: MatchMode, homeTeam: Team, awayTeam: Team) {
        self.mode = mode
        self.homeTeam = homeTeam
        self.awayTeam = awayTeam
    }

    // MARK: - Derived

    /// False between periods → drives the "LOGGING PAUSED" pill and disables the dock Log.
    var isLoggingEnabled: Bool { period.loggingEnabled }

    var activeSinBins: [SinBin] { sinBins.filter { $0.state == .running } }
    var activeSinBinCount: Int { activeSinBins.count }

    func team(_ id: String) -> Team? {
        if id == homeTeam.id { return homeTeam }
        if id == awayTeam.id { return awayTeam }
        return nil
    }

    func player(_ id: String) -> Player? {
        homeTeam.squad.first { $0.id == id } ?? awayTeam.squad.first { $0.id == id }
    }

    /// Drives the second-yellow → red guard rail (screen 08).
    func playerIsBooked(_ id: String) -> Bool { player(id)?.booked ?? false }

    /// True when booking this player should auto-escalate to a sending-off.
    func bookingWouldSendOff(_ playerId: String) -> Bool { playerIsBooked(playerId) }

    // MARK: - Mutations
    //
    // These are intentionally thin here. The real commit path (append event → haptic →
    // mark pending-sync → enqueue to the offline engine) is ported in the Xcode phase.
    // TODO(post-approval): wire to the ported apps/ref offline queue + supabase-swift.

    func appendEvent(_ event: MatchEvent) {
        events.append(event)
        applyScoreSideEffect(of: event)
    }

    private func applyScoreSideEffect(of event: MatchEvent) {
        switch event.type {
        case .goal:
            if event.teamRef == homeTeam.id { score.home += 1 } else { score.away += 1 }
        case .ownGoal:
            // Own goal credits the OPPONENT.
            if event.teamRef == homeTeam.id { score.away += 1 } else { score.home += 1 }
        case .yellow, .secondYellow:
            setBooked(event.playerRefs.first, booked: true)
        default:
            break
        }
    }

    private func setBooked(_ playerId: String?, booked: Bool) {
        guard let playerId else { return }
        if let i = homeTeam.squad.firstIndex(where: { $0.id == playerId }) {
            homeTeam.squad[i].booked = booked
        } else if let i = awayTeam.squad.firstIndex(where: { $0.id == playerId }) {
            awayTeam.squad[i].booked = booked
        }
    }

    /// Remove the most-recent event (match-log "Undo last event") and reverse its
    /// score/booked side effect. TODO(post-approval): also retract from the sync queue.
    func undoLastEvent() {
        guard let last = events.popLast() else { return }
        switch last.type {
        case .goal:
            if last.teamRef == homeTeam.id { score.home = max(0, score.home - 1) }
            else { score.away = max(0, score.away - 1) }
        case .ownGoal:
            if last.teamRef == homeTeam.id { score.away = max(0, score.away - 1) }
            else { score.home = max(0, score.home - 1) }
        case .yellow, .secondYellow:
            setBooked(last.playerRefs.first, booked: false)
        default:
            break
        }
    }
}
</content>
