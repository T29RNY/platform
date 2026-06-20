#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Capacitor ObjC registration for the Swift AuthSessionPlugin. Exposes the
// plugin to JS as "AuthSession" with a single promise-returning method `start`.
// Required alongside AuthSessionPlugin.swift — Capacitor discovers plugins via
// these CAP_PLUGIN macros at runtime.
CAP_PLUGIN(AuthSessionPlugin, "AuthSession",
  CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
)
