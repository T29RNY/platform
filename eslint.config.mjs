// Flat ESLint config — a deterministic guard against the runtime-error classes
// that the Vite build, `node --check`, and check-hygiene.sh cannot see.
//
// Primary rule: `no-undef` — an identifier referenced but never declared or
// imported. That is a ReferenceError at runtime while every other gate stays
// green (the name is syntactically valid, just undefined). It shipped the
// `setClearDebtExpanded` casual-status-tap outage (PR #251); this config is the
// gate that catches that whole class at commit time.
//
// Secondary rule: `react-hooks/rules-of-hooks` — a hook called conditionally or
// in a loop crashes React at runtime; also invisible to the build.
//
// Deliberately NARROW: a correctness gate, not a style linter. We do NOT enable
// stylistic or `exhaustive-deps` rules (the codebase opts out of exhaustive-deps
// inline; enabling it would bury the real signal in noise).
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    // Not linted: deps, build output, native shells, dead/archived code, the
    // e2e harness and root tooling/config files. The gate targets shipped
    // app + package source only.
    ignores: [
      "**/node_modules/**", "**/dist/**", "**/build/**", "**/.turbo/**",
      "**/ios/**", "**/android/**", "**/coverage/**", "**/*.min.js",
      "**/_archived_*", "e2e/**", "**/*.config.{js,mjs,cjs}",
    ],
  },
  {
    files: ["apps/**/src/**/*.{js,jsx}", "packages/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser, ...globals.node, ...globals.serviceworker,
        React: "readonly", JSX: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
