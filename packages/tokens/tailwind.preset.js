// @abaco/tokens — Tailwind preset shared by frontend/ and mobile/.
// Semantic color names resolve to the CSS custom properties in tokens.css, so
// every utility is automatically light/dark theme-aware. The plugin emits the
// app-wide base rules (body, h1, focus ring, scrollbar, fade-in) that used to
// live in frontend/src/index.css, so both apps get the identical cascade.
// NOTE: this is a Tailwind v3 preset (presets API, borderWidth.DEFAULT). Keep
// both apps on Tailwind 3.4 until they move to v4 together.
import plugin from "tailwindcss/plugin";

export default {
  theme: {
    extend: {
      colors: {
        // Surfaces
        surface: "var(--bg-primary)",
        canvas: "var(--bg-secondary)",
        sunken: "var(--bg-tertiary)",
        sidebar: "var(--bg-sidebar)",
        // Text
        ink: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
        // Borders
        line: {
          DEFAULT: "var(--border-color)",
          hover: "var(--border-hover)",
        },
        // Brand + semantic accents
        brand: {
          DEFAULT: "var(--brand)",
          light: "var(--brand-light)",
          hover: "var(--brand-hover)",
        },
        // Text/icon color on solid brand surfaces (white in light mode,
        // ink in dark mode where the brand plum is light)
        "on-brand": "var(--on-brand)",
        income: { DEFAULT: "var(--income)", bg: "var(--income-bg)" },
        expense: { DEFAULT: "var(--expense)", bg: "var(--expense-bg)" },
        payroll: { DEFAULT: "var(--payroll)", bg: "var(--payroll-bg)" },
        profit: "var(--profit)",
        danger: { DEFAULT: "var(--danger)", bg: "var(--danger-bg)" },
      },
      // The app's hairline-border aesthetic: `border` = 0.5px everywhere.
      borderWidth: {
        DEFAULT: "0.5px",
        1: "1px",
      },
      borderRadius: {
        card: "10px",
      },
      boxShadow: {
        card: "var(--card-shadow)",
      },
      // fontsource family names (see fonts.css); the bare names are the
      // fallbacks for a locally installed copy.
      fontFamily: {
        sans: ["Inter Variable", "Inter", "sans-serif"],
        display: ["Fraunces Variable", "Fraunces", "Georgia", "serif"],
        mono: ["DM Mono", "monospace"],
      },
      fontSize: {
        // The app's dominant control/body size (14px for readability —
        // Roadmap v2 · Phase 1.2)
        md: ["14px", { lineHeight: "1.6" }],
      },
    },
  },
  plugins: [
    plugin(({ addBase, addUtilities, theme }) => {
      // Tailwind 3 hands font families to plugins already joined as a
      // string; tolerate an array too so a future major does not break us.
      const family = (key) => {
        const v = theme(key);
        return Array.isArray(v) ? v.join(", ") : String(v);
      };
      const sans = family("fontFamily.sans");
      const display = family("fontFamily.display");
      addBase({
        "*": { boxSizing: "border-box", margin: "0", padding: "0" },
        body: {
          fontFamily: sans,
          backgroundColor: "var(--bg-secondary)",
          color: "var(--text-primary)",
          fontSize: "14px",
          lineHeight: "1.6",
          // Digits align in every table/column — this is an accounting app.
          fontVariantNumeric: "tabular-nums",
          transition: "background-color 0.2s, color 0.2s",
        },
        // Display face for page titles (component-level uses `font-display`).
        h1: { fontFamily: display, letterSpacing: "-0.01em" },
        // Keyboard navigation: visible ring on keyboard focus only. Form
        // fields are excluded — they carry their own focus:border-brand.
        "button:focus-visible, a:focus-visible, [role=menuitem]:focus-visible, [role=tab]:focus-visible, [tabindex]:focus-visible":
          { outline: "2px solid var(--brand)", outlineOffset: "2px" },
        // Scrollbar
        "::-webkit-scrollbar": { width: "6px" },
        "::-webkit-scrollbar-track": { background: "transparent" },
        "::-webkit-scrollbar-thumb": {
          background: "var(--border-color)",
          borderRadius: "3px",
        },
        "::-webkit-scrollbar-thumb:hover": {
          background: "var(--border-hover)",
        },
        // Animation used by the shared kit (Modal, FeedbackHost) and pages.
        "@keyframes fadeIn": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        ".fade-in": { animation: "fadeIn 0.2s ease" },
      });
      addUtilities({
        // Horizontal tab strips / chip rows on phones: keep them swipeable
        // without painting a permanent scrollbar track under them.
        ".scrollbar-none": {
          scrollbarWidth: "none",
          "-ms-overflow-style": "none",
        },
        ".scrollbar-none::-webkit-scrollbar": { display: "none" },
      });
    }),
  ],
};
