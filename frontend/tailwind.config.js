// Semantic color names resolve to the CSS custom properties defined in
// src/index.css, so every utility is automatically light/dark theme-aware.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
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
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["DM Mono", "monospace"],
      },
      fontSize: {
        // The app's dominant control/body size
        md: ["13px", { lineHeight: "1.6" }],
      },
    },
  },
  plugins: [],
};
