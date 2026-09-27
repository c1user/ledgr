// @abaco/tokens — brand identity constants shared by every app.
// Change the product name here — never hard-code it in components.
export const BRAND = {
  name: "Abaco",
  mobileName: "Abaco Scan", // store name of the mobile companion (ROADMAP-V6)
  appId: "com.abacopr.scan", // iOS bundle id / Android application id
};

// Literal hex values for the places CSS variables cannot reach: the PWA
// manifest, <meta name="theme-color">, native splash screens and status bars,
// generated icons. tokens.test.mjs asserts every value here exists in
// tokens.css, so these cannot drift from the live theme.
export const HEX = {
  brand: "#5b3a9b", // --brand (light)
  brandDark: "#a987e9", // --brand (dark)
  brandHover: "#472a7e", // --brand-hover (light); the mark's bead outline
  accent: "#f0895c", // orange beads on the mark; --expense (dark)
  surfaceLight: "#ffffff", // --bg-primary (light)
  surfaceDark: "#181420", // --bg-primary (dark)
  canvasLight: "#f7f6fa", // --bg-secondary (light); PWA background_color
  canvasDark: "#110e18", // --bg-secondary (dark)
};

export default BRAND;
