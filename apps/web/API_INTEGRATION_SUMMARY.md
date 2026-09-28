# 前端 API 接口整合總結

## 現狀

前端代碼（`apps/web/src/lib/analyze/service.ts`）已經實現了以下 provider-neutral public API：

### ✅ 已實現的 API

1. **`POST /api/quote`** - 獲取報價
   - `fetchQuote()` 函數
   - 支援 exact-input 報價
   - 返回 `QuoteState` (available/unavailable/error)

2. **`POST /api/check`** - 執行風險檢查
   - `checkSwap()` 函數
   - 支援完整的 CheckSwapInput
   - 支援 Re-run（通過 `parentRunId`）
   - 返回完整的 `CheckSwapResult`

3. **`GET /api/runs/:runId`** - 恢復已完成的檢查
   - `loadRun()` 函數
   - 支援頁面刷新後恢復狀態
   - 處理 started/completed/failed 狀態

4. **`GET /api/replay/:id`** - 錄製的 Replay 數據
   - `loadReplay()` 函數
   - 支援 `mon-to-usdc` 和 `usdc-to-mon` fixtures

### 🔧 需要擴展的功能

為了支援 **Arbitrum** 和最新的 **provider-neutral composition**，需要以下擴展：

#### 1. 多鏈支持

**新增的 helper 文件:** `apps/web/src/lib/analyze/api-helpers.ts`

提供了以下功能：
- `getChainIdForProtocol()` - 根據 protocol 獲取 chainId
- `getNativeTokenSymbol()` - 獲取原生代幣符號（ETH/MON）
- `getUsdcAddress()` - 獲取 USDC 地址
- `symbolToAsset()` - 轉換 symbol 為 API asset reference
- `assetToSymbol()` - 轉換 asset reference 為 symbol
- `getTokenDecimals()` - 獲取代幣小數位數

**支援的鏈：**
- Monad mainnet (chainId: 143) - 用於 kuru, pancake
- Arbitrum Sepolia (chainId: 421614) - 用於 camelot-v3

#### 2. Expectation Baseline 支持

在 `CheckSwapInput` type 中已添加：
```typescript
expectationBaseline?: {
  quote: QuotePreview;
};
```

這允許前端傳遞用戶選擇的報價給後端，用於 Quote Fidelity 比較。

#### 3. 需要更新 `service.ts` 的函數

**`body()` 函數** - 需要更新為：
```typescript
function body(input: CheckSwapInput) {
  const chainId = input.chainId ?? getChainIdForProtocol(input.protocol);
  
  return {
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    chainId,
    protocol: input.protocol,
    sender: input.sender ?? DEFAULT_SENDER,
    tokenIn: symbolToAsset(input.tokenIn, chainId),
    tokenOut: symbolToAsset(input.tokenOut, chainId),
    amountIn: input.amountIn,
    economicBoundary: input.minimumReceived
      ? {
          availability: "available",
          minimumReceived: input.minimumReceived,
          source: "user_declared",
        }
      : { availability: "unavailable", source: "unavailable" },
    ...(input.expectationBaseline
      ? {
          expectationBaseline: {
            chainId,
            protocol: input.protocol,
            tokenIn: symbolToAsset(input.tokenIn, chainId),
            tokenOut: symbolToAsset(input.tokenOut, chainId),
            amountIn: input.amountIn,
            quote: input.expectationBaseline.quote,
          },
        }
      : {}),
  };
}
```

**`quoteBody()` 函數** - 需要更新為：
```typescript
function quoteBody(input: QuoteSwapInput) {
  const chainId = input.chainId ?? getChainIdForProtocol(input.protocol);
  
  return {
    chainId,
    protocol: input.protocol,
    sender: input.sender ?? DEFAULT_SENDER,
    tokenIn: symbolToAsset(input.tokenIn, chainId),
    tokenOut: symbolToAsset(input.tokenOut, chainId),
    amountIn: input.amountIn,
  };
}
```

**`symbol()` 函數** - 需要更新為使用新的 `assetToSymbol()`：
```typescript
function symbol(value: unknown, chainId: number): string {
  return assetToSymbol(value, chainId);
}
```

**`asset()` 函數** - 需要更新為使用新的 `symbolToAsset()`：
```typescript
function asset(value: string, chainId: number) {
  return symbolToAsset(value, chainId);
}
```

**`mapRun()` 函數** - 需要讀取 `intent.chainId` 並傳遞給相關函數

#### 4. P0 Projection 支持

後端的 Arbitrum composition 會在 `RunResult` 中添加可選的 `p0` 字段：

```typescript
p0?: {
  expectationBaseline?: {
    // 用戶選擇的報價
  };
  quoteFidelity?: {
    status: "ALIGNED" | "DEGRADED" | "UNKNOWN";
    observation?: string;
    // ... 更多字段
  };
  cause?: {
    // 原因分析
  };
  // ... 更多 P0 診斷信息
};
```

前端可以選擇性地使用這些字段來提供更豐富的 UI 體驗。

## 實施步驟

1. ✅ 創建 `api-helpers.ts` - 已完成
2. ✅ 更新 `types.ts` 添加 `chainId` 和 `expectationBaseline` - 已完成
3. ⏳ 更新 `service.ts` 中的函數使用新的 helpers
4. ⏳ 在前端 UI 中添加 Arbitrum/Camelot 選項
5. ⏳ 實現 Quote → Check 流程中的 expectationBaseline 傳遞

## 使用示例

### 獲取 Arbitrum 報價

```typescript
const quoteState = await fetchQuote({
  chainId: 421614, // 或省略，會自動從 protocol 推斷
  protocol: "camelot-v3",
  tokenIn: "ETH",
  tokenOut: "USDC",
  amountIn: "0.001",
});

if (quoteState.status === "available") {
  console.log("Quote:", quoteState.quote.estimatedAmountOut);
}
```

### 帶 Expectation Baseline 的檢查

```typescript
// 1. 先獲取報價
const quoteState = await fetchQuote({
  protocol: "camelot-v3",
  tokenIn: "ETH",
  tokenOut: "USDC",
  amountIn: "0.001",
});

// 2. 用戶選擇這個報價後，執行檢查
if (quoteState.status === "available") {
  const result = await checkSwap({
    protocol: "camelot-v3",
    tokenIn: "ETH",
    tokenOut: "USDC",
    amountIn: "0.001",
    expectationBaseline: {
      quote: quoteState.quote,
    },
  });
  
  // 3. 後端會比較這個 baseline 和當前模擬結果
  if (result.p0?.quoteFidelity?.status === "DEGRADED") {
    console.warn("Quote 已變差:", result.p0.quoteFidelity.observation);
  }
}
```

### Re-run 調整金額

```typescript
const adjustedResult = await checkSwap({
  parentRunId: originalResult.runId,
  protocol: "camelot-v3",
  tokenIn: "ETH",
  tokenOut: "USDC",
  amountIn: "0.0005", // 調整後的金額
  minimumReceived: "1.0", // 保持 economicBoundary 不變
});

if (adjustedResult.diff) {
  console.log("Changes:", adjustedResult.diff);
}
```

## 錯誤處理

所有 API 都返回結構化的錯誤：

```typescript
if (result.apiFailure) {
  const { code, retryable, message } = result.apiFailure;
  
  if (code === "UNSUPPORTED") {
    // Live Check 不可用（未配置 Moss/Provider）
  } else if (retryable) {
    // 可重試的錯誤（RPC_UNAVAILABLE, TIMEOUT 等）
  } else {
    // 永久性錯誤（INVALID_REQUEST, NORMALIZATION_FAILED 等）
  }
}
```

## 注意事項

1. **不要將 live UNSUPPORTED 自動轉為 Recorded Replay**
2. **使用 `error.code` 判斷，不要依賴 `message`**
3. **明確標示 Replay 模式** (`replayMode: true`)
4. **Re-run 只能改變一個參數**
5. **Expectation Baseline 的 runtime identity 必須匹配當前 Evidence**

## 下一步

Antony 可以開始接入這些 API，不需要等待 Tenderly provider。現有的 API 是 provider-neutral 的，支援任何配置的 provider（Native RPC, Tenderly, Moss 等）。
