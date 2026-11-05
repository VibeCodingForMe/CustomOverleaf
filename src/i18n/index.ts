import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";
import ru from "./ru";

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;

export const templates = [
  { id: "article", icon: "file-text" },
  { id: "report", icon: "book-open" },
  { id: "thesis", icon: "library" },
  { id: "book", icon: "book" },
  { id: "beamer", icon: "presentation" },
  { id: "letter", icon: "mail" },
  { id: "blank", icon: "file" },
] as const;

export type TemplateId = (typeof templates)[number]["id"];
