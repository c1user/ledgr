import BrandMark from "@abaco/ui/BrandMark";
import { BRAND } from "@abaco/tokens/brand.js";

/** Full-screen boot splash shown while authStore.hydrate() runs. */
export default function Splash() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-canvas"
      role="status"
      aria-busy="true"
    >
      <BrandMark size={64} />
      <div className="font-display text-brand text-[15px] font-bold tracking-[3px] uppercase">
        {BRAND.mobileName}
      </div>
    </div>
  );
}
