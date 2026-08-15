# Frontend API Handoff (`/api/quote` + `/api/check` + `/api/replay`)

Status: BACKEND HANDOFF FOR ANALYZE 联调 — LIVE SIMULATION SUCCEEDED ON THE TEMPORARY MOSS PIN; FIXTURE REGENERATED ON NODE v22.23.2

Owner: Clare (`apps/api`)
Consumers: Antony (`apps/web`)

This page is the single backend handoff for frontend Analyze. It documents the
HTTP surfaces that exist today, with request/response shapes and branching
rules that match current Contracts and API behavior. It does not replace the
Product View Model or Risk Methodology.

Related:

- Runtime env and Moss pin: [moss-kuru-live-runtime.md](./moss-kuru-live-runtime.md)
- Re-run lifecycle: [ADR 0002](../adr/0002-rerun-lifecycle-scope.md)
- Deterministic backend acceptance gate:
  [backend-p0-acceptance.md](./backend-p0-acceptance.md) (`pnpm test:acceptance`)

## Coordination status

This handoff is evaluated against `main` while the integration work remains
split across the following owners:

- **#21 frontend → API:** remains `CHANGES_REQUESTED`. Frontend must not silently
  convert live `UNSUPPORTED` into Recorded Replay, and must remove any
  `displayAmountIn` override that replaces the API Intent value.
- **#23 Moss Live:** is merged on `main`. The temporary runtime pin
  `ef15448e166f31c891e80dba5073dae04a052a2b` and Node `v22.23.2` evidence
  support the exact Live SUCCESS claim documented in the runtime handoff;
  migration after upstream Moss finalizes remains a follow-up.
- **#19 Action Gate:** is merged on `main` with the interim
  `action_verification` path and A14. The full §3.3.1 `ACTION_GATE` / CrossRun
  Contract remains deferred.

The exact temporary-pin Live SUCCESS claim is now part of `main`; Recorded
Replay remains a separate deterministic integration path and must not be used
as a Live Check fallback.

Verification scope for this handoff: the documented temporary-pin Live SUCCESS
applies to the full `POST /api/check` path (`Discover → Load → Quote → Action →
Simulation`). This PR adds deterministic Quote contract and flow coverage, but
does not include a new Live Quote smoke, Docker build verification, Render
deployment, or deployed-endpoint verification.

## 1. Scope

In scope:

- `POST /api/quote` — live pre-submit quote (or explicit `UNSUPPORTED` when Moss path is absent)
- `POST /api/check` — live Check (or explicit `UNSUPPORTED` when Moss path is absent)
- `GET /api/runs/:runId` — one persisted Check Run by ID for refresh/recovery
- `GET /api/replay/:id` — recorded Replay fixtures only
- Re-run as a second `POST /api/check` with `parentRunId` and exactly one Intent change
- Error codes, `retryable`, provenance fields frontend must not invent

Out of scope:

- SSE / Job polling
- Public sender-based Run history or enumeration
- Signing, broadcast, wallet custody
- Quote-only Action / Simulation stages; `/api/quote` stops after Discover → Load → Quote
- Non-`amountIn` Action Gate adjustments (protocol / tokenPair) beyond the fixture path
- Live evidence fixture regeneration is complete (Node v22.23.2, 2026-08-08;
  see live runtime doc)

## 2. Startup runbook

```bash
cp .env.example .env
# fill required values; never commit real RPC URLs with secrets
pnpm --filter @parallax/api start
```

Required listener values in `.env.example`: `HOST=127.0.0.1`, `PORT=8787`.

### Environment (names only)

| Variable | Required | Notes |
| --- | --- | --- |
| `MONAD_RPC_URL` | yes (backend) | Read-only Monad RPC for live path; never log the raw value |
| `MOSS_RUNTIME_VERSION` | yes | Expected `@themoss/*` version identity |
| `MOSS_RUNTIME_REVISION` | yes | Expected Moss git revision |
| `PARALLAX_TOKEN_REGISTRY_JSON` | yes | Trusted token metadata JSON; unknown ERC-20 → `NORMALIZATION_FAILED` |
| `HOST` / `PORT` | yes | HTTP listener |
| `CORS_ORIGIN` | optional | Browser origin allowed to call the API; defaults to `http://localhost:5173` when unset in compose paths that apply the default |
| `MOSS_RUNTIME_PATH` | optional | Absolute built Moss Git checkout (`.git` retained + `git` available). **Absent → live Check is `UNSUPPORTED`.** |
| `MOSS_RPC_URL` | smoke only | Used by live smoke scripts; not the primary backend launcher key (`MONAD_RPC_URL` is) |

Log / error hygiene: do not print `MONAD_RPC_URL`, `MOSS_RPC_URL`, or URL userinfo/query secrets. Prefer structured `error.code` in UI, not raw RPC strings.

### Behavior with / without Moss path

| Config | `POST /api/check` |
| --- | --- |
| No `MOSS_RUNTIME_PATH` | HTTP **502**, `error.code = "UNSUPPORTED"`, Run envelope `verdict = UNKNOWN`, `retryable = false` |
| Valid pinned path | Live Agent Flow runs; fail-closed without trustworthy pinned-block / runtime provenance. Live simulation SUCCESS is proven on the temporary pin (see [moss-kuru-live-runtime.md](./moss-kuru-live-runtime.md)); the committed evidence fixture was regenerated on Node v22.23.2. |

Recorded Replay is **only** via `/api/replay/:id`. It is never used as a fallback for live Check.

### CORS

- Configure `CORS_ORIGIN` to the Vite origin (example: `http://localhost:5173`).
- Preflight against `/api/check` is covered by the real Node integration test path.

### RunStore lifecycle and recovery

With `RUN_STORE_BACKEND=memory`, completed / failed Checks are kept only in the
API process and a restart drops their `runId` values. With
`RUN_STORE_BACKEND=postgres`, `GET /api/runs/:runId` reads the durable record
after restart. A `started` record is returned as `status: "started"` without a
fabricated result; it is not a valid Re-run baseline until the existing Re-run
rules accept it.

## 3. `POST /api/check`

### Minimal request

Exact-input swap. `amountIn` is a positive decimal string (human units before
normalization to atomic). Chain must be Monad mainnet `143`.

```json
{
  "chainId": 143,
  "protocol": "kuru",
  "sender": "0x1111111111111111111111111111111111111111",
  "tokenIn": { "kind": "native" },
  "tokenOut": {
    "kind": "erc20",
    "address": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"
  },
  "amountIn": "0.01",
  "economicBoundary": {
    "availability": "unavailable",
    "source": "unavailable"
  }
}
```

Notes:

- `recipient` is optional; when omitted, backend defaults recipient from sender
  and records `recipientSource = "defaulted_from_sender"` on the normalized Intent.
- `tokenOut.address` must exist in `PARALLAX_TOKEN_REGISTRY_JSON` for that chain
  or normalization fails.
- Available Economic Boundary (optional product path):

```json
"economicBoundary": {
  "availability": "available",
  "minimumReceived": "20",
  "source": "user_declared"
}
```

### HTTP 200 Run responses

Body is a `RunResult`. Two terminal shapes:

1. **`status: "completed"`** — `systemStatus: "OK"`, `verdict` in
   `PROCEED | ADJUST | STOP | UNKNOWN`.
   Unattested `ADJUST` candidates are **fail-closed to `STOP`** with empty
   `recommendedActions`. A verified fixture Action Gate may publish
   `verdict = ADJUST` with one recommendable `amountIn` Action only when the
   public gate below is met (acceptance row A14). A completed verification
   child alone is not sufficient.

   **Fixture verified `ADJUST` gate (public boundary):**

   - baseline has an available Economic Boundary;
   - baseline `P0-EVIDENCE-001 = PASS`, `P0-EXECUTION-001 = PASS`, and
     `P0-ECONOMIC-001 = FAIL` with `OUTPUT_BELOW_BOUNDARY`;
   - only `amountIn` changes on the verification child; the original Economic
     Boundary is preserved;
   - the child reaches `status = completed` with Evidence, Execution, and
     Economic rules all `PASS`;
   - the child's Economic-rule `simulated_token_out` Evidence matches the
     child's normalized `recipient` and `tokenOut`;
   - baseline Evidence includes an `action_verification` attestation whose
     `resultEvidenceKey` and Action `evidenceRefs` link the public Action to
     that attestation and the verified output Evidence;
   - missing, failing, mismatched, unattested, or non-terminal verification
     remains `STOP` with empty `recommendedActions`.

   **`OUTPUT_IMPROVEMENT_VERIFIED` visibility:** this Action Reason Code means
   only that the attested verification child produced a verified simulated
   output that passed the unchanged Economic Boundary relative to the failing
   baseline. It is **not** evidence of a globally optimal amount, best price or
   route, protocol safety, guaranteed live execution, or support for
   non-`amountIn` adjustments.
2. **`status: "integration_error"`** — `systemStatus: "INTEGRATION_ERROR"`,
   `verdict: "UNKNOWN"`, structured `error` on the Run (`code`, `stage`,
   `message`, `retryable`).

Illustrative completed skeleton (fields truncated):

```json
{
  "runId": "…",
  "replayMode": false,
  "intent": { "chainId": 143, "protocol": "kuru", "amountInAtomic": "…" },
  "simulatorPinnedBlock": "92820000",
  "status": "completed",
  "systemStatus": "OK",
  "verdict": "UNKNOWN",
  "summary": "…",
  "ruleResults": [],
  "recommendedActions": [],
  "irrelevantActions": [],
  "evidence": [],
  "scope": []
}
```

### Transport / application errors (non-200)

| HTTP | `error.code` | When |
| --- | --- | --- |
| 400 | `INVALID_JSON` / `INVALID_REQUEST` | Bad JSON or schema mismatch |
| 400 | `NORMALIZATION_FAILED` | Trusted registry / unit normalization failed (`issues` may carry field codes such as `UNSUPPORTED_TOKEN`) |
| 400 | `INVALID_RERUN` | Re-run rejected; see `error.reason` |
| 413 | `PAYLOAD_TOO_LARGE` | Body over limit |
| 405 | `METHOD_NOT_ALLOWED` | Non-POST on `/api/check` |
| 502 | `UNSUPPORTED` | Live Agent Flow not configured |
| 502 | `AGENT_FLOW_ERROR` | Structured/unstructured Agent Flow failure mapped to a failed Run |
| 502 | `INVALID_AGENT_FLOW_RESPONSE` | Agent Flow returned a non-contract RunResult |
| 500 | `RUN_STORE_ERROR` / `INTERNAL_ERROR` | Store or unexpected transport failure |

Branch UI on **`error.code`** (and Re-run **`error.reason`**), never on English `message`.

### Integration Error on the Run (retryable map)

When a Run carries `error` (either as HTTP 200 `integration_error` body or
nested under a 502 `run` envelope), public codes include:

| `error.code` | `retryable` | Meaning |
| --- | --- | --- |
| `TIMEOUT` | `true` | Stage/runtime timeout |
| `RPC_UNAVAILABLE` | `true` | RPC dependency unavailable |
| `MOSS_UNAVAILABLE` | `true` | Moss runtime unavailable |
| `UNSUPPORTED` | `false` | Live flow not wired |
| `INVALID_RESPONSE` | `false` | Invalid Agent Flow payload |
| `INTERNAL_ERROR` | `false` | Internal Agent Flow failure |

`error.stage` is a closed set: `quote` | `action` | `simulation` |
`normalization` | `unknown`. Stages such as Moss `LOAD` / `DISCOVER` currently
map to `unknown` until a Contracts decision expands the enum — do not infer
protocol risk from `unknown`.

**Two product paths exist** for integration failures: a validated
`integration_error` Run returned as HTTP 200, versus a mapped Agent Flow throw
returned as HTTP 502 with a `run` envelope. Treat both as Integration Error for
CTA purposes; prefer `run.error.retryable` when present.

## 4. `POST /api/quote`

Use this endpoint before submitting a full Check when the UI needs an estimated
output amount. It accepts the same exact-input token pair and amount, resolves
tokens through the trusted backend registry, and runs only Moss Discover → Load
→ Quote. It does not construct an Action, simulate, sign, or broadcast a
transaction. A successful Quote therefore does not prove execution safety or
transaction success.

### Request

```json
{
  "chainId": 143,
  "protocol": "kuru",
  "sender": "0x1111111111111111111111111111111111111111",
  "tokenIn": { "kind": "native" },
  "tokenOut": {
    "kind": "erc20",
    "address": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"
  },
  "amountIn": "0.01"
}
```

`amountIn` and returned quote amounts are human-unit decimal strings. Quote
uses the existing backend Kuru default of 50 bps; this ticket does not add a
public slippage input.

### Available / unavailable responses

```json
{
  "status": "available",
  "quote": {
    "estimatedAmountOut": "0.000223",
    "minimumAmountOut": "0.000221",
    "source": "quote",
    "blockNumber": "91383505",
    "fetchedAt": "2026-08-08T12:00:00.000Z",
    "runtimeVersion": "0.1.0",
    "runtimeRevision": "<40-hex-commit>"
  }
}
```

If no route or no valid quote is available, the HTTP response remains 200:

```json
{ "status": "unavailable", "reason": "NO_ROUTE" }
```

An `available` Quote always includes the RPC block observed immediately before
the QUOTE stage. A missing stage block cannot be published as available.

`reason` is `NO_ROUTE` or `QUOTE_UNAVAILABLE`. Transport and normalization
errors use the same `INVALID_JSON`, `INVALID_REQUEST`, `NORMALIZATION_FAILED`,
`UNSUPPORTED`, and `PAYLOAD_TOO_LARGE` conventions described above; Quote
flow failures return HTTP 502 with `error.code = "QUOTE_ERROR"`.

When `/api/check` returns a completed or integration-error Run, it may also
include the same optional top-level `quote` object. This is the Quote-stage
observation and must not be substituted with `simulated_token_out`, which is a
separate simulation output.

## 5. Re-run (`POST /api/check` + `parentRunId`)

Same endpoint. Add `parentRunId` and change **exactly one** supported Intent
condition (for example `amountIn` only).

```json
{
  "parentRunId": "<baseline-run-id>",
  "chainId": 143,
  "protocol": "kuru",
  "sender": "0x1111111111111111111111111111111111111111",
  "tokenIn": { "kind": "native" },
  "tokenOut": {
    "kind": "erc20",
    "address": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"
  },
  "amountIn": "0.02",
  "economicBoundary": {
    "availability": "unavailable",
    "source": "unavailable"
  }
}
```

Successful child responses include `parentRunId` and `diff` (machine-normalized
`before` / `after`). On Agent Flow failure, child may still return
`parentRunId` + `diff` on the failed Run envelope (see ADR 0002).

### Replay `runId` versus Check `RunStore`

The `runId` returned by `GET /api/replay/:id` identifies a frozen fixture; it is
not inserted into the process-local Check `RunStore`. Passing that `runId` as a
`POST /api/check` `parentRunId` therefore returns
`INVALID_RERUN` with `reason: PARENT_NOT_FOUND`, before a new Run is started or
Agent Flow is called. This is distinct from a test or in-process Check record
whose stored result has `replayMode: true`, which returns
`INVALID_RERUN` with `reason: PARENT_IS_REPLAY`.

### `INVALID_RERUN` reasons

| `reason` | Meaning |
| --- | --- |
| `PARENT_NOT_FOUND` | Unknown or unavailable `parentRunId`, including a Replay fixture `runId` that is not stored in the Check `RunStore` or a Check Run lost after API process restart |
| `PARENT_NOT_COMPLETED` | Parent not a completed baseline |
| `PARENT_IS_REPLAY` | A Replay-marked result already stored in the Check `RunStore` cannot be a Re-run baseline |
| `RERUN_CHAINING_UNSUPPORTED` | Parent is already a child Run |
| `CHAIN_OR_SENDER_CHANGED` | chainId / sender must match baseline |
| `BOUNDARY_CHANGED` / `BOUNDARY_ASSET_CHANGED` | Economic Boundary must stay unchanged |
| `NOT_EXACTLY_ONE_CHANGE` | Zero or multiple Intent condition changes |

Reason precedence: parent existence/completion, Replay baseline, chaining,
chain/sender, and Economic Boundary checks run before the exactly-one-change
diff. A request that changes both sender and amount returns
`CHAIN_OR_SENDER_CHANGED`, not `NOT_EXACTLY_ONE_CHANGE`.

Diff display: `amountInAtomic` is atomic units; `tokenPair` uses
`native` / `erc20:<lowercase-address>`. Render human copy from full Intent +
token registry, not by reverse-engineering Diff strings.

## 6. `GET /api/runs/:runId`

- Method: **GET** only.
- `runId` is an opaque, non-enumerable identifier. This endpoint does not
  enumerate Runs by sender or expose a public history list.
- A `started` Run is returned with its normalized Intent and lifecycle status,
  but without a fabricated `result` or Receipt.
- A terminal Run is returned with its stored `result`; failed Runs also retain
  the Store-level `failure` classification.

Example:

```bash
curl -s "http://127.0.0.1:8787/api/runs/<runId>"
```

| HTTP | `error.code` | Meaning |
| --- | --- | --- |
| 404 | `RUN_NOT_FOUND` | The ID is invalid or no Check Run exists |
| 405 | `METHOD_NOT_ALLOWED` | Non-GET request |
| 500 | `RUN_STORE_ERROR` | The configured RunStore could not be read |
| 500 | `INTERNAL_ERROR` | Unexpected Run query transport failure |

The response body is the stored Check Run record. The `status` field is the
Store lifecycle (`started`, `completed`, or `failed`), while a terminal
`result.status` retains the existing public RunResult semantics.

## 7. `GET /api/replay/:id`

| ID | Fixture |
| --- | --- |
| `mon-to-usdc` | `fixtures/replay-data/mon-to-usdc.json` |
| `usdc-to-mon` | `fixtures/replay-data/usdc-to-mon.json` |

- Method: **GET** only.
- Body is a frozen `RunResult` with `replayMode: true` and Evidence
  `isReplay: true` / `fixtureId` set.
- Recorded Replay **must not** be labeled Live.
- A Replay-marked result already stored in the Check `RunStore` **cannot** be a
  Re-run `parentRunId` baseline (`PARENT_IS_REPLAY`). An HTTP Replay fixture
  `runId` is not stored there and therefore returns `PARENT_NOT_FOUND` instead;
  see the Replay `runId` versus Check `RunStore` section under Re-run.
- Live Check **never** falls back to Replay.
- **Amount display contract:** the Replay fixture `intent` has no separate
  human-unit `amountIn` field in the current Shared Contract. Its authoritative
  input is `intent.amountInAtomic`. Frontend may expose a view-model `amountIn`
  by converting that atomic value with trusted token decimals, but must not use
  an independent `displayAmountIn` value or treat it as a new API field.

| HTTP | `error.code` | Meaning |
| --- | --- | --- |
| 404 | `REPLAY_NOT_FOUND` | Unknown fixture id |
| 405 | `METHOD_NOT_ALLOWED` | Non-GET request |
| 500 | `REPLAY_STORE_ERROR` | Fixture could not be loaded |
| 500 | `INVALID_REPLAY_FIXTURE` | Fixture failed trusted schema or identity validation |
| 500 | `INTERNAL_ERROR` | Unexpected replay transport failure |

Example:

```bash
curl -s "http://127.0.0.1:8787/api/replay/mon-to-usdc"
```

## 8. Provenance fields (required for UI)

| Field | Rule |
| --- | --- |
| `replayMode` | Run-level Replay flag; live Check results must be `false` |
| Evidence `isReplay` / `isMock` | Do not treat mock as authoritative for PROCEED/ADJUST/STOP |
| `simulatorPinnedBlock` | Required for authoritative completed live `/api/check` Runs that entered Simulation; missing → fail-closed. The narrow exception is a verified terminal `NO_ROUTE_FOUND` STOP that ends before Simulation. Quote-only `/api/quote` responses do not enter this requirement. |
| `runtimeVersion` / `runtimeRevision` | Must match configured Moss identity on core Evidence |
| `fixtureId` | Present on Replay Evidence; identifies recorded fixture |

Frontend must display Live vs Recorded Replay explicitly. Do not upgrade
`UNKNOWN` or Integration Error into protocol `STOP` / `PROCEED` locally.

## 9. Frontend联调 checklist

1. Start API without `MOSS_RUNTIME_PATH` → both live endpoints return `UNSUPPORTED`.
2. With the runtime configured, call `POST /api/quote` first and branch on
   `status`; do not require a quote for a full Check if the backend reports
   `QUOTE_UNAVAILABLE`.
3. `GET /api/replay/mon-to-usdc` returns 200 with `replayMode: true`, `verdict: UNKNOWN` in current fixtures.
4. Confirm CORS from the web origin.
5. (Optional) Configure Moss path per [moss-kuru-live-runtime.md](./moss-kuru-live-runtime.md). Live simulation SUCCESS has been achieved on the temporary pin; treat `PROCEED` as "no blocking evidence within the checked scope" (never a guaranteed outcome). The committed fixture was regenerated on Node v22.23.2.
6. Use `GET /api/runs/:runId` to restore a persisted Check Run after refresh;
   handle `status: "started"` without inventing a Receipt.
7. Re-run only against Check `runId`s accepted by the existing Re-run rules. A
   Replay fixture `runId` is not a Check parent and returns `PARENT_NOT_FOUND`;
   a Check `parentRunId` lost after a memory-backend restart returns the same
   reason.
8. CTA / retry: use `error.retryable` and closed reason codes from this page and Product delivery docs.

## 10. Non-goals reminder

Do not implement against the early draft REST shapes (`/api/analyze`, async jobs,
SSE) from older planning notes. The live public surfaces for P0 Analyze联调 are
**`POST /api/quote`**, **`POST /api/check`**, **`GET /api/runs/:runId`**, and
**`GET /api/replay/:id`**.
