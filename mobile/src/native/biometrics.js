// Biometric app lock (Face ID / Touch ID / Android BiometricPrompt).
//   Device: @aparajita/capacitor-biometric-auth.
//   Web:    isAvailable() false; authenticate() resolves true with a
//           console.info so the lock screen can be exercised in Chrome.
import { isNative } from "./platform.js";

export const isSupported = () => isNative();

export async function isAvailable() {
  if (!isNative()) return false;
  try {
    const { BiometricAuth } =
      await import("@aparajita/capacitor-biometric-auth");
    const { isAvailable: available } = await BiometricAuth.checkBiometry();
    return !!available;
  } catch {
    return false;
  }
}

/** authenticate(reasonText) → boolean (false on cancel/failure). */
export async function authenticate(reasonText) {
  if (!isNative()) {
    console.info("[abaco] biometrics: web fallback — auto-approving.");
    return true;
  }
  try {
    const { BiometricAuth } =
      await import("@aparajita/capacitor-biometric-auth");
    await BiometricAuth.authenticate({
      reason: reasonText,
      allowDeviceCredential: true,
    });
    return true;
  } catch {
    return false;
  }
}
