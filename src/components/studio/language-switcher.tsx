"use client";

import { Languages } from "lucide-react";

import { useI18n } from "@/lib/i18n/context";
import { localeNames, locales, type Locale } from "@/lib/i18n/messages";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className="studio-lang" title={t("lang.label")}>
      <Languages className="size-3.5 shrink-0 text-stone-500" aria-hidden="true" />
      <span className="sr-only">{t("lang.label")}</span>
      <select
        className="studio-lang-select"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        aria-label={t("lang.label")}
      >
        {locales.map((item) => (
          <option key={item} value={item}>
            {localeNames[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
