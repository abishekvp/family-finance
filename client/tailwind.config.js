/** @type {import('tailwindcss').Config} */

// Every palette entry below resolves through a CSS custom property holding an "R G B" triplet
// (see src/styles/tokens.css). That is what lets one class — `bg-surface`, `text-muted` — mean
// the right thing in both themes without a `dark:` twin on every element.
const withAlpha = (token) => `rgb(var(${token}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: withAlpha("--c-canvas"),
        surface: {
          DEFAULT: withAlpha("--c-surface"),
          raised: withAlpha("--c-surface-raised"),
          sunken: withAlpha("--c-surface-sunken"),
        },
        line: {
          DEFAULT: withAlpha("--c-line"),
          strong: withAlpha("--c-line-strong"),
        },
        ink: {
          DEFAULT: withAlpha("--c-ink"),
          muted: withAlpha("--c-ink-muted"),
          subtle: withAlpha("--c-ink-subtle"),
        },
        brand: {
          50: withAlpha("--c-brand-50"),
          100: withAlpha("--c-brand-100"),
          200: withAlpha("--c-brand-200"),
          300: withAlpha("--c-brand-300"),
          400: withAlpha("--c-brand-400"),
          500: withAlpha("--c-brand-500"),
          600: withAlpha("--c-brand-600"),
          700: withAlpha("--c-brand-700"),
          800: withAlpha("--c-brand-800"),
          900: withAlpha("--c-brand-900"),
          DEFAULT: withAlpha("--c-brand-500"),
          soft: withAlpha("--c-brand-soft"),
        },
        income: {
          DEFAULT: withAlpha("--c-income"),
          soft: withAlpha("--c-income-soft"),
        },
        expense: {
          DEFAULT: withAlpha("--c-expense"),
          soft: withAlpha("--c-expense-soft"),
        },
        warn: {
          DEFAULT: withAlpha("--c-warn"),
          soft: withAlpha("--c-warn-soft"),
        },
        info: {
          DEFAULT: withAlpha("--c-info"),
          soft: withAlpha("--c-info-soft"),
        },
        // Aurora accent ramp — used for chart series and category swatch fallbacks.
        aurora: {
          violet: "#A855F7",
          indigo: "#6366F1",
          cyan: "#22D3EE",
          mint: "#2DD4BF",
          lime: "#84CC16",
          amber: "#F59E0B",
          coral: "#FB7185",
          plum: "#C084FC",
        },
      },
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans"',
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        num: [
          '"Plus Jakarta Sans"',
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        display: ["2.75rem", { lineHeight: "1.05", letterSpacing: "-0.035em", fontWeight: "700" }],
        figure: ["2rem", { lineHeight: "1.1", letterSpacing: "-0.03em", fontWeight: "700" }],
      },
      borderRadius: {
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
        "4xl": "2.25rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgb(var(--c-shadow) / 0.04), 0 8px 24px -10px rgb(var(--c-shadow) / 0.16)",
        lift: "0 2px 4px rgb(var(--c-shadow) / 0.06), 0 20px 44px -16px rgb(var(--c-shadow) / 0.28)",
        float: "0 8px 12px -6px rgb(var(--c-shadow) / 0.10), 0 32px 64px -24px rgb(var(--c-shadow) / 0.38)",
        glow: "0 10px 30px -10px rgb(var(--c-brand-500) / 0.55)",
        "glow-sm": "0 6px 18px -8px rgb(var(--c-brand-500) / 0.55)",
        inset: "inset 0 1px 0 0 rgb(255 255 255 / var(--c-sheen))",
      },
      backdropBlur: {
        glass: "22px",
      },
      transitionTimingFunction: {
        swift: "cubic-bezier(0.22, 1, 0.36, 1)",
        snap: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        "aurora-drift": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "33%": { transform: "translate3d(4%, -5%, 0) scale(1.08)" },
          "66%": { transform: "translate3d(-4%, 4%, 0) scale(0.95)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "aurora-drift": "aurora-drift 26s ease-in-out infinite",
        "fade-in": "fade-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both",
        "rise-in": "rise-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
        "sheet-up": "sheet-up 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};
