/* Translation lookup + static-markup translation pass. */
import { state } from "./state.js";
import { $$ } from "./dom.js";
import { I18N } from "../data/translations.js";
import { countryName } from "./location.js";

export function t(key) {
  return I18N[state.lang][key] ?? I18N.en[key] ?? key;
}

export function applyStaticI18n() {
  $$("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  $$("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  $$("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  /* static country names (map quick-jump chips) follow the interface language */
  $$("[data-country]").forEach((el) => {
    el.textContent = countryName(el.dataset.country, el.textContent);
  });
}
