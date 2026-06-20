import Foundation
import Capacitor
import AuthenticationServices

// AuthSession — DORMANT iOS fallback for OAuth return (Stage 5.3 / finding F4).
//
// Opens an OAuth/Sign-in-with-Apple URL in ASWebAuthenticationSession and
// resolves with the FINAL callback URL (uk.inorout.app://auth/callback?code=…).
// Unlike @capacitor/browser (SFSafariViewController), ASWebAuthenticationSession
// takes the callback scheme explicitly and is guaranteed to return to the app —
// it does NOT depend on the OS routing a custom-scheme redirect through
// appUrlOpen, which is the SFSafariViewController limitation that broke F4.
//
// JS side: registerPlugin('AuthSession').start({ url, scheme }) → { url }.
// Wired in apps/inorout/src/native/native-auth.js (NATIVE_OAUTH_VIA='authsession').
@objc(AuthSessionPlugin)
public class AuthSessionPlugin: CAPPlugin, ASWebAuthenticationPresentationContextProviding {

  // Held strongly for the lifetime of the session, else ARC tears it down.
  private var session: ASWebAuthenticationSession?

  @objc func start(_ call: CAPPluginCall) {
    guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
      call.reject("Missing or invalid 'url'")
      return
    }
    let scheme = call.getString("scheme") ?? "uk.inorout.app"

    DispatchQueue.main.async {
      let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callbackURL, error in
        if let error = error {
          // User cancel surfaces here too (ASWebAuthenticationSessionError.canceledLogin).
          call.reject(error.localizedDescription, nil, error)
          return
        }
        guard let callbackURL = callbackURL else {
          call.reject("No callback URL returned")
          return
        }
        call.resolve(["url": callbackURL.absoluteString])
      }
      session.presentationContextProvider = self
      // Keep the provider session cookie so returning users aren't re-prompted.
      session.prefersEphemeralWebBrowserSession = false
      self.session = session
      session.start()
    }
  }

  public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return self.bridge?.viewController?.view.window ?? ASPresentationAnchor()
  }
}
