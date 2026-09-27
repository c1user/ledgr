import { Card } from "@abaco/ui";
import BrandMark from "@abaco/ui/BrandMark";
import { BRAND } from "@abaco/tokens/brand.js";
import ThemeToggle from "./ThemeToggle.jsx";

/**
 * Frame for the pre-sign-in screens (Login, Mfa), which render outside the
 * Shell and therefore carry their own safe-area insets. Theme toggle in the
 * top corner, 52px mark + wordmark + subtitle, the form in a Card, and an
 * optional plain-text footer. The page scrolls when the keyboard shrinks the
 * viewport (100dvh on #root) so the CTA never hides behind it.
 */
export default function AuthLayout({ subtitle, footer, children }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto overscroll-y-contain bg-canvas pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))]">
      <div className="flex shrink-0 justify-end px-2 pt-2">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 flex-col justify-center px-4 pb-6 pt-2">
        <div className="mx-auto w-full max-w-[400px] fade-in">
          <header className="mb-6 text-center">
            <BrandMark size={52} className="mx-auto mb-3" />
            <div className="font-display text-brand text-[22px] font-bold uppercase tracking-[3px]">
              {BRAND.mobileName}
            </div>
            {subtitle && (
              <p className="mt-1.5 text-md text-muted">{subtitle}</p>
            )}
          </header>

          <Card padding="lg">{children}</Card>

          {footer && <div className="mt-5 text-center">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
