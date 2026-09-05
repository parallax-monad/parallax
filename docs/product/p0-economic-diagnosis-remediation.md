# P0 Economic Diagnosis & Remediation Matrix

> **Status:** Draft v0.2 — Product Owner proposal  
> **Date:** 2026-09-05  
> **Owner:** Product  
> **Scope:** P0 Product semantics for economic diagnosis, quantified remediation, and re-verification  
> **Non-authority notice:** This document defines Product intent, user semantics, Product acceptance rules, and P0 scope. It does **not** freeze the final Shared Contract, Provider field vocabulary, Backend wire shape, protocol-specific implementation, or universal market thresholds.

---

## 1. Product thesis

Parallax is a provider-agnostic **pre-execution diagnosis, remediation, and re-verification layer** for onchain actions.

The P0 Product problem is not:

> “Which DEX has the best price?”

It is:

> **“I am about to sign this transaction. Does the current execution still reproduce the outcome I just saw or expected, and if not, what exactly changed and what can I change?”**

Parallax should help the user make a decision without requiring the user to already understand execution microstructure, liquidity, price impact, routing, gas, or simulation internals.

The Product loop is:

```text
User sees / selects an execution outcome
        ↓
Capture the applicable expectation / economic baseline
        ↓
Build the exact unsigned transaction
        ↓
Obtain fresh execution Evidence / simulation
        ↓
Evaluate execution viability
        ↓
Compare current execution against the applicable baseline
        ↓
Identify the Observation / gap
        ↓
Explain the primary Cause and contributing factors
        ↓
Identify controllable variables
        ↓
Generate multiple counterfactual remediation options
        ↓
Quantify the predicted outcome of each option
        ↓
Re-quote / re-simulate each candidate
        ↓
Publish only verified improvements as recommendable Actions
        ↓
User chooses the option that best matches their real intent
        ↓
Re-check immediately before signing if state has moved
```

Parallax diagnoses, quantifies, and verifies.

It does **not** automatically infer the user's final financial objective, choose the transaction on behalf of the user, or execute the transaction.

---

## 2. P0 user and long-term Product surface

### 2.1 P0 user

The P0 working user is a **light-to-intermediate DeFi user** who:

- can perform a basic swap;
- can connect a wallet and understand that a transaction needs to be signed;
- may not understand price impact, liquidity depth, effective rate, gas economics, route quality, spread, fee decomposition, or simulation internals;
- may not know which transaction variable to change after a failed or unexpectedly poor execution;
- is unlikely to configure a complex execution-policy builder before every swap.

Therefore:

> **Beginner-friendly presentation is a frontend responsibility; Product depth must remain available in the Core.**

The beginner should not need to understand or preconfigure complex conditions before Parallax can provide value.

---

### 2.2 Long-term users

The same Product semantics should remain usable by:

- experienced DeFi users;
- wallets;
- SDK consumers;
- developer kits;
- agents;
- MCP integrations;
- automated policy systems.

This means the Core must support deeper machine-readable structure even when the default UI stays simple.

The intended design principle is:

```text
Simple at the surface.
Deep in the Core.
Consistent across human and machine consumers.
```

---

## 3. What Parallax is not

P0 is not:

- a best-price aggregator;
- a whole-market router;
- a DEX execution engine;
- a wallet;
- a strategy optimizer;
- an autonomous trading agent;
- an intent-guessing orchestration layer.

Parallax may compare bounded, actually evaluated alternatives, but it should not become:

```text
Best Price
Balanced
Fast
```

or similar opaque optimization profiles that silently infer the user's objective.

Those profiles move the Product toward orchestration.

Parallax instead exposes:

```text
what changed
why it changed
what can be changed
what each change is expected to do
whether that change was re-verified
```

The user retains the final decision.

---

# 4. Core Product semantics

Parallax must keep the following concepts separate.

---

## 4.1 Transaction Protection

Transaction Protection is the protocol / transaction-level condition that determines whether the prepared transaction may still execute.

Examples:

- `amountOutMinimum`;
- slippage protection;
- protocol-native execution guards.

It answers:

> **“Can this transaction execute under its current protection?”**

It does **not** answer:

> “Is this still the economic result the user expected?”

Example:

```text
Selected quote:
4.812 ETH

Transaction minimum:
4.600 ETH

Current simulation:
4.746 ETH
```

The transaction may still execute because:

```text
4.746 > 4.600
```

but it no longer reproduces the selected quote.

Therefore:

```text
Transaction Protection
≠
Economic expectation
```

---

## 4.2 Expectation Baseline

**Expectation Baseline** represents the execution outcome the user saw and chose to continue with before signing.

Typical evidence may conceptually include:

```text
amountIn
quotedAmountOut
quotedEffectiveRate
quote block
quote timestamp
protocol / route context
transaction protection at that quote
quote provenance / identity
```

It answers:

> **“Does current execution still reproduce the result the user just selected?”**

Important:

```text
Expectation Baseline
≠
User Economic Constraint
```

If the user selected:

```text
10,000 USDC → 4.812 ETH
```

and the current simulation returns:

```text
10,000 USDC → 4.746 ETH
```

Parallax may state:

> “The current simulation is 1.37% below the quote you selected.”

Parallax must not infer:

> “A 1.37% deviation violates your personal tolerance.”

unless an explicit applicable economic limit exists.

### Current implementation note

The repository currently has a pre-check quote and a separate Check Intent, but the selected quote is not yet a canonical Check baseline in the Shared Contract.

Therefore, **Expectation Baseline is a proposed Product semantic**.

Contract Owner and Backend Owner should determine the final minimal representation and handoff.

Product owns the semantic requirement, not the final field names.

---

## 4.3 User Economic Constraints

User Economic Constraints are explicit economic requirements supplied by a user, wallet, application, agent, or developer.

Target examples include:

```text
maxPriceImpact
minEffectiveRate
maxTotalCost
maxGas
minimumReceived
```

They answer:

> **“Even if the transaction is executable and quote-consistent, does it satisfy the caller's explicit economic requirements?”**

For beginner P0, these should be optional.

For advanced / SDK / agent use cases, they can become explicit, machine-readable policy inputs.

---

## 4.4 Evidence Quality

Evidence Quality is an orthogonal axis.

Examples:

```text
STALE_EVIDENCE
INCOMPLETE_EVIDENCE
PROVIDER_UNAVAILABLE
PROVIDER_FAILED
SIMULATION_UNVERIFIED
```

These mean:

> **“Parallax cannot fully verify the transaction.”**

They do **not** mean:

> “The transaction is economically bad.”

If required Evidence is stale, unsupported, unavailable, or incomplete, Parallax must fail closed.

`UNKNOWN` is never a pass.

---

# 5. Product output model

The P0 Product should produce four conceptually separate outputs.

---

## 5.1 Execution Viability

Question:

> **Can the exact unsigned transaction execute?**

Possible outcomes:

```text
likely executable
verified revert
no route
execution unknown
```

Primary inputs may include:

- simulation status;
- protocol execution conditions;
- transaction protection;
- route existence;
- allowance / balance / revert evidence where applicable.

---

## 5.2 Quote Fidelity

Question:

> **Does current execution still reproduce what the user just selected?**

Compare:

```text
Expectation Baseline
vs
Current Simulation / Fresh Evidence
```

Example:

```text
Selected quote:     4.812 ETH
Current simulation: 4.746 ETH
Difference:         -0.066 ETH
Relative delta:     -1.37%
```

Beginner copy:

> **Your quote has changed.**  
> You selected 4.812 ETH, but the current simulation estimates 4.746 ETH.

Quote Fidelity is descriptive unless an explicit acceptable deviation exists.

---

## 5.3 Execution Quality

Question:

> **What is driving the execution economics?**

Potential dimensions include:

- reference price;
- quoted execution price;
- effective rate;
- price impact;
- usable liquidity;
- protocol / LP fee;
- commission / explicit fee;
- gas;
- route economics;
- state movement;
- all-in execution cost.

Without an explicit constraint, Product may expose these as diagnostic metrics rather than automatically classifying them as unacceptable.

---

## 5.4 Evidence Confidence / Scope

Question:

> **How much of the above can Parallax substantiate?**

Potential states include:

- fresh;
- stale;
- complete;
- incomplete;
- provider-supported;
- provider-unavailable;
- simulation-verified;
- simulation-unverified.

This must remain visibly distinct from economic quality.

---

# 6. Execution economics decomposition

Parallax should explain poor outcomes through an execution-economics decomposition rather than a generic “bad price” label.

A general abstraction is:

```text
Reference / market state
        ↓
Quoted execution result
        ↓
Usable liquidity
        ↓
Price impact
        ↓
Protocol / LP fee
        ↓
Commission / explicit fee
        ↓
Gas / execution cost
        ↓
Route / path effects
        ↓
State movement between quote and execution
        ↓
Effective all-in execution result
```

This decomposition should remain protocol-agnostic.

---

## 6.1 Bid-ask spread is not universal

For an order book / CLOB, the following may be natural:

```text
best bid
best ask
bid-ask spread
order-book depth
```

For an AMM / concentrated-liquidity pool, forcing `bidAskSpread` as a universal field may be misleading.

Therefore Product should prefer generic concepts such as:

```text
reference price
quoted execution price
effective rate
price impact
liquidity
explicit fees
gas
all-in execution cost
```

and expose market-structure-specific fields only when relevant to the Protocol / Provider.

---

# 7. Observation → Cause → Remediation

P0 must distinguish the visible **Observation** from the underlying **Cause**.

---

## 7.1 Observation

What changed or failed?

Examples:

```text
QUOTE_OUTPUT_DEGRADED
EFFECTIVE_RATE_DEGRADED
EXECUTION_COST_INCREASED
EXECUTION_WILL_REVERT
NO_ROUTE_AVAILABLE
PRICE_IMPACT_OBSERVED
EXPLICIT_CONSTRAINT_NOT_MET
EVIDENCE_STALE
EVIDENCE_INCOMPLETE
```

An Observation describes what the system sees.

---

## 7.2 Cause

Why did the Observation occur?

Possible Causes include:

```text
STATE_MOVEMENT
TRADE_SIZE_RELATIVE_TO_LIQUIDITY
INSUFFICIENT_LIQUIDITY
ROUTE_INEFFICIENCY
HIGH_EXECUTION_COST
GAS_SPIKE
FEE_STRUCTURE
NO_ROUTE
ALLOWANCE_OR_BALANCE_ISSUE
VERIFIED_REVERT_REASON
PROVIDER_OR_EVIDENCE_GAP
```

A Product Cause should explain the mechanism rather than restate the symptom.

Bad:

```text
Observation:
Output is worse.

Cause:
OUTPUT_DEGRADED.
```

Better:

```text
Observation:
Current simulated output is 1.37% below the selected quote.

Primary Cause:
Pool state moved after the quote.

Contributing factor:
The current trade size now creates greater price impact.
```

---

## 7.3 Constraint violation is not necessarily the Cause

Example:

```text
MIN_EFFECTIVE_RATE_NOT_MET
MAX_PRICE_IMPACT_EXCEEDED
MAX_TOTAL_COST_EXCEEDED
MAX_GAS_EXCEEDED
```

These are better modeled as:

```text
constraintViolation
```

The underlying Cause may be:

```text
STATE_MOVEMENT
TRADE_SIZE_RELATIVE_TO_LIQUIDITY
HIGH_EXECUTION_COST
ROUTE_INEFFICIENCY
```

Parallax should explain the underlying Cause where Evidence supports it.

---

# 8. Do not guess user intent

One input can correspond to multiple real user goals.

Example:

```text
User inputs:
10,000 USDC
```

Possible user objectives include:

```text
A. I need to swap all 10,000 USDC.
B. I care most about the exchange rate I just saw.
C. I need to receive approximately 4.812 ETH.
D. I am not urgent and can wait for better market conditions.
E. I am willing to use another verified path if it improves the result.
```

Parallax should not silently choose one of these objectives.

Instead:

> **Generate several understandable counterfactual options and let the user choose which trade-off matches their real intent.**

This is a core P0 Product principle.

---

# 9. Multi-objective remediation

The target remediation model is not:

```text
Problem
→ one “best” Action
```

It is:

```text
Observed gap
        ↓
Primary Cause
        ↓
Controllable variables
        ↓
Several possible objectives
        ↓
Counterfactual candidate for each objective
        ↓
Predicted outcome
        ↓
Fresh quote / simulation
        ↓
Verified option set
        ↓
User chooses
```

---

## 9.1 Example

Current state:

```text
Input:
10,000 USDC

Selected quote:
4.812 ETH

Current simulation:
4.746 ETH
```

Parallax may produce:

| Possible user objective | Candidate adjustment | Verified / predicted result | Explanation |
| --- | --- | --- | --- |
| **Keep spending 10,000 USDC** | Keep amount and accept fresh quote | ~4.751 ETH | Current market state no longer reproduces the selected quote |
| **Preserve a similar effective rate** | Reduce amount to ~7,200 USDC | lower price impact / rate closer to baseline | Smaller trade consumes less liquidity |
| **Still receive ~4.812 ETH** | Increase amount to ~10,140 USDC | ~4.812 ETH | More input is now required to reach the same output |
| **Wait for the previous economics** | Wait until quote condition reaches ≥ X | re-check required | Current state cannot reproduce the selected economics |
| **Use a bounded verified alternative** | Candidate path B | ~4.785 ETH | This tested path currently produces a better verified result |

Parallax does not need to ask the beginner to formally specify the objective before producing this option set.

The user can choose the option that best matches the real intent.

---

# 10. Quantification requirement

A Relevant Action must not be only a category.

Bad:

```text
Reduce amount.
Try another route.
Wait.
Increase amount.
```

Preferred:

```text
Reduce amount:
10,000 USDC → approximately 7,200 USDC

Predicted effect:
price impact 1.08% → 0.64%

Verification:
fresh quote/simulation passed
```

Every recommendable Action should include, where technically available:

```text
variable changed
before value
after value / trigger condition
predicted outcome
trade-off
Evidence support
verification status
```

---

# 11. Bidirectional quantitative solving

P0 remediation should support both directions where Protocol / Provider capabilities allow it.

---

## 11.1 Solve output from input

Question:

> **“If I spend X, what result can I currently receive?”**

Example:

```text
amountIn = 10,000 USDC
→
current simulated amountOut = 4.746 ETH
```

---

## 11.2 Solve input required for target output

Question:

> **“If I still need Y output, how much input is required now?”**

Example:

```text
target amountOut = 4.812 ETH
```

Parallax may search:

```text
10,000 USDC → 4.746 ETH
10,100 USDC → 4.793 ETH
10,140 USDC → 4.812 ETH
```

Product output:

> To receive approximately **4.812 ETH** under the current state, the trade requires approximately **10,140 USDC**.

Important:

The system must re-quote / re-simulate each candidate.

It must not simply scale linearly because price impact, fees, gas, and liquidity are non-linear.

---

# 12. Constraint solver requirement

When an explicit target exists, Parallax should solve for a concrete candidate rather than use arbitrary heuristics.

Example:

```text
amountIn = 10,000 USDC
observed price impact = 1.08%
explicit maxPriceImpact = 0.60%
```

Do not use:

```text
reduce amount by 20%
```

Instead:

```text
10,000 → 1.08%
8,000  → 0.81%
7,000  → 0.63%
6,700  → 0.58%
```

Product output:

> Reduce the trade to approximately **6,700 USDC or less** to satisfy the current 0.60% price-impact limit.

Backend may use:

- binary search;
- bounded iterative search;
- exact-output quoting;
- another deterministic strategy.

Product requires:

> **Evidence-driven solving, not arbitrary percentage adjustment.**

---

# 13. Conditional remediation

Some useful Actions are not immediate transaction edits.

They are **conditions under which the transaction should be checked again**.

Example objective:

```text
Spend:
10,000 USDC

Desired output:
approximately 4.812 ETH
```

Current conditions cannot reproduce the target.

Parallax may derive a condition such as:

```text
Re-check when quoted output for 10,000 USDC reaches approximately ≥ X
```

or:

```text
Re-check when the relevant effective rate reaches ≥ Y
```

Beginner copy:

> If your goal is to receive around 4.812 ETH for 10,000 USDC, wait for the quote to recover to approximately **X or better**, then run Parallax again before signing.

This is not a guarantee of final execution.

The Product flow is:

```text
condition becomes true
→ fresh quote
→ fresh simulation
→ new decision
```

Conditional remediation is especially compatible with future agent / MCP workflows.

Example:

```text
when quoteCondition >= X:
    run Parallax check again
```

Parallax remains a verification layer, not an autonomous trading bot.

---

# 14. Re-verification is state-bound

A successful simulation is not timeless.

Example:

```text
Candidate verified at block N
        ↓
user waits
        ↓
new trades modify pool state
        ↓
current state = block N+k
```

The previous result may no longer hold.

Therefore:

> **A verified remediation is valid only relative to the state in which it was verified.**

A verified candidate should conceptually carry:

```text
verifiedAtBlock
verifiedAtTime
evidence freshness
provider / provenance
applicable scope
```

Beginner frontend does not need to show all of these by default.

It should simply communicate:

> **Re-check immediately before signing if conditions changed.**

If the state has materially moved:

> **Conditions changed again. Re-check before signing.**

This is an essential P0 Product rule.

---

# 15. Remediation categories

P0 may support the following candidate categories where Evidence and capability exist.

---

## 15.1 Preserve input amount

User objective:

> “I need to spend this amount.”

Example:

```text
Keep:
10,000 USDC

Result:
fresh quote / simulation returns current output
```

Product explains the new achievable result rather than pretending the old quote still holds.

---

## 15.2 Preserve effective rate / improve execution quality

Possible controllable variables:

- lower `amountIn`;
- bounded alternative path;
- different liquidity source where in scope;
- wait / re-check under better state.

Candidate must be re-verified.

---

## 15.3 Preserve target output

Possible Action:

```text
increase amountIn
```

Example:

```text
10,000 USDC → 4.746 ETH
10,140 USDC → 4.812 ETH
```

Product must also show the cost / trade-off.

---

## 15.4 Preserve economic constraint

Example:

```text
maxPriceImpact = 0.60%
```

Action:

```text
find maximum amountIn satisfying 0.60%
```

---

## 15.5 Wait for a condition

Example:

```text
requote when effective rate ≥ Y
```

Requires a fresh check when the condition is reached.

---

## 15.6 Verified bounded alternative

Compare only an explicitly evaluated candidate.

Example:

```text
Current path A:
4.746 ETH

Candidate path B:
4.785 ETH
```

Only surface B as an improvement if it is actually quoted / simulated and its effect is supported.

---

# 16. Transaction protection must not be disguised as economic remediation

Increasing slippage tolerance or lowering protocol protection does not improve execution economics.

Example:

```text
slippage:
0.5% → 1.5%
```

may make execution more likely, but allows a worse result.

Therefore:

```text
transaction protection change
≠
economic improvement
```

P0 must not recommend:

> “Increase slippage”

as a way to manufacture `PROCEED`.

If a protection change is surfaced at all, it must be framed according to what it actually changes.

---

# 17. Split-order policy

Parallax must not assume splitting an order improves execution.

Example:

```text
10,000 USDC
→
5,000 + 5,000
```

on the same AMM and same immediate state does not automatically reduce total price impact and may add:

- additional gas;
- additional fees;
- additional state exposure.

Split execution may only be recommended when Evidence verifies improvement through:

- different timing;
- different route;
- different liquidity source;
- another materially different execution context.

No heuristic-only split recommendation should be publishable.

---

# 18. Bounded alternatives, not whole-market aggregation

P0 explicitly avoids whole-market route optimization.

Allowed:

```text
current path A
vs
candidate path B

B was actually quoted / simulated
→ improvement verified
```

Not P0:

```text
scan every DEX
rank all possible routes
automatically select optimal execution
```

Product principle:

> **Verified alternative, not universal best route.**

---

# 19. When no explicit threshold exists

Parallax must not invent a personal economic preference.

If the user has no explicit `maxPriceImpact`, Parallax may still expose:

```text
Estimated price impact:
1.08%

Verified alternative:
7,200 USDC → 0.64%
```

Allowed:

> Estimated price impact is 1.08%. Reducing the amount to approximately 7,200 USDC lowers the current estimate to 0.64%.

Not allowed:

> Your price impact is too high because Parallax assumes 0.60% is acceptable.

unless a transparent Product policy exists and the source of that policy is disclosed.

---

# 20. Selected quote is expectation evidence, not proof of quality

A selected quote represents:

```text
what the user saw and chose to continue with
```

It does not prove:

```text
that the quote itself was economically good
```

Legal state:

```text
Quote Fidelity:
PASS

Execution Quality:
High observed price impact
```

Example:

> The current simulation still matches the selected quote, but the trade currently has an estimated 1.08% price impact.

Parallax should preserve this distinction.

---

# 21. P0 Economic Diagnosis & Remediation Matrix v0.2

---

## 21.1 Selected quote no longer reproduced

| Dimension | Product definition |
| --- | --- |
| Observation | Current simulated output / effective rate differs from the selected quote |
| Applicable baseline | Expectation Baseline |
| Possible Causes | `STATE_MOVEMENT`, greater price impact, route state change, fee/gas change, or unresolved Cause |
| Evidence required | selected quote provenance + comparable fresh quote / simulation |
| Controllable variables | `amountIn`, target `amountOut`, bounded path, timing / requote |
| Candidate A | preserve input and show current achievable output |
| Candidate B | reduce input to move execution rate closer to prior economics |
| Candidate C | increase input to preserve target output |
| Candidate D | derive a re-check condition for the desired economics |
| Candidate E | evaluate a bounded alternative path |
| Quantification | calculate before / after values and predicted outcome |
| Re-verification | every recommendable candidate must be freshly quoted / simulated |
| Beginner copy | “Your quote has changed. Here are the different ways you can respond.” |
| API / advanced | baseline + observation delta + Cause + candidate Actions + predicted outcomes + verification |

---

## 21.2 `HIGH_PRICE_IMPACT`

| Dimension | Product definition |
| --- | --- |
| Observation | Trade execution moves materially away from a reference or violates an explicit impact limit |
| Applicable baseline | explicit economic constraint where available; otherwise diagnostic-only |
| Primary Cause | `TRADE_SIZE_RELATIVE_TO_LIQUIDITY` |
| Contributing factors | concentrated liquidity, current state, route/path characteristics |
| Evidence required | approved price-impact derivation or sufficient quote / liquidity Evidence |
| Controllable variables | `amountIn`, bounded path, liquidity source, timing |
| Candidate remediation | reduce amount; verified alternative; conditional requote |
| Quantification | search for amount/path satisfying target or producing verified improvement |
| Re-verification | fresh quote / simulation |
| Beginner copy | “Your trade size is moving the price against you.” |
| Do not recommend | arbitrary reduction; higher slippage; unverified split |
| Current readiness | Planned until real Evidence semantics are confirmed |

---

## 21.3 `INSUFFICIENT_LIQUIDITY`

| Dimension | Product definition |
| --- | --- |
| Observation | Current liquidity cannot support the intended execution |
| Applicable baseline | execution viability / economic target |
| Primary Cause | `INSUFFICIENT_LIQUIDITY` |
| Evidence required | Protocol / Provider Evidence of unusable liquidity or failed route |
| Controllable variables | amount, bounded path, supported protocol |
| Candidate remediation | reduce amount; verified alternative path; conditional re-check |
| Quantification | find maximum currently supportable amount where feasible |
| Re-verification | candidate produces complete route / execution Evidence |
| Beginner copy | “There is not enough usable liquidity for this trade in the current path.” |

---

## 21.4 `NO_ROUTE`

| Dimension | Product definition |
| --- | --- |
| Observation | No usable execution route exists |
| Applicable baseline | execution viability |
| Primary Cause | `NO_ROUTE` |
| Evidence required | Protocol / Provider route evidence |
| Candidate remediation | lower amount where route creation is size-dependent; bounded alternative path / protocol where in scope |
| Re-verification | candidate must return a valid route and executable unsigned transaction |
| Beginner copy | “This trade cannot be routed in the current path.” |
| Do not recommend | pretending an unavailable route can be fixed through slippage |

---

## 21.5 Explicit minimum output not met

| Dimension | Product definition |
| --- | --- |
| Observation | Simulated output is below an explicit accepted minimum |
| Applicable baseline | User Economic Constraint |
| Constraint violation | minimum output / boundary not met |
| Required next step | diagnose the underlying Cause |
| Candidate remediation | change transaction variables that improve execution while preserving the original boundary |
| Quantification | solve for amount/path/state satisfying the same boundary |
| Re-verification | verification child retains the original boundary |
| Beginner copy | “The current execution does not meet the minimum output you provided.” |
| Do not recommend | lower the boundary simply to manufacture `PROCEED` |

---

## 21.6 `MIN_EFFECTIVE_RATE_NOT_MET`

| Dimension | Product definition |
| --- | --- |
| Observation | Current effective rate is below an explicit caller limit |
| Type | Constraint violation, not root Cause |
| Possible Causes | price impact, state movement, fees, route economics, execution cost |
| Candidate remediation | reduce amount; increase target input where preserving output; bounded path; wait condition |
| Quantification | solve for candidate satisfying original rate limit |
| Re-verification | fresh quote / simulation |
| Current readiness | Planned / unresolved until canonical effective-rate semantics are approved |

---

## 21.7 `MAX_TOTAL_COST_EXCEEDED`

| Dimension | Product definition |
| --- | --- |
| Observation | All-in execution cost exceeds explicit caller limit |
| Type | Constraint violation |
| Possible Causes | gas, protocol fees, commissions, price impact, route effects |
| Candidate remediation | smaller amount only where total economics improve; bounded alternative; wait for lower cost state |
| Quantification | compare total verified cost across bounded candidates |
| Re-verification | fresh cost Evidence |
| Current readiness | Planned / unresolved pending cost decomposition semantics |

---

## 21.8 `MAX_GAS_EXCEEDED`

| Dimension | Product definition |
| --- | --- |
| Observation | Expected gas cost exceeds explicit caller limit |
| Type | Constraint violation |
| Possible Causes | gas spike, route complexity, protocol call structure |
| Candidate remediation | bounded alternative execution path; conditional re-check at lower gas conditions |
| Quantification | estimate / simulate gas for candidate |
| Re-verification | fresh gas Evidence |
| Current readiness | Planned pending real Provider / RPC evidence semantics |

---

## 21.9 `STATE_MOVEMENT`

| Dimension | Product definition |
| --- | --- |
| Observation | Quote and current execution no longer match |
| Primary Cause | relevant market / pool state changed after quote |
| Evidence required | quote block / timestamp + current block / simulation + comparable context |
| Candidate remediation | fresh quote; preserve input; preserve output; conditional wait; bounded alternative |
| Quantification | calculate current delta and candidate outcomes |
| Re-verification | fresh state required |
| Beginner copy | “Market conditions changed after your quote.” |

---

## 21.10 `STALE_EVIDENCE`

| Dimension | Product definition |
| --- | --- |
| Observation | Evidence exists but is too old for the applicable check |
| Applicable axis | Evidence Quality |
| Meaning | Parallax cannot rely on the Evidence for the current decision |
| Remediation | requote, resimulate, refetch Provider Evidence |
| Quantification | freshness / block lag where policy exists |
| Re-verification | replace stale dependency with fresh Evidence |
| Beginner copy | “Market data changed before we could verify this trade. Re-check it before signing.” |
| Transaction Action | none until fresh Evidence supports one |

---

## 21.11 `INCOMPLETE_EVIDENCE`

| Dimension | Product definition |
| --- | --- |
| Observation | Required Evidence is missing or unverified |
| Applicable axis | Evidence Quality |
| Meaning | no reliable transaction conclusion can be produced |
| Remediation | retry Provider; use supported fallback Evidence source; expose missing scope |
| Re-verification | required Evidence becomes complete |
| Beginner copy | “We cannot fully verify this transaction right now.” |
| Transaction Action | none until Evidence supports one |

---

# 22. Beginner frontend policy

The default frontend should answer:

```text
1. What happened?
2. Why?
3. What can I do?
4. What happens if I choose each option?
5. Was that option verified?
```

The user should not have to configure:

```text
maxPriceImpact
minEffectiveRate
maxGas
route preference
liquidity policy
```

before Parallax becomes useful.

---

## 22.1 Example beginner-facing result

> ### Your quote has changed
>
> You selected **4.812 ETH**, but the current simulation estimates **4.746 ETH**.
>
> **Why:** Market conditions changed after your quote, and this trade now has more price impact.
>
> ### Your options
>
> **Keep spending 10,000 USDC**  
> Current verified estimate: **4.751 ETH**
>
> **Use less USDC for a better rate**  
> Around **7,200 USDC** produces an execution rate closer to your original quote.
>
> **Still receive around 4.812 ETH**  
> Current estimate requires approximately **10,140 USDC**.
>
> **Wait for the previous economics**  
> Re-check when the quote reaches approximately **X or better**.
>
> **Try the verified alternative path**  
> Candidate path B currently estimates **4.785 ETH**.
>
> These results are based on the latest checked state. Re-check before signing if conditions change.

This gives the beginner decision support without requiring the Product to guess intent.

---

# 23. Progressive disclosure

### Default layer

Show:

```text
Observation
simple Cause
verified options
before / after values
main trade-off
freshness / re-check warning
```

### Expandable layer

May show:

```text
quote block
simulation block
quote age
effective rate
reference price
price impact
liquidity
protocol / LP fee
commission
gas
route
Provider
capabilities
provenance
checked scope
unknown scope
```

---

# 24. Advanced / SDK / MCP representation

The same Core should be able to represent:

```text
baselineType
baselineSource
observedValue
referenceValue
gap
observation
primaryCause
contributingFactors
controllableVariables
candidateActions
before
after
triggerCondition
predictedOutcome
tradeOff
verificationStatus
verifiedAtBlock
verifiedAtTime
evidenceRefs
scope
confidence
```

Exact names are illustrative only.

Contract Owner determines the canonical schema.

---

# 25. Agent / MCP compatibility

Agent-facing use should not require a different Product model.

Example machine flow:

```text
check transaction
→ receive observations + Causes + candidate Actions
→ caller chooses a candidate or policy
→ candidate is re-verified
→ if state changes, check again
```

Conditional use may become:

```text
when quote >= X:
    run Parallax check

if verified:
    return decision to caller
```

Parallax should remain the decision / verification layer.

Execution remains a separate responsibility.

---

# 26. Relationship to current Action Gate

The existing Action Gate establishes a valuable invariant:

> A transaction adjustment is not publicly recommendable unless its effect is verified.

The target remediation system should preserve this.

Current controlled/demo logic may use deterministic fixture values to prove the gate.

Target Product behavior should evolve toward:

```text
Observation
→ Cause
→ controllable variable
→ candidate generation
→ quantitative solve
→ quote / simulate candidate
→ verify predicted effect
→ publish candidate
```

The current fixed adjustment logic should eventually be replaced by Evidence-driven candidate solving.

---

# 27. Product acceptance principles

A P0 Economic Diagnosis & Remediation implementation is Product-acceptable only if:

### 27.1 Baseline provenance is explicit

Parallax distinguishes:

```text
Transaction Protection
Expectation Baseline
User Economic Constraint
Evidence Quality
```

---

### 27.2 Observation and Cause are distinct

“Output degraded” is not accepted as the final Cause when a deeper verified mechanism is available.

---

### 27.3 User intent is not silently inferred

Parallax should not assume the user wants to preserve:

- input;
- output;
- rate;
- lowest cost;
- fastest execution.

Where multiple objectives are plausible, Product should expose multiple counterfactual options.

---

### 27.4 Recommendations are quantified

Where technically possible:

```text
Reduce amount
```

must become:

```text
10,000 USDC → approximately 7,200 USDC
```

and:

```text
Increase amount
```

must become:

```text
10,000 USDC → approximately 10,140 USDC
```

---

### 27.5 Predicted outcomes are re-verified

No Action should be described as a verified improvement based only on heuristic reasoning.

---

### 27.6 Verification is state-bound

Every verified result is relative to the state where it was observed.

If state moves materially before signing, Product requires a fresh check.

---

### 27.7 Transaction protection is not economic improvement

Increasing slippage or lowering an economic boundary cannot be presented as “fixing” a poor execution result.

---

### 27.8 Evidence failure stays separate from economic failure

Missing / stale Evidence results in a verification limitation, not a “bad transaction” verdict.

---

### 27.9 Whole-market optimization remains out of P0

Only bounded, actually evaluated alternatives may be surfaced.

---

### 27.10 User retains final choice

Parallax supports decision-making.

It does not autonomously choose and execute the financial action.

---

# 28. Current readiness classification

Product should use one of the following labels where implementation maturity matters:

```text
IMPLEMENTED
VERIFIED
PLANNED
UNRESOLVED
DIAGNOSTIC_ONLY
```

Examples:

| Capability | Current Product status |
| --- | --- |
| Execution viability | Implemented / existing Core path |
| Explicit minimum received boundary | Implemented in current Product semantics |
| Expectation Baseline | Proposed / unresolved Contract representation |
| Quote Fidelity | Product-defined; implementation bridge still required |
| Concrete before / after Action | Existing Action Gate concept |
| Evidence-driven amount solver | Planned |
| Exact-output / target-output solver | Planned |
| Conditional quote trigger | Planned |
| Price-impact diagnosis | Planned pending Evidence semantics |
| Effective-rate constraint | Planned / unresolved |
| Total-cost constraint | Planned / unresolved |
| Gas constraint | Planned pending real Provider evidence |
| Bounded verified alternative | Concept supported; concrete P0 integration pending |
| Whole-market route optimizer | Explicitly out of P0 |

---

# 29. P0 Product deliverables

Before the P0 economic loop is considered complete, Product should have:

1. **Expectation Baseline semantics**
2. **Quote Fidelity definition**
3. **Execution economics decomposition**
4. **Observation / Cause taxonomy**
5. **Multi-objective remediation policy**
6. **Bidirectional quantitative solving requirements**
7. **Conditional remediation semantics**
8. **State-bound re-verification policy**
9. **Beginner frontend hierarchy**
10. **Advanced / SDK / agent compatibility**
11. **Economic Diagnosis & Remediation Matrix**
12. **Clear Product vs Contract vs Backend ownership boundary**

---

# 30. Target P0 runtime flow

```text
Arbitrum Sepolia
        ↓
Camelot V3 quote
        ↓
Capture selected quote / Expectation Baseline
        ↓
Build exact unsigned transaction
        ↓
Tenderly / supported Provider simulation
        ↓
Normalize Evidence
        ↓
Execution Viability
        ↓
Quote Fidelity
        ↓
Execution Quality
        ↓
Observation
        ↓
Primary Cause
        ↓
Generate multiple candidate objectives / variables
        ↓
Quantitative solve
        ↓
Quote / simulate each candidate
        ↓
Verify predicted outcome
        ↓
Return verified option set
        ↓
User chooses
        ↓
Freshness / state check
        ↓
Re-check before signing if required
```

---

# 31. Product / technical ownership boundary

## Product Owner decides

- user problem;
- Product semantics;
- P0 scope;
- beginner explanation;
- Observation / Cause meaning;
- acceptable remediation categories;
- what counts as a verified improvement;
- what trade-offs must be shown;
- what must remain user choice;
- which capabilities are P0 vs deferred.

---

## Contract Owner decides

- canonical typed representation;
- enums;
- field naming;
- provenance structure;
- compatibility / versioning;
- legal cross-field invariants;
- canonical Expectation Baseline representation;
- final Evidence semantics.

---

## Backend Owner decides

- orchestration;
- candidate-search implementation;
- binary / iterative solve;
- exact-input / exact-output handling;
- quote / simulation lifecycle;
- Provider handoff;
- API integration;
- Registry composition.

---

## Provider Owner decides

- Provider-specific API usage;
- raw response parsing;
- candidate Evidence observations;
- real response qualification;
- capability detection;
- failure normalization.

---

## Frontend Owner decides

- visual hierarchy;
- progressive disclosure;
- interaction flow;
- option presentation;
- advanced details layout;
- final wording within Product semantics.

No owner should silently alter another owner's semantic boundary.

---

# 32. Open Product / Contract questions

The following require explicit follow-up before final implementation:

1. What is the minimal canonical representation of the **Expectation Baseline**?
2. How is the selected quote associated with the later Check?
3. Which quote fields must remain comparable across quote and simulation?
4. How should exact-input and exact-output semantics be represented?
5. What is the canonical normalized representation of effective rate?
6. What real Arbitrum Evidence is sufficient to support `HIGH_PRICE_IMPACT`?
7. How should reference price be defined across AMM and order-book protocols?
8. Which cost components enter total execution cost?
9. How is commission / explicit fee distinguished from LP / protocol fee?
10. How should gas be normalized for user-facing comparison?
11. Which freshness conditions belong to Core versus Provider policy?
12. What state change invalidates a previously verified recommendation?
13. Which bounded alternative paths are legal P0 candidates without becoming an aggregator?
14. Which Causes can be verified from Tenderly alone?
15. Which Causes require Protocol / market Evidence in addition?
16. How should a conditional “wait until quote ≥ X” trigger be represented?
17. Which remediation candidates can be generated without inferring user intent?
18. How should candidate ranking work, if any, without silently becoming orchestration?

Until resolved, Product should use:

```text
planned
unresolved
diagnostic-only
```

rather than overstate capability.

---

# 33. Final Product position

Parallax P0 should not ask a beginner to become an execution expert before it can help them.

The intended experience is:

> **You chose this transaction. Parallax checks whether the current market state still supports the result you saw, explains what changed, identifies the most relevant Cause, and gives you several concrete, verified ways to respond without guessing which objective matters most to you.**

For one user, the right choice may be:

```text
spend less
```

For another:

```text
spend more to preserve output
```

For another:

```text
keep the same input and accept the fresh result
```

For another:

```text
wait until a target condition is reached
```

For another:

```text
use a bounded verified alternative path
```

Parallax should make those trade-offs explicit and verifiable.

The deeper Core should remain suitable for advanced DeFi users, wallets, developers, SDKs, MCP integrations, and agents.

The Product principles are:

```text
Do not guess intent.
Diagnose the actual gap.
Explain the Cause simply.
Expose the controllable variables.
Quantify the change.
Show multiple plausible outcomes.
Verify every recommendation.
Treat verification as state-bound.
Keep the final decision with the user.
```
