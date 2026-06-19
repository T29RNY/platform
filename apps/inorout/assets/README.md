# Native app icon + splash masters

Source images for `@capacitor/assets`. The tool reads this folder and writes
platform-specific icons and splash screens into the generated `ios/` and
`android/` projects.

| File              | Size       | Purpose                                            |
|-------------------|------------|----------------------------------------------------|
| `icon.png`        | 1024×1024  | App icon master (all iOS + Android densities)      |
| `splash.png`      | 2732×2732  | Launch splash — logo centred on `#0A0A08`          |
| `splash-dark.png` | 2732×2732  | Dark-mode splash (app is dark-only → same image)   |

These were bootstrapped from the existing brand mark
(`public/icons/web-app-manifest-512x512.png`, upscaled). **Replace `icon.png`
with a crisp 1024×1024 export of the real brand artwork before the store
screenshot shoot (Stage 4.1)** — the upscaled placeholder is fine for wiring
and TestFlight, not for a final App Store listing.

## Generate (run on a machine with Xcode + Android Studio)

```bash
cd apps/inorout
npm run build            # produces dist/ (webDir; carries offline.html)
npx cap add ios          # generates ios/  (needs Xcode + CocoaPods)
npx cap add android      # generates android/ (needs JDK + Android SDK)
npx capacitor-assets generate --iconBackgroundColor '#0A0A08' --splashBackgroundColor '#0A0A08'
npx cap sync
```

The `ios/` and `android/` folders are gitignored — regenerate them, don't
commit them. Splash background + status-bar styling are configured in
`capacitor.config.ts`; the runtime status-bar/splash/back-button bridge lives
in `src/native/native-shell.js`.
