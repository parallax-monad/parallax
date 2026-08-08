<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

# Parallax

Parallax 是面向 Monad Swap 的只读、由 Moss 驱动的签名前决策层。

> Moss 告诉我们将会发生什么。Parallax 帮助用户决定下一步该做什么。

## 产品主张

Swap 界面可以展示报价、警告和模拟结果，却不一定能把已经观察到的原因与边界明确的下一步行动连接起来。Parallax 将可追溯的执行 Evidence 转化为带有范围说明的决策：用户可以检查决策依据，并在条件允许时修改一个相关条件后再次验证。

核心流程如下：

```text
Swap intent
→ Moss quote/action/simulation evidence
→ normalized evidence
→ cause
→ PROCEED / ADJUST / STOP / UNKNOWN
→ relevant or irrelevant adjustment
→ optional re-run
→ previous vs new result
```

`UNKNOWN` 不是通过。`PROCEED` 表示在已检查范围内没有发现阻断 Evidence；它不构成安全保证或投资建议。

## Parallax 的功能

- 接收结构化、未签名的 Swap Intent；
- 获取并标准化 quote、prepared action、simulation 和 provenance Evidence；
- 执行确定性的 P0 规则，并将 Integration Error 与交易本身的不确定性分开；
- 展示 `PROCEED`、`ADJUST`、`STOP` 或 `UNKNOWN`，同时披露 Checked、Unknown 与 Not Checked 范围；
- 将经过验证的相关调整与无关修改分开；
- 支持 Recorded Replay，以及仅修改一个条件的受限 re-run 对比；
- 始终保持只读：不签名、不广播、不托管，也不修改钱包状态。

## Demo 流程

Landing Page 位于 `#/`。选择 **Try demo**（或 **体验 Demo**）即可在 `#/analyze` 打开钱包式 MVP。

当前 `main` 上的前端通过确定性的本地 fixture 逻辑演示决策体验。Backend API 与 live Moss/Kuru runtime path 已分别实现；frontend-to-backend MVP wiring 仍在集成中，不能视为已经在 `main` 完成。

## 当前实现状态

状态更新于 **2026-08-08**：

| 范围 | `main` 当前状态 |
| --- | --- |
| Landing 体验 | 已实现英文/简体中文文案和交互式 Three.js Evidence 星图 |
| 钱包式前端 MVP | 已在 `#/analyze` 实现，当前使用确定性的 Demo fixtures |
| Shared Contract 与 Verdict 规则 | 已实现当前 P0 slices，并有自动化测试覆盖 |
| Backend API 与 orchestration | 已通过 Hono、`POST /api/check`、进程内 Run 存储和 Recorded Replay 实现 |
| Recorded Replay | 已通过 `GET /api/replay/:id` 实现；绝不会作为静默的 live-check fallback |
| Live Moss/Kuru backend | 已针对固定 Kuru runtime 和经验证的 fixture 范围合入；需要显式 runtime 配置 |
| 前后端连接 | 正在 `main` 之外集成；当前前端仍使用本地 Demo service |
| 签名/广播/托管 | 明确不实现 |

现有 live Evidence 只证明一个固定 Kuru MON → USDC simulation path。它不能证明所有 Pair、协议、runtime revision、资产行为或未来市场条件。

## P0 范围与明确排除项

P0 面向一个工作假设中的轻度 DeFi 用户：该用户即将签署 Monad Swap，或正在失败后重试。P0 覆盖由 Evidence 支持的原因、Scope Disclosure、边界明确的 Verdict、经过验证的 Action 可见性，以及可选的 re-run 对比。

P0 不提供：

- 投资建议，或“交易安全”的承诺；
- 最优价格、最优 Route 或全市场聚合；
- 完整的协议、Token 或 Smart Contract 安全审计；
- 自动签名、广播、执行或托管；
- 自主 AI 判断；
- RPC、Moss 或必要 Evidence 不可用时的 live 可用性保证。

用户提供的 `Minimum Received` 是显式 Acceptance Boundary。Parallax 不会降低它来制造 `PROCEED`。

## 架构概览

| 路径 | 职责 |
| --- | --- |
| `apps/web` | React 18 + Vite 前端、Landing 体验、钱包式 Demo 与 Three.js 可视化 |
| `apps/api` | 用于 live Check 与 Recorded Replay 的 Node.js/Hono HTTP runtime |
| `packages/contracts` | Shared schemas、标准化 Intent/Run 类型、Evidence、Replay 与 serialization |
| `packages/moss-bridge` | Moss/Kuru runtime 加载、live execution-evidence adapter、normalization 与 provenance 检查 |
| `packages/orchestrator` | Agent Flow、rerun lifecycle、Action Gate 与应用 orchestration |
| `packages/risk` | 确定性的 P0 Rule evaluation 与集中式 Verdict policy |
| `fixtures` | Recorded raw/normalized Evidence 与 Replay fixtures |
| `docs` | 产品、研究、risk methodology、integration、ADR 与 runtime 文档 |
| `scripts` | 确定性与 live Kuru smoke/acceptance 工具 |

主要工具链包括 Node.js 22、pnpm、TypeScript、React、Vite、Three.js、使用 Node server runtime 的 Hono、Vitest 和 Biome。

## 仓库结构

```text
apps/
  api/                 Backend API and runtime composition
  web/                 Landing page and wallet-style frontend MVP
packages/
  contracts/           Shared contracts and serialization
  moss-bridge/         Moss/Kuru adapter and normalization
  orchestrator/        Agent Flow and application lifecycle
  risk/                Rule and Verdict logic
fixtures/              Evidence and Replay fixtures
docs/                  Product, research, integration, methodology, and ADRs
scripts/               Smoke and repository-validation scripts
```

## 快速开始

环境要求：

- Node.js 22；
- 与 pnpm 11 兼容的工具；
- Git。

安装依赖并创建本地环境文件：

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

启动前端 Demo：

```bash
pnpm --filter @parallax/web dev
```

打开 Vite 提供的 URL，使用 `#/` 访问 Landing Page，或使用 `#/analyze` 访问 MVP。

如需启动 backend，请先在 `.env` 中填写必需配置，然后运行：

```bash
pnpm --filter @parallax/api start
```

前端与 backend 是两个独立进程。在当前 `main` 上，同时启动两者并不会自动把前端的本地 Demo service 替换为 API 调用。

## 环境配置

`.env.example` 是环境变量的权威清单。

| 变量 | 用途 |
| --- | --- |
| `MONAD_RPC_URL` | Backend `POST /api/check` 使用的只读 Monad RPC |
| `MOSS_RPC_URL` | 本地 live-smoke 命令使用的只读 RPC；backend 不会自动读取 |
| `MOSS_RUNTIME_VERSION` | 预期的 Moss package/runtime version |
| `MOSS_RUNTIME_REVISION` | 预期的不可变 Moss Git revision |
| `MOSS_RUNTIME_PATH` | 指向已构建、固定 Moss Git checkout 的可选绝对路径；用于启用 live Kuru Agent Flow |
| `PARALLAX_TOKEN_REGISTRY_JSON` | Backend normalization 使用的可信 Token metadata |
| `CORS_ORIGIN` | 允许调用 API 的浏览器 Origin |
| `HOST` / `PORT` | Node HTTP listener 配置 |

Live backend 要求 `MOSS_RUNTIME_PATH` 指向的 Moss checkout 保留 `.git` metadata、匹配已配置的 version/revision，并且能够由安装了 `git` 的 runtime 读取。如果没有该路径，`POST /api/check` 会以 `UNSUPPORTED` 和 `UNKNOWN` Run 明确 fail closed，而不会返回伪造的 live Evidence。

请勿提交 RPC 凭据或已经填入真实值的 `.env` 文件。

## 开发命令

```bash
pnpm lint                         # Biome checks
pnpm typecheck                    # root and workspace TypeScript checks
pnpm test                         # deterministic Vitest suite
pnpm test:acceptance              # backend P0 acceptance matrix
pnpm test:integration             # real Node listener integration test
pnpm --filter @parallax/web build # production frontend build
pnpm smoke:kuru                   # deterministic Kuru smoke
pnpm smoke:kuru:live              # external live Moss/RPC smoke
```

`pnpm smoke:kuru:live` 需要固定的 Moss runtime 与只读 RPC 配置，因此不属于默认 CI 路径。

## API 概览

### `POST /api/check`

执行由 backend 持有的 live Check boundary。请求携带标准化 Swap Intent；处理成功后返回 completed 或 Integration Error Run envelope。Re-run 继续使用同一 endpoint，并通过 `parentRunId` 关联，同时只允许一个 Intent 变化。

如果没有配置 live Moss，该 endpoint 会返回明确的 `UNSUPPORTED` application error 与 `UNKNOWN` Run。它绝不会用 Recorded Replay 替代 live 结果。

### `GET /api/replay/:id`

返回冻结的 Recorded Replay fixture。Replay 保留已记录的 provenance，但它不是当前 live Run，也不能作为 live Check parent。

Payload、error mapping、CORS 与启动说明请参阅[前端 API handoff](docs/integration/api-frontend-handoff.md)。

## 文档导航

### 产品

- [产品需求文档](docs/product/prd.md)
- [Product Delivery specification](docs/product/product-delivery.md)

### 研究

- [用户研究](docs/research/user-research.md)
- [竞品分析](docs/research/competitive-analysis.md)

### Integration 与 Evidence

- [前端 API handoff](docs/integration/api-frontend-handoff.md)
- [Backend P0 acceptance matrix](docs/integration/backend-p0-acceptance.md)
- [Moss/Kuru live runtime](docs/integration/moss-kuru-live-runtime.md)
- [P0 Rule and Reason-to-Action specification](docs/risk-methodology/p0-rule-and-reason-action-spec.md)
- [Architecture Decision Records](docs/adr/)

## 测试与质量门禁

GitHub Actions 使用 Node.js 22 并执行：

```text
pnpm install --frozen-lockfile
→ pnpm lint
→ pnpm typecheck
→ pnpm test
→ pnpm test:integration
```

Live RPC/Moss smoke tests 因需要外部 runtime 配置而明确独立运行。Evidence 与 runtime 相关陈述必须始终限制在具体 Recorded fixture 与固定 revision 的范围内。

## 团队

| 成员 | GitHub | 负责范围 |
| --- | --- | --- |
| Kai | [@chin0312](https://github.com/chin0312) | 产品与 Demo |
| Rei | [@rainypilgrimage](https://github.com/rainypilgrimage) | Risk methodology 与研究 |
| Jie | [@jzhao0](https://github.com/jzhao0) | Moss integration 与 Risk Engine |
| Clare | [@brightheartma](https://github.com/brightheartma) | API、backend、orchestration 与 deployment |
| Antony | [@antony819](https://github.com/antony819) | Web frontend |

## 协作

- 从最新 `main` 创建短期分支开始工作。
- Runtime、Contract、产品文案与 Evidence 陈述应保留在各自负责的层中。
- 不得使用 Recorded Replay 或 Mock data 证明 live user Verdict。
- 创建 Pull Request 前运行相关检查。
- 根据变更涉及的文件与语义请求对应负责人 Review。

## 免责声明

Parallax 是用于解释和验证签名前决策的实验性软件。它不提供投资建议，也不签名、广播、执行或托管交易。Evidence 可能不完整或不可用；用户必须自行验证交易细节，并理解 `PROCEED` 仅在已检查范围内成立，不构成安全保证。
