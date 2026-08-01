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
  "協議風險": "Protocol risk",
  "審計、權限、預言機與安全歷史。": "Audits, privileges, oracles, and security history.",
  "流動性風險": "Liquidity risk",
  "池內深度、價格影響與路由複雜度。": "Pool depth, price impact, and route complexity.",
  "交易風險": "Transaction risk",
  "滑點、餘額、授權與執行條件。": "Slippage, balances, approvals, and execution conditions.",
  "模擬證據": "Simulation evidence",
  "Gas、回執、告警與資產變動。": "Gas, receipts, warnings, and asset changes.",
  "條件清晰": "Clear conditions",
  "已取得能支持低風險判斷的證據。": "Evidence supports a low-risk assessment.",
  "需要注意": "Attention required",
  "存在需要在簽名前進一步確認的條件。": "Some conditions require confirmation before signing.",
  "提高審查": "Heightened review",
  "執行或流動性風險可能顯著影響結果。": "Execution or liquidity risk may materially affect the outcome.",
  "停止並核實": "Stop and verify",
  "發現可能導致交易失敗或資產損失的信號。": "Signals may lead to transaction failure or asset loss.",
  "模擬回滾": "Simulation reverted",
  "模擬返回回滾狀態。": "The simulation returned a reverted state.",
  "Gas 接近上限": "Gas near limit",
  "Gas 用量超過設定上限的 95%。": "Gas usage exceeds 95% of the configured limit.",
  "通過但有告警": "Passed with warnings",
  "通過": "Passed",
  "回滾": "Reverted",
  "模擬輸出低於容忍度": "Simulated output below tolerance",
  "模擬反映模擬時狀態；執行時狀態可能變化。": "Simulation reflects state at simulation time; execution-time state may change.",
  "嚴重": "Critical",
  "高": "High",
  "中": "Medium",
  "低": "Low",
  "提示": "Info",
  "Kuru 實時": "Kuru live",
  "Moss 模擬": "Moss simulation",
  "鏈上": "On-chain",
  "靜態資料": "Static data",
  "樣例數據": "Fixture data",
  "樣例演示數據": "Fixture demo data",
  "未開源驗證": "Source not verified",
  "無法核對公開源碼與實際執行邏輯。": "Public source code cannot be verified against the executed logic.",
  "無公開審計": "No public audit",
  "未找到第三方審計記錄。": "No third-party audit record was found.",
  "升級無時間鎖": "Upgrade has no timelock",
  "模擬後邏輯仍可能被即時更改。": "Contract logic could still be changed immediately after simulation.",
  "交易規模相對流動性過大": "Trade is too large relative to liquidity",
  "交易規模佔比偏高": "Trade represents a high share of liquidity",
  "價格影響偏高": "High price impact",
  "價格影響中等": "Moderate price impact",
  "滑點容忍度過寬": "Slippage tolerance is too wide",
  "預期滑點超出容忍度": "Expected slippage exceeds tolerance",
  "餘額不足": "Insufficient balance",
  "已存在無限授權": "Unlimited approval already exists",
  "需要新增授權": "New approval required",
  "未收錄該協議。": "This protocol is not supported.",
  "該協議不支援此操作。": "This protocol does not support this action.",
  "此路徑的價格影響高於同意圖下的最佳候選路徑。": "This route has higher price impact than the best candidate for the same intent.",
  "預期滑點": "Expected slippage",
  "價格影響": "Price impact",
  "已驗證合約": "Verified contract",
  "已驗證": "Verified",
  "未驗證": "Unverified",
  "必需": "Required",
  "建議": "Recommended",
  "協議事實註冊表": "Protocol facts registry",
  "Moss 告警": "Moss warnings",
  "必須為 0": "Must be 0",
  "需審查": "Review required",
  "模擬執行": "Simulation execution",
  "必須通過": "Must pass",
  "Moss 模擬回執": "Moss simulation receipt",
  "證據完整性": "Evidence completeness",
  "覆蓋率低": "Low coverage",
  "不允許未知證據": "Unknown evidence not allowed",
  "需審查未知證據": "Unknown evidence requires review",
  "候選證據覆蓋": "Candidate evidence coverage",
};

export function localizeText(text: string | null | undefined, language: Language) {
  if (!text || language === "zh-CN") return text ?? "";
  if (EXACT_TEXT[text]) return EXACT_TEXT[text];

  return text
    .replace(/^模擬(通過|失敗)。風險發現按維度展示；這不是投資建議。$/, (_, result) =>
      `Simulation ${result === "通過" ? "passed" : "failed"}. Findings are shown by dimension; this is not investment advice.`,
    )
    .replace(/^模擬結果與報價偏離 (.+)。$/, "Simulation output differs from the quote by $1.")
    .replace(/^佔池內流動性 (.+)。$/, "Represents $1 of pool liquidity.")
    .replace(/^錢包 (.+) 餘額 (.+) 低於交易金額 (.+)，交易將回滾。$/, "Wallet $1 balance of $2 is below the $3 trade amount; the transaction will revert.")
    .replace(/^錢包對該合約的 (.+) 授權為無限額度。$/, "The wallet has granted this contract an unlimited $1 allowance.")
    .replace(/^當前 (.+) 授權不足本次交易。$/, "The current $1 allowance is insufficient for this trade.")
    .replace(/^(.+)：(.+)$/, "$1: $2")
    .replace(/條告警/g, " warnings")
    .replace(/未知版本/g, "unknown version");
}
