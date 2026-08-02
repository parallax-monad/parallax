export type Language = "zh-CN" | "en";

export const LANGUAGE_STORAGE_KEY = "parallax-language";

/** Paired copy so English never falls back to the Chinese source string. */
export type Copy = { en: string; zh: string };

export function getInitialLanguage(): Language {
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "zh-CN"
    ? "zh-CN"
    : "en";
}

export function pick(language: Language, english: string, chinese: string) {
  return language === "zh-CN" ? chinese : english;
}

export function say(language: Language, copy: Copy) {
  return language === "zh-CN" ? copy.zh : copy.en;
}
