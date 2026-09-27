// Re-export shim: the brand identity now lives in the shared tokens package
// (ROADMAP-V6 Phase 1.2) so the web app and the mobile companion agree.
// Existing imports of "config/brand" keep working unchanged.
export { BRAND, HEX, default } from "@abaco/tokens/brand.js";
