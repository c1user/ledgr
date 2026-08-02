import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { Button } from "./ui";
import cx from "../lib/cx";

// First-run welcome tour (V3 Phase 9). Five short coachmarks; the current
// step's target element gets a brand ring via a CSS class (toggled in an
// effect — no DOM measurement, no extra state). Completion is stored
// server-side (users.tour_done_at), so it shows once per USER, not per
// browser. AppLayout renders this only while user.tourDone === false.
const STEPS = [
  // key drives the i18n strings; target is highlighted; place positions the
  // card on sm+ screens (mobile always centers).
  { key: "welcome", target: null, place: "center" },
  { key: "sidebar", target: "[data-tour='sidebar']", place: "left" },
  { key: "actions", target: "[data-tour='quickadd']", place: "topright" },
  { key: "bell", target: "[data-tour='bell']", place: "topright" },
  { key: "checklist", target: "[data-tour='checklist']", place: "center" },
];

const PLACES = {
  center: "left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2",
  left: "left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 sm:translate-x-0 sm:translate-y-0 sm:left-[290px] sm:top-1/3",
  topright:
    "left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 sm:translate-x-0 sm:translate-y-0 sm:left-auto sm:top-16 sm:right-24",
};

export default function ProductTour() {
  const { t } = useTranslation();
  const setUser = useAuthStore((s) => s.setUser);
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  // Ring on the current target — class toggling only, cleaned up per step.
  useEffect(() => {
    if (!current.target) return;
    const el = document.querySelector(current.target);
    if (!el) return;
    el.classList.add("tour-highlight");
    return () => el.classList.remove("tour-highlight");
  }, [current.target]);

  const finish = useMutation({
    // Server first, then local — a failed save just shows the tour again
    // next session, which is harmless.
    mutationFn: () => api.post("/auth/tour-done").then((r) => r.data),
    onSettled: () => setUser({ tourDone: true }),
  });

  const last = step === STEPS.length - 1;

  return (
    <div
      className={cx(
        "fixed z-[400] w-[320px] max-w-[calc(100vw-32px)] p-5",
        "bg-surface border border-brand rounded-card shadow-card fade-in",
        PLACES[current.place],
      )}
      role="dialog"
      aria-label={t("tour.welcomeTitle")}
    >
      <div className="text-sm font-semibold text-ink mb-1.5">
        {t(`tour.${current.key}Title`)}
      </div>
      <p className="text-md text-secondary leading-relaxed mb-4">
        {t(`tour.${current.key}Body`)}
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={cx(
                "w-1.5 h-1.5 rounded-full",
                i === step ? "bg-brand" : "bg-line",
              )}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => finish.mutate()}>
            {t("tour.skip")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={last && finish.isPending}
            onClick={() => (last ? finish.mutate() : setStep(step + 1))}
          >
            {last ? t("tour.done") : t("tour.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
