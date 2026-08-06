# Frontend API Handoff (`/api/check` + `/api/replay`)

Status: BACKEND HANDOFF FOR ANALYZE 联调 — LIVE SUCCESS NOT CLAIMED

Owner: Clare (`apps/api`)
Consumers: Antony (`apps/web`)

This page is the single backend handoff for frontend Analyze. It documents the
HTTP surfaces that exist today, with request/response shapes and branching
rules that match current Contracts and API behavior. It does not replace the
Product View Model or Risk Methodology.

Related:

- Runtime env and Moss pin: [moss-kuru-live-runtime.md](./moss-kuru-live-runtime.md)
- Re-run lifecycle: [ADR 0002](../adr/0002-rerun-lifecycle-scope.md)
- Deterministic backend acceptance gate: tracked as PR
  [`test/api-p0-acceptance`](https://github.com/parallax-monad/parallax/pull/17)
  (`docs/integration/backend-p0-acceptance.md` once merged)

## 1. Scope

In scope:

- `POST /api/check` — live Check (or explicit `UNSUPPORTED` when Moss path is absent)
- `GET /api/replay/:id` — recorded Replay fixtures only
- Re-run as a second `POST /api/check` with `parentRunId` and exactly one Intent change
- Error codes, `retryable`, provenance fields frontend must not invent

Out of scope:

- SSE / Job polling / run-by-id history API
- Durable Run persistence (process-memory store only)
- Signing, broadcast, wallet custody
- Verified public `ADJUST` / Action Gate Actions (unattested candidates fail closed to `STOP`)
- Claiming Live Kuru MON → USDC SUCCESS (Moss-blocked; see live runtime doc)

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
| Valid pinned path | Live Agent Flow runs; still fail-closed without trustworthy pinned-block / runtime provenance. Live SUCCESS is not claimed in this handoff. |

Recorded Replay is **only** via `/api/replay/:id`. It is never used as a fallback for live Check.

### CORS

- Configure `CORS_ORIGIN` to the Vite origin (example: `http://localhost:5173`).
- Preflight against `/api/check` is covered by the real Node integration test path.

### Process-memory Run Store

Completed / failed Checks are kept in an in-memory store for the API process.
**Restarting the API drops all `runId` values.** Frontend must not assume durable
history. Re-run requires the parent `runId` still present in that process.

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
   Today, unattested `ADJUST` candidates are **fail-closed to `STOP`** with empty
   `recommendedActions` (no verified Action Gate yet).
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

**Two code namespaces.** Transport failures expose top-level `body.error.code`
(for example `INVALID_RERUN`, `INVALID_AGENT_FLOW_RESPONSE`, `UNSUPPORTED`).
Run integration failures expose `body.error.code` on an HTTP 200
`integration_error` body, or `body.run.error.code` when HTTP 502 carries a
failed Run envelope. These enums are not interchangeable: provenance /
replay-mode rejection (`INVALID_AGENT_FLOW_RESPONSE`, A10/A11) is
**transport-only** and is not a member of the Run `integrationErrorSchema.code`
set (`TIMEOUT`, `MOSS_UNAVAILABLE`, …).

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
protocol risk from `unknown`. **Do not surface `error.stage` as the primary
user-facing failure cause** until LOAD/DISCOVER map to distinct values; a LOAD
failure and a genuinely unattributable failure are indistinguishable today
(acceptance row A8 pins `stage: "unknown"` for LOAD).

**Two Integration Error envelopes.** A validated Agent Flow may return HTTP 200
with `body.status = "integration_error"` (acceptance row A4), or the listener
may map a thrown Agent Flow failure to HTTP 502 with both top-level
`body.error` and nested `body.run` (rows A6–A9). Treat both as Integration
Error for CTA purposes; prefer `run.error.retryable` when present.

## 4. Re-run (`POST /api/check` + `parentRunId`)

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

### `INVALID_RERUN` reasons

| `reason` | Meaning |
| --- | --- |
| `PARENT_NOT_FOUND` | Unknown `parentRunId` (or lost after process restart) |
| `PARENT_NOT_COMPLETED` | Parent not a completed baseline |
| `PARENT_IS_REPLAY` | Replay Runs cannot be Re-run baselines |
| `RERUN_CHAINING_UNSUPPORTED` | Parent is already a child Run |
| `CHAIN_OR_SENDER_CHANGED` | chainId / sender must match baseline |
| `BOUNDARY_CHANGED` / `BOUNDARY_ASSET_CHANGED` | Economic Boundary must stay unchanged |
| `NOT_EXACTLY_ONE_CHANGE` | Zero or multiple Intent condition changes |

Reason precedence: parent existence/completion, Replay baseline, chaining,
chain/sender, and Economic Boundary checks run before the exactly-one-change
diff. A request that changes both sender and amount returns
`CHAIN_OR_SENDER_CHANGED`, not `NOT_EXACTLY_ONE_CHANGE`.

Diff display: `amountInAtomic` is atomic units (for example
`1500000000000000000` → `2000000000000000000` in acceptance row A13); format
human amounts from the normalized Intent + token registry. `tokenPair` uses
`native` / `erc20:<lowercase-address>`. Render human copy from full Intent +
token registry, not by reverse-engineering Diff strings.

## 5. `GET /api/replay/:id`

| ID | Fixture |
| --- | --- |
| `mon-to-usdc` | `fixtures/replay-data/mon-to-usdc.json` |
| `usdc-to-mon` | `fixtures/replay-data/usdc-to-mon.json` |

- Method: **GET** only.
- Body is a frozen `RunResult` with `replayMode: true` and Evidence
  `isReplay: true` / `fixtureId` set.
- Recorded Replay **must not** be labeled Live.
- Replay **cannot** be a Re-run `parentRunId` baseline (`PARENT_IS_REPLAY`).
- Live Check **never** falls back to Replay.

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

## 6. Provenance fields (required for UI)

| Field | Rule |
| --- | --- |
| `replayMode` | Run-level Replay flag; live Check results must be `false` |
| Evidence `isReplay` / `isMock` | Do not treat mock as authoritative for PROCEED/ADJUST/STOP |
| `simulatorPinnedBlock` | Required for authoritative completed live Runs; missing → fail-closed |
| `runtimeVersion` / `runtimeRevision` | Must match configured Moss identity on core Evidence |
| `fixtureId` | Present on Replay Evidence; identifies recorded fixture |

Frontend must display Live vs Recorded Replay explicitly. Do not upgrade
`UNKNOWN` or Integration Error into protocol `STOP` / `PROCEED` locally.

## 7. Frontend联调 checklist

1. Start API without `MOSS_RUNTIME_PATH` → `POST /api/check` returns `UNSUPPORTED`.
2. `GET /api/replay/mon-to-usdc` returns 200 with `replayMode: true`, `verdict: UNKNOWN` in current fixtures.
3. Confirm CORS from the web origin.
4. (Optional) Configure Moss path per [moss-kuru-live-runtime.md](./moss-kuru-live-runtime.md); expect fail-closed Live until Moss SUCCESS exists — do not block UI on Live SUCCESS.
5. Re-run only against in-process Check `runId`s; handle `PARENT_NOT_FOUND` after API restart.
6. CTA / retry: use `error.retryable` and closed reason codes from this page and Product delivery docs.

## 8. Non-goals reminder

Do not implement against the early draft REST shapes (`/api/analyze`, async jobs,
SSE) from older planning notes. The live public surfaces for P0 Analyze联调 are
**`POST /api/check`** and **`GET /api/replay/:id`** only.
