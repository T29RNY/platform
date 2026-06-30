#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Capacitor ObjC registration for the Swift HealthKitPlugin. Exposes the plugin to JS as
// "HealthKit" with three promise-returning methods. Required alongside HealthKitPlugin.swift
// — Capacitor discovers plugins via these CAP_PLUGIN macros at runtime.
CAP_PLUGIN(HealthKitPlugin, "HealthKit",
  CAP_PLUGIN_METHOD(requestAuthorization, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(queryWorkouts, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(queryRoute, CAPPluginReturnPromise);
)
