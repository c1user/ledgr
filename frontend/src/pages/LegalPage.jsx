import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BRAND from "../config/brand";
import BrandMark from "../components/BrandMark";
import { TERMS } from "../legal/terms";
import { PRIVACY } from "../legal/privacy";

// Set to false once counsel has reviewed and approved the documents.
const DRAFT = true;

const DOCS = { terms: TERMS, privacy: PRIVACY };

// Public renderer for /terms and /privacy. Content lives in src/legal/*
// as plain data so the documents stay easy to review and edit.
export default function LegalPage({ doc }) {
  const { t, i18n } = useTranslation();
  const source = DOCS[doc];
  const lang = i18n.language === "es" ? "es" : "en";
  const content = source[lang];

  return (
    <div className="min-h-screen bg-canvas py-10 px-6">
      <div className="max-w-[720px] mx-auto">
        <div className="text-center mb-8">
          <Link to="/login" className="inline-block">
            <BrandMark size={44} className="mx-auto mb-2" />
            <div className="font-display text-brand text-lg font-bold tracking-[4px] uppercase">
              {BRAND.name}
            </div>
          </Link>
        </div>

        <div className="bg-surface border border-line rounded-card shadow-card p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <h1 className="text-xl font-bold text-ink">{content.title}</h1>
            {DRAFT && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-expense-bg text-expense uppercase tracking-wide">
                {t("legal.draft")}
              </span>
            )}
          </div>
          <div className="text-xs text-muted mb-6">
            {t("legal.updated", { date: source.updated })}
          </div>

          {content.sections.map((s) => (
            <section key={s.h} className="mb-5">
              <h2 className="text-sm font-semibold text-ink mb-1.5">{s.h}</h2>
              <p className="text-md text-secondary leading-relaxed">{s.p}</p>
            </section>
          ))}
        </div>

        <div className="text-center mt-6 text-md text-muted">
          <Link to="/terms" className="text-brand font-medium mx-2">
            {t("legal.termsLink")}
          </Link>
          ·
          <Link to="/privacy" className="text-brand font-medium mx-2">
            {t("legal.privacyLink")}
          </Link>
          ·
          <Link to="/login" className="text-brand font-medium mx-2">
            {t("resetpw.backToLogin")}
          </Link>
        </div>
      </div>
    </div>
  );
}
