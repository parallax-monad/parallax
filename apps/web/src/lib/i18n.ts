export type Language = "zh-CN" | "en";

export const LANGUAGE_STORAGE_KEY = "parallax-language";

export function getInitialLanguage(): Language {
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "zh-CN"
    ? "zh-CN"
    : "en";
}

export function pick(language: Language, english: string, chinese: string) {
  return language === "zh-CN" ? chinese : english;
}

const EXACT_TEXT: Record<string, string> = {
  "发生了什么": "What happened",
  "Moss 完成 quote、action 与 simulation，呈现这笔交易的真实执行结果。":
    "Moss runs quote, action, and simulation to show the real execution result of this intent.",
  "证据是什么": "What proves it",
  "每个结论都追溯到归一化后的执行证据，并标注来源、区块与 Replay。":
    "Every conclusion traces back to normalized execution evidence, labelled with source, block, and replay.",
  "可以改什么": "What you can change",
  "给出与真实原因相关的调整：Route、Token Pair、Amount 或 Slippage。":
    "Adjustments tied to the actual cause: route, token pair, amount, or slippage.",
  "改了也无效": "What will not help",
  "与当前原因无关的修改会被标为无效，避免反复无效重试。":
    "Changes unrelated to the cause are marked irrelevant, so retries stop being guesswork.",
  "未发现阻断证据": "No blocking evidence",
  "在本次已检查范围内未发现阻断证据，这不代表交易绝对安全。":
    "No blocking evidence was found in the checked scope. This is not a safety guarantee.",
  "修改一个条件": "Change one condition",
  "需要修改一个交易条件，之后可以重新检查。":
    "A transaction condition needs to change, then the check can be re-run.",
  "不应继续": "Do not continue",
  "当前路径无法执行，请更换 Route／Token Pair 或停止。":
    "This path cannot execute. Switch route or token pair, or stop here.",
  "证据不足": "Evidence missing",
  "证据不足以作出可信结论；Unknown 不会被自动放行。":
    "Evidence is insufficient for a trustworthy conclusion, and unknown is never auto-passed.",
};

export function localizeText(text: string | null | undefined, language: Language) {
  if (!text || language === "zh-CN") return text ?? "";
  return EXACT_TEXT[text] ?? text;
}
