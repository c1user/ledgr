import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, PageHeader, Select, Toggle } from "@abaco/ui";
import { confirmDialog, toast } from "@abaco/ui/feedback";
import api from "../lib/api.js";
import { LOCK_AFTER_OPTIONS, markUnlocked } from "../lib/lockGate.js";
import useAuthStore from "../store/authStore.js";
import useOutboxStore from "../store/outboxStore.js";
import usePrefsStore from "../store/prefsStore.js";
import useThemeStore, { THEMES } from "../store/themeStore.js";
import {
  authenticate,
  isAvailable as biometricsAvailable,
  isSupported as biometricsSupported,
} from "../native/biometrics.js";
import {
  isSupported as notificationsSupported,
  requestPermission,
} from "../native/notifications.js";
import { openExternal } from "../native/browser.js";
import SettingRow from "../components/settings/SettingRow.jsx";
import Segmented from "../components/settings/Segmented.jsx";

// Owner rule: the phone is SIGN-IN ONLY. Plan information here is a label;
// there are no prices, no purchase buttons and no upgrade links anywhere.
const WEB_URL = "https://abacopr.com";
const LINKS = {
  dashboard: `${WEB_URL}/dashboard`,
  terms: `${WEB_URL}/terms`,
  privacy: `${WEB_URL}/privacy`,
};

const THEME_ICONS = {
  light: "ti-sun",
  dark: "ti-moon",
  system: "ti-device-mobile",
};
const THEME_KEYS = {
  light: "mobile.settings.light",
  dark: "mobile.settings.dark",
  system: "mobile.settings.system",
};
const PLAN_KEYS = {
  starter: "upgrade.plan_starter",
  professional: "upgrade.plan_professional",
  premium: "upgrade.plan_premium",
};

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "0.0.0";
const APP_BUILD = import.meta.env.VITE_BUILD || "0";

const fetchAccounts = async () => {
  const { data } = await api.get("/accounts");
  return Array.isArray(data) ? data : [];
};

export default function Settings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  // Session (user/business may be null while the session is stale/offline).
  const user = useAuthStore((s) => s.user);
  const business = useAuthStore((s) => s.business);
  const setLanguage = useAuthStore((s) => s.setLanguage);
  const signOut = useAuthStore((s) => s.signOut);
  const signOutEverywhere = useAuthStore((s) => s.signOutEverywhere);

  // Device preferences.
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const defaultAccountId = usePrefsStore((s) => s.defaultAccountId);
  const setDefaultAccountId = usePrefsStore((s) => s.setDefaultAccountId);
  const biometricLock = usePrefsStore((s) => s.biometricLock);
  const setBiometricLock = usePrefsStore((s) => s.setBiometricLock);
  const lockAfterMinutes = usePrefsStore((s) => s.lockAfterMinutes);
  const setLockAfterMinutes = usePrefsStore((s) => s.setLockAfterMinutes);
  const remindersEnabled = usePrefsStore((s) => s.remindersEnabled);
  const setRemindersEnabled = usePrefsStore((s) => s.setRemindersEnabled);

  const [bioAvailable, setBioAvailable] = useState(false);
  const [busy, setBusy] = useState(null); // "language" | "biometrics" | "reminders" | "signOut" | "signOutAll"

  useEffect(() => {
    let alive = true;
    biometricsAvailable().then((v) => alive && setBioAvailable(v));
    return () => {
      alive = false;
    };
  }, []);

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
    select: (rows) => rows.filter((a) => a.is_active !== false),
  });
  const activeAccounts = accounts.data || [];
  const selectedAccount = activeAccounts.some((a) => a.id === defaultAccountId)
    ? defaultAccountId
    : "";

  const lang = String(i18n.language || "en").startsWith("es") ? "es" : "en";

  const onLanguage = async (next) => {
    if (next === lang || busy) return;
    setBusy("language");
    try {
      await setLanguage(next);
    } catch {
      toast.error(t("login.genericError"));
    } finally {
      setBusy(null);
    }
  };

  const onBiometricLock = async () => {
    if (busy) return;
    if (biometricLock) {
      setBiometricLock(false);
      return;
    }
    setBusy("biometrics");
    try {
      // On a device, prove biometrics work before trusting them as the lock.
      if (biometricsSupported()) {
        const ok = await authenticate(t("mobile.lock.useBiometrics"));
        if (!ok) return;
      }
      markUnlocked(); // the user is here right now — don't lock on the spot
      setBiometricLock(true);
    } finally {
      setBusy(null);
    }
  };

  const onReminders = async () => {
    if (busy) return;
    if (remindersEnabled) {
      setRemindersEnabled(false); // App.jsx unmounts the scheduler → cancelAll()
      return;
    }
    setBusy("reminders");
    try {
      if (notificationsSupported()) {
        const granted = await requestPermission();
        if (!granted) {
          toast.error(t("mobile.settings.remindersDenied"));
          return;
        }
      }
      setRemindersEnabled(true);
    } finally {
      setBusy(null);
    }
  };

  // An explicit sign-out means a different person may use this device next:
  // drop the offline outbox (queued captures + their bytes) before the session
  // goes. A session EXPIRY keeps it so the same user's re-login resumes them.
  const onSignOut = async () => {
    if (busy) return;
    setBusy("signOut");
    await useOutboxStore.getState().clear();
    await signOut();
    navigate("/login", { replace: true });
  };

  const onSignOutEverywhere = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: t("mobile.settings.signOutEverywhere"),
      message: t("mobile.settings.signOutEverywhereConfirm"),
      confirmLabel: t("mobile.settings.signOutEverywhere"),
      danger: true,
    });
    if (!ok) return;
    setBusy("signOutAll");
    await useOutboxStore.getState().clear();
    try {
      await signOutEverywhere();
    } catch {
      // The local session is already gone (signOutEverywhere signs out in
      // its finally); only the server call failed.
      toast.error(t("login.genericError"));
    }
    navigate("/login", { replace: true });
  };

  const planKey = business?.plan ? PLAN_KEYS[business.plan] : null;
  const planLabel = planKey ? t(planKey) : business?.plan || null;

  return (
    <div className="p-4 pb-8 space-y-5">
      <PageHeader title={t("mobile.settings.title")} className="mb-0" />

      {/* Account */}
      <section aria-labelledby="settings-account">
        <SectionTitle id="settings-account">
          {t("mobile.settings.account")}
        </SectionTitle>
        <Card padding="none" className="overflow-hidden divide-y divide-line">
          <SettingRow
            icon="ti-user"
            label={t("common.name")}
            value={user?.name || "—"}
          />
          <SettingRow
            icon="ti-mail"
            label={t("common.email")}
            value={user?.email || "—"}
          />
        </Card>
      </section>

      {/* Business (informational — plans are managed on the web) */}
      <section aria-labelledby="settings-business">
        <SectionTitle id="settings-business">
          {t("mobile.settings.business")}
        </SectionTitle>
        <Card padding="none" className="overflow-hidden divide-y divide-line">
          <SettingRow
            icon="ti-building-store"
            label={t("common.name")}
            value={business?.name || "—"}
          />
          <SettingRow
            icon="ti-id-badge"
            label={t("mobile.settings.plan")}
            control={planLabel ? <Badge tone="brand">{planLabel}</Badge> : null}
            value={planLabel ? undefined : "—"}
          />
        </Card>
      </section>

      {/* Preferences */}
      <Card padding="none" className="overflow-hidden divide-y divide-line">
        <SettingRow
          icon="ti-palette"
          label={t("mobile.settings.appearance")}
          stacked
        >
          <Segmented
            ariaLabel={t("mobile.settings.appearance")}
            value={theme}
            onChange={setTheme}
            options={THEMES.map((id) => ({
              value: id,
              label: t(THEME_KEYS[id]),
              icon: THEME_ICONS[id],
            }))}
          />
        </SettingRow>

        <SettingRow
          icon="ti-language"
          label={t("mobile.settings.language")}
          stacked
        >
          <Segmented
            ariaLabel={t("mobile.settings.language")}
            value={lang}
            onChange={onLanguage}
            options={[
              { value: "en", label: t("settings.english") },
              { value: "es", label: t("settings.spanish") },
            ]}
          />
        </SettingRow>

        <SettingRow
          icon="ti-wallet"
          label={t("mobile.settings.defaultAccount")}
          hint={t("mobile.settings.defaultAccountHint")}
          htmlFor="settings-default-account"
          stacked
        >
          <Select
            id="settings-default-account"
            value={selectedAccount}
            onChange={(e) => setDefaultAccountId(e.target.value || null)}
            disabled={accounts.isLoading}
          >
            <option value="">
              {accounts.isLoading
                ? t("common.loading")
                : t("mobile.review.book.selectAccount")}
            </option>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </SettingRow>
      </Card>

      {/* Security & reminders */}
      <Card padding="none" className="overflow-hidden divide-y divide-line">
        <SettingRow
          icon="ti-fingerprint"
          label={t("mobile.settings.biometricLock")}
          hint={
            bioAvailable
              ? t("mobile.settings.biometricLockHint")
              : t("mobile.settings.biometricLockWebHint")
          }
          control={
            <Toggle
              checked={biometricLock}
              onChange={onBiometricLock}
              disabled={busy === "biometrics"}
              aria-label={t("mobile.settings.biometricLock")}
            />
          }
        />
        {biometricLock && (
          <SettingRow
            icon="ti-lock"
            label={t("mobile.settings.lockAfter")}
            htmlFor="settings-lock-after"
            control={
              <div className="w-32">
                <Select
                  id="settings-lock-after"
                  value={String(lockAfterMinutes)}
                  onChange={(e) => setLockAfterMinutes(Number(e.target.value))}
                >
                  {LOCK_AFTER_OPTIONS.map((m) => (
                    <option key={m} value={String(m)}>
                      {t("mobile.settings.minutes", { count: m })}
                    </option>
                  ))}
                </Select>
              </div>
            }
          />
        )}
        <SettingRow
          icon="ti-bell"
          label={t("mobile.settings.reminders")}
          hint={t("mobile.settings.remindersHint")}
          control={
            <Toggle
              checked={remindersEnabled}
              onChange={onReminders}
              disabled={busy === "reminders"}
              aria-label={t("mobile.settings.reminders")}
            />
          }
        />
      </Card>

      {/* Web, legal */}
      <Card padding="none" className="overflow-hidden divide-y divide-line">
        <SettingRow
          icon="ti-world"
          label={t("mobile.settings.openWeb")}
          trailingIcon="ti-external-link"
          onPress={() => openExternal(LINKS.dashboard)}
        />
        <SettingRow
          icon="ti-file-text"
          label={t("mobile.settings.terms")}
          trailingIcon="ti-external-link"
          onPress={() => openExternal(LINKS.terms)}
        />
        <SettingRow
          icon="ti-shield-lock"
          label={t("mobile.settings.privacy")}
          trailingIcon="ti-external-link"
          onPress={() => openExternal(LINKS.privacy)}
        />
      </Card>
      <p className="px-1 text-xs text-muted">
        {t("mobile.settings.deleteAccountHint")}
      </p>

      {/* Session */}
      <div className="space-y-3 pt-1">
        <Button
          variant="secondary"
          size="lg"
          full
          icon="ti-logout"
          loading={busy === "signOut"}
          disabled={!!busy && busy !== "signOut"}
          onClick={onSignOut}
        >
          {t("mobile.settings.signOut")}
        </Button>
        <Button
          variant="danger"
          size="lg"
          full
          icon="ti-devices-off"
          loading={busy === "signOutAll"}
          disabled={!!busy && busy !== "signOutAll"}
          onClick={onSignOutEverywhere}
        >
          {t("mobile.settings.signOutEverywhere")}
        </Button>
      </div>

      <p className="text-center text-xs text-muted">
        {t("mobile.settings.version")} {APP_VERSION} ·{" "}
        {t("mobile.settings.build")} {APP_BUILD}
      </p>
    </div>
  );
}

function SectionTitle({ id, children }) {
  return (
    <h2
      id={id}
      className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted"
    >
      {children}
    </h2>
  );
}
