# Fix ADJUST Explanation and Minimum Boundary Semantics

## Summary

This PR improves the ADJUST review flow and ensures quote data cannot silently become a user-declared minimum boundary.

## Changes

### ADJUST UI

- Adds reason-specific ADJUST messaging for:
  - Quoted output below the user's minimum
  - Input amount exceeding the available balance
- Shows a `View options` action for every ADJUST result.
- Displays actionable option cards with change, predicted outcome, and trade-off details.
- Keeps option cards clickable and routes the user back to the swap input screen.
- Adds cursor-following green hover glow and darker `risk-low` styling for option borders and verified badges.
- Keeps the result/options timeline available for ADJUST results.
- Adds a collapsible account state snapshot.

### Minimum Boundary Fix

- Removed the quote/slippage effect that wrote a calculated reference minimum into `form.minimumReceived`.
- The quote-derived minimum remains display-only as `Reference minimum`.
- `minimumReceived` is submitted only when the user explicitly enters a value.
- An untouched field remains absent from the request and cannot be classified as `user_declared`.

### Live Request Path

- Verified the current branch has no hard-coded Arbitrum sample shortcut or threshold return in `WalletApp.tsx`.
- The active submit path calls the backend check request directly.
- Existing active-path coverage confirms fixture-only replay controls are not exposed.

## Regression Coverage

Updated `apps/web/src/components/wallet/WalletApp.test.tsx` to assert that after a backend quote is available and the user has not entered a minimum boundary:

- The live `/api/check` request is sent.
- The submitted `amountIn` is preserved.
- `minimumReceived` is omitted.
- No quote-derived `expectationBaseline` is submitted after the input changes.

Validation:

- `pnpm --filter @parallax/web exec vitest run src/components/wallet/WalletApp.test.tsx`
- Result: 5 tests passed.
- Biome lint passed for `WalletSwap.tsx` and `WalletApp.test.tsx`.

## Files Changed

- `apps/web/src/components/wallet/WalletSwap.tsx`
- `apps/web/src/components/wallet/WalletApp.test.tsx`

## Review Notes

The current branch does not contain the previously described `arbitrumSampleBalanceInsufficient` threshold shortcut in `WalletApp.tsx`; no removal was necessary in this checkout. The active-path test remains in place to prevent fixture-only controls from reappearing in the live wallet flow.
