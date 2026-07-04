import Foundation
import Capacitor
import HealthKit

// HealthKit — DORMANT iOS plugin for Match Workout Tracking (Phase 1).
//
// READ-ONLY bridge over Apple Health. We build NO tracking — Apple's stock Workout app
// measures the workout; this plugin READS the summary + route so JS can match it to a
// game (apps/inorout/src/native/native-health.js → the match-to-game flow, PR #6) and
// post it via save_match_health_summary (mig 456). We request READ permission only.
//
// Like AuthSessionPlugin, this lives OUTSIDE the gitignored ios/ folder and is dragged
// into the Xcode App target by hand (see README.md). It is reference source: it is NOT
// compiled in CI (no Swift toolchain) and ships in no binary until the operator adds it
// on the build machine (gates G2/G3). The JS bridge no-ops on web, so nothing here can
// affect the live web app or the current App-Store binary.
//
// JS surface (registerPlugin('HealthKit')):
//   requestAuthorization()                 -> { granted, available }
//   queryWorkouts({ fromISO, toISO })      -> { workouts: [WorkoutSummary] }
//   queryRoute({ workoutUuid })            -> { track: { points: [{ lat, lon, t }] } | null }
//
// WorkoutSummary = { uuid, startISO, endISO, durationSeconds, distanceMeters,
//                    activeEnergyKcal, avgHr, maxHr, indoor, activityType }
@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin {

  private let store = HKHealthStore()

  // The read types we need. Distance/HR/active-energy come off the workout's time range;
  // workoutRoute is the GPS series (outdoor only). Older OS versions may lack workoutRoute,
  // so it is added conditionally.
  private func readTypes() -> Set<HKObjectType> {
    var types: Set<HKObjectType> = [
      HKObjectType.workoutType(),
      HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!,
      HKObjectType.quantityType(forIdentifier: .heartRate)!,
      HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!,
    ]
    if #available(iOS 11.0, *) {
      types.insert(HKSeriesType.workoutRoute())
    }
    return types
  }

  @objc func requestAuthorization(_ call: CAPPluginCall) {
    guard HKHealthStore.isHealthDataAvailable() else {
      call.resolve(["available": false, "granted": false])
      return
    }
    // Present the consent sheet from the MAIN thread. Capacitor dispatches plugin calls
    // on a background queue, and HealthKit's authorization presents UI — asked from a
    // background thread the consent sheet can silently fail to appear and the completion
    // never fires, leaving the JS attach flow hung on "Requesting Health access…" and the
    // app never registering under Settings › Privacy & Security › Health. Hopping to main
    // lets the sheet present.
    DispatchQueue.main.async {
      self.store.requestAuthorization(toShare: [], read: self.readTypes()) { success, error in
        if let error = error {
          call.reject(error.localizedDescription, nil, error)
          return
        }
        // NOTE: HealthKit deliberately does NOT reveal whether READ access was granted
        // (privacy: a denied read is indistinguishable from "no data"). `success` only
        // means the prompt completed without error. The JS layer treats an empty workout
        // list as "denied OR none" and routes the user to check Health permissions.
        call.resolve(["available": true, "granted": success])
      }
    }
  }

  @objc func queryWorkouts(_ call: CAPPluginCall) {
    guard let fromISO = call.getString("fromISO"), let toISO = call.getString("toISO"),
          let from = HealthKitPlugin.iso.date(from: fromISO),
          let to = HealthKitPlugin.iso.date(from: toISO) else {
      call.reject("Missing or invalid 'fromISO' / 'toISO'")
      return
    }

    let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: .strictStartDate)
    let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
    let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate,
                              limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { [weak self] _, samples, error in
      if let error = error {
        call.reject(error.localizedDescription, nil, error)
        return
      }
      guard let self = self, let workouts = samples as? [HKWorkout] else {
        call.resolve(["workouts": []])
        return
      }
      self.summarise(workouts) { summaries in
        call.resolve(["workouts": summaries])
      }
    }
    store.execute(query)
  }

  // Fold each workout into a JS-ready dict, enriching with avg/max HR from the heart-rate
  // samples over the workout's interval. Done sequentially via a dispatch group so the
  // single resolve fires once every workout has its HR stats.
  private func summarise(_ workouts: [HKWorkout], completion: @escaping ([[String: Any]]) -> Void) {
    let group = DispatchGroup()
    var out = [[String: Any]](repeating: [:], count: workouts.count)

    for (i, w) in workouts.enumerated() {
      var dict: [String: Any] = [
        "uuid": w.uuid.uuidString,
        "startISO": HealthKitPlugin.iso.string(from: w.startDate),
        "endISO": HealthKitPlugin.iso.string(from: w.endDate),
        "durationSeconds": Int(w.duration),
        "activityType": Int(w.workoutActivityType.rawValue),
        "indoor": (w.metadata?[HKMetadataKeyIndoorWorkout] as? Bool) ?? false,
      ]
      if let dist = w.totalDistance?.doubleValue(for: HKUnit.meter()) {
        dict["distanceMeters"] = dist
      }
      if let energy = w.totalEnergyBurned?.doubleValue(for: HKUnit.kilocalorie()) {
        dict["activeEnergyKcal"] = energy
      }

      group.enter()
      heartRateStats(start: w.startDate, end: w.endDate) { avg, max in
        if let avg = avg { dict["avgHr"] = Int(avg) }
        if let max = max { dict["maxHr"] = Int(max) }
        out[i] = dict
        group.leave()
      }
    }
    group.notify(queue: .main) { completion(out) }
  }

  private func heartRateStats(start: Date, end: Date, completion: @escaping (Double?, Double?) -> Void) {
    guard let hrType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
      completion(nil, nil); return
    }
    let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
    let q = HKStatisticsQuery(quantityType: hrType, quantitySamplePredicate: predicate,
                              options: [.discreteAverage, .discreteMax]) { _, stats, _ in
      let unit = HKUnit.count().unitDivided(by: HKUnit.minute())
      let avg = stats?.averageQuantity()?.doubleValue(for: unit)
      let max = stats?.maximumQuantity()?.doubleValue(for: unit)
      completion(avg, max)
    }
    store.execute(q)
  }

  @objc func queryRoute(_ call: CAPPluginCall) {
    guard #available(iOS 11.0, *) else {
      call.resolve(["track": NSNull()]); return
    }
    guard let uuidString = call.getString("workoutUuid"), let uuid = UUID(uuidString: uuidString) else {
      call.reject("Missing or invalid 'workoutUuid'")
      return
    }

    // 1. Re-fetch the workout by uuid, 2. find its route series, 3. stream the locations.
    let wPredicate = HKQuery.predicateForObject(with: uuid)
    let wQuery = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: wPredicate,
                              limit: 1, sortDescriptors: nil) { [weak self] _, samples, error in
      if let error = error { call.reject(error.localizedDescription, nil, error); return }
      guard let self = self, let workout = samples?.first as? HKWorkout else {
        call.resolve(["track": NSNull()]); return
      }
      self.routePoints(for: workout) { points in
        if points.isEmpty {
          call.resolve(["track": NSNull()])
        } else {
          call.resolve(["track": ["points": points]])
        }
      }
    }
    store.execute(wQuery)
  }

  @available(iOS 11.0, *)
  private func routePoints(for workout: HKWorkout, completion: @escaping ([[String: Any]]) -> Void) {
    let routePredicate = HKQuery.predicateForObjects(from: workout)
    let routeQuery = HKSampleQuery(sampleType: HKSeriesType.workoutRoute(), predicate: routePredicate,
                                   limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, samples, _ in
      guard let self = self, let route = samples?.first as? HKWorkoutRoute else {
        completion([]); return
      }
      var points = [[String: Any]]()
      let dataQuery = HKWorkoutRouteQuery(route: route) { _, locations, done, error in
        // Treat a stream error as terminal — hand back whatever we have so the JS promise
        // always settles. Without this, an errored GPS read never delivers `done=true` and
        // the CAPPluginCall would hang forever (match-to-game UI stuck spinning).
        if error != nil {
          completion(points)
          return
        }
        if let locations = locations {
          for loc in locations {
            points.append([
              "lat": loc.coordinate.latitude,
              "lon": loc.coordinate.longitude,
              "t": HealthKitPlugin.iso.string(from: loc.timestamp),
            ])
          }
        }
        if done { completion(points) }
      }
      self.store.execute(dataQuery)
    }
    store.execute(routeQuery)
  }

  // ISO-8601 with fractional seconds, matching the JS Date().toISOString() the bridge sends.
  private static let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
}
