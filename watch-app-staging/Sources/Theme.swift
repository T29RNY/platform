//  Theme.swift
//  IoO Ref watchOS — design tokens
//
//  Colours are transcribed EXACTLY from the design source of truth:
//    design_handoff_watchos/design_files/watch/watch-os.css  (:root custom properties)
//
//  Typography is mapped to NATIVE SF per the locked decision — the prototype names
//  Archivo (display) + Hanken Grotesk (UI), but we do NOT bundle web fonts on watchOS.
//  SF Compact / SF Pro Rounded are the watchOS-native analogs. Numbers that change
//  (clock, score, timers) MUST use .monospacedDigit() (the prototype's tabular-nums).
//
//  NOTE ON SIZES: the prototype is authored at ~2× the physical watch and its px sizes
//  are PROPORTIONAL, not literal points. Concrete point sizes are intentionally NOT
//  hardcoded here — derive them per device (49mm / 45mm / 41mm) against Apple's
//  watchOS type ramp, keeping the prototype's hierarchy (clock dominates; body legible
//  at arm's length; 44pt minimum tap target).
//
//  STAGING: not yet compiled. Expect to validate in Xcode post-approval.

import SwiftUI

enum Theme {

    // MARK: - Colours (exact hex from watch-os.css)

    enum Palette {
        // Surfaces — true-black OLED base
        static let black     = Color(hex: 0x000000)   // --w-black: screen base, bleeds into bezel
        static let bg        = Color(hex: 0x07090C)    // --w-bg
        static let surface   = Color(hex: 0x141821)    // --w-surface: cards / list rows
        static let surface2  = Color(hex: 0x1C212B)    // --w-surface2: secondary buttons, shirt tokens
        static let raised    = Color(hex: 0x262C38)    // --w-raised: raised buttons
        static let hair      = Color(hex: 0x2A313D)    // --w-hair: hairline border
        static let hair2     = Color(hex: 0x3A4150)    // --w-hair2: stronger hairline

        // Text
        static let txt       = Color(hex: 0xF4F6FA)    // --w-txt: primary
        static let txt2      = Color(hex: 0xAEB7C4)    // --w-txt2: secondary
        static let txt3      = Color(hex: 0x717B8A)    // --w-txt3: tertiary / labels

        // Brand accent (teal)
        static let accent    = Color(hex: 0x19D8C4)    // --w-accent: primary
        static let accentB   = Color(hex: 0x3DF0DC)    // --w-accent-b: bright / gradient top
        static let accentD   = Color(hex: 0x0E9A8C)    // --w-accent-d: deep / gradient bottom
        static let accentInk = Color(hex: 0x04201D)    // --w-accent-ink: ink ON the teal accent
        static let glow      = Color(hex: 0x19D8C4).opacity(0.45)  // --w-glow

        // Semantic / event colours
        static let yellow    = Color(hex: 0xF5C518)    // --w-yellow: yellow card
        static let red       = Color(hex: 0xFF4B44)    // --w-red: red card / send-off / FT confirm
        static let amber     = Color(hex: 0xFBA63A)    // --w-amber: sin bin
        static let blue      = Color(hex: 0x5B8CFF)    // --w-blue
        static let green     = Color(hex: 0x36C46E)    // --w-green: substitution "on" / bring-on
        static let ownGoal   = Color(hex: 0xF0743C)    // --w-og: own goal

        // Casual team colours — the product's TWO brand colours (locked).
        // These differ from the league sample club colours; casual uses ONLY these two.
        static let teamA     = Color(hex: 0x60A0FF)    // Team A — blue jerseys
        static let teamB     = Color(hex: 0xFF6060)    // Team B — red jerseys
    }

    // MARK: - Typography (native SF; relative roles, not fixed points)
    //
    // .design: SF Compact is the watchOS default; we use it for everything and lean on
    // weight + tracking for the "display" feel. Numbers use .monospacedDigit().

    enum TypeRole {
        /// Match clock — the single largest element on the live screen. Tabular.
        case clock
        /// Score numerals — large, tabular.
        case score
        /// Player / team name — display weight.
        case name
        /// Eyebrow labels — UPPERCASE, wide tracking, tertiary colour.
        case eyebrow
        /// Button label.
        case button
        /// Pills / meta — UPPERCASE, medium tracking.
        case pill
        /// Body / secondary text.
        case body

        /// Re-derive concrete sizes per device; relativeTo anchors keep the ramp.
        var font: Font {
            switch self {
            case .clock:   return .system(.largeTitle, design: .rounded).weight(.heavy).monospacedDigit()
            case .score:   return .system(.title, design: .rounded).weight(.heavy).monospacedDigit()
            case .name:    return .system(.title3, design: .rounded).weight(.heavy)
            case .eyebrow: return .system(.caption2, design: .rounded).weight(.heavy)
            case .button:  return .system(.headline, design: .rounded).weight(.heavy)
            case .pill:    return .system(.caption, design: .rounded).weight(.heavy)
            case .body:    return .system(.body, design: .rounded).weight(.medium)
            }
        }

        /// Tracking from the prototype (eyebrow 0.12em, pill 0.06em, display -0.01em).
        var tracking: CGFloat {
            switch self {
            case .clock, .score, .name: return -0.5
            case .eyebrow:              return 1.6
            case .pill:                 return 0.8
            case .button, .body:        return 0
            }
        }

        /// Roles that are rendered UPPERCASE in the design.
        var isUppercase: Bool { self == .eyebrow || self == .pill }
    }

    // MARK: - Radii (proportional — re-derive per device)

    enum Radius {
        static let card: CGFloat   = 22   // screen-content cards / sheets
        static let pill: CGFloat   = 28   // pill buttons (26–30)
        static let chip: CGFloat   = 13   // small chips / strips (e.g. sin-bin strip)
        static let dock: CGFloat   = 36   // circular dock button (72px standard ÷ 2)
        static let dockPrimary: CGFloat = 46  // primary "+" dock circle (92px ÷ 2)
        /// Shirt token: ~0.32× of its own side (superellipse-ish rounded square).
        static func shirt(side: CGFloat) -> CGFloat { side * 0.32 }
    }

    // MARK: - Motion (honour Reduce Motion)

    enum Motion {
        static let pressScale: CGFloat = 0.96       // circles use 0.92
        static let pressScaleCircle: CGFloat = 0.92
        static let pressDuration: Double = 0.08
        static let pulsePeriod: Double = 1.8        // live pulse dot expanding ring
    }
}

// MARK: - Color(hex:) helper

extension Color {
    /// 0xRRGGBB literal → Color. (Design tokens are all opaque hex.)
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8)  & 0xFF) / 255.0
        let b = Double( hex        & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1.0)
    }
}
</content>
