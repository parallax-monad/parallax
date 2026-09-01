<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

# Parallax

Parallax 是面向链上操作的、与 Provider 无关的签名前修正与再次验证层。

**当前公开演示范围：** Monad × Kuru × Moss。

> Parallax 将不同来源的交易证据转换为确定性的原因和相关操作，并验证这次调整是否真正解决了问题。

## 项目演示

- [体验在线应用](https://parallax-web-snowy.vercel.app)
- [查看 Demo Day 演示文稿](https://parallax-monad.github.io/parallax/parallax-demo-day.html)
- [观看产品演示视频](https://www.youtube.com/watch?v=j43WqH6TrTE)

## 产品主张

一笔交易可以合法、可执行且没有明显恶意信号，却仍然不符合用户意图。Parallax 将执行前可获得的证据整理为范围明确的决策，并明确展示缺失的证据。

核心流程是：

```text
Intent
→ Evidence
→ Cause
→ Decision
→ Relevant Action
→ Re-verification
```

`UNKNOWN` 不是通过。 `PROCEED` 只表示在本次已检查范围内没有发现阻断证据；它不构成安全保证或投资建议。

## Parallax 做什么

- 接收结构化、未签名的 Swap Intent；
- 获取并标准化报价、已准备操作、模拟和溯源 Evidence；
- 执行确定性的决策规则，并将 Integration Error 与交易不确定性分开；
- 展示 `PROCEED`、`ADJUST`、`STOP` 或 `UNKNOWN`，同时披露已检查、未检查和未知范围；
- 将有证据支持的相关操作与本次结果不支持的修改分开；
- 支持记录回放，以及仅修改一个条件的受限再次检查对比；
- 始终保持只读：不会签名、广播、执行或托管用户的交易。

## 演示流程

落地页位于 `#/`，钱包式 MVP 位于 `#/analyze`。

1. 输入受支持的 Swap Intent；
2. 请求报价并执行签名前检查；
3. 查看 Evidence、溯源、检查范围、Cause 和 Decision；
4. 当结果明确支持时，修改一个相关条件并再次检查；
5. 比较上一次运行与新运行。

当前前端适配层调用 `POST /api/quote`、`POST /api/check`、`GET /api/runs/:runId` 和 `GET /api/replay/:id`。记录回放是单独且明确标注的路径，不会被当作实时检查的替代品。

## 当前演示范围

当前公开演示使用 Monad × Kuru × Moss 路径。已核验的实时范围仅限文档所述的固定 Kuru MON → USDC 路径与运行环境；这不能证明所有资产、路径、协议、运行环境修订版或未来市场条件都受支持。

## P0 范围与明确排除项

P0 采用一个工作假设中的轻度 DeFi 用户：该用户即将签署 Monad Swap，或在失败后准备重试。P0 聚焦于有证据支持的 Cause、检查范围披露、边界明确的 Decision、相关操作可见性和可选的再次验证。

P0 不提供：

- 投资建议，或“交易安全”的承诺；
- 最优价格、最优路径或全市场聚合；
- 完整的协议、代币或智能合约安全审计；
- 自动签名、广播、执行或托管；
- 自主 AI 判断；
- RPC、Moss 或必要 Evidence 不可用时的实时可用性保证。

在当前 Monad MVP 中，`economicBoundary.minimumReceived` 是随 Intent 传递的明确接受边界，其溯源可能是 `original_swap`、`user_declared`、`demo_preset` 或 `unavailable`；Parallax 不会降低它来制造 `PROCEED`。

## 架构与技术栈

长期分解为：

```text
Chain × Protocol × Evidence Provider
```

| 路径 | 职责 |
| --- | --- |
| `apps/web` | React 18 + Vite 前端、落地页、钱包式 MVP、API 适配层与 Three.js 可视化 |
| `apps/api` | 用于实时报价/检查和记录回放的 Node.js/Hono HTTP 运行环境 |
| `packages/contracts` | Intent、Run、Evidence、Replay、序列化与兼容性共享模式 |
| `packages/moss-bridge` | Moss/Kuru 运行环境加载、实时 Evidence 适配、标准化与溯源检查 |
| `packages/orchestrator` | Agent Flow、Action Gate、再次检查生命周期与应用编排 |
| `packages/risk` | 确定性的 P0 规则评估与集中式 Decision 策略 |
| `fixtures` | 已记录的原始/标准化 Evidence 与 Replay 样例 |
| `docs` | 产品、研究、计划、集成、方法论与 ADR 文档 |
| `scripts` | 确定性及实时 Kuru 冒烟/验收工具 |

当前工具链为 Node.js 22、pnpm、TypeScript、React、Vite、Three.js、Hono、Vitest 和 Biome。

## 仓库结构

```text
apps/                  前端与后端应用
packages/              契约、Moss bridge、编排与风险模块
docs/                  产品、研究、计划、集成与 ADR 文档
fixtures/              Evidence 与 Replay 样例
scripts/               冒烟测试与仓库验证工具
```

## 安装与本地开发

环境要求：Node.js 22、兼容 pnpm 11 的工具和 Git。

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

启动前端：

```bash
pnpm --filter @parallax/web dev
```

使用 `#/` 访问落地页，使用 `#/analyze` 访问 MVP。若要在本地运行报价/检查请求，请配置 `.env`，并在另一个终端启动 API：

```bash
pnpm --filter @parallax/api start
```

本地 Vite 服务器会把 `/api/*` 代理到 `http://127.0.0.1:8787`。

## 环境配置

`.env.example` 是环境变量的权威清单。

| 变量 | 用途 |
| --- | --- |
| `MONAD_RPC_URL` | 后端实时报价/检查使用的只读 Monad RPC |
| `MOSS_RPC_URL` | 实时冒烟命令使用的只读 RPC |
| `MOSS_RUNTIME_VERSION` | 预期的 Moss 运行环境版本 |
| `MOSS_RUNTIME_REVISION` | 预期的不可变 Moss Git 修订版 |
| `MOSS_RUNTIME_PATH` | 已构建、固定 Moss 检出目录的绝对路径，用于启用实时 Kuru Agent Flow |
| `PARALLAX_TOKEN_REGISTRY_JSON` | 后端标准化使用的可信代币元数据 |
| `CORS_ORIGIN` | 允许调用 API 的浏览器来源 |
| `RUN_STORE_BACKEND` | 默认 `memory`；完成迁移和验证后才使用 `postgres` |
| `DATABASE_URL` | `RUN_STORE_BACKEND=postgres` 时所需的 PostgreSQL URL |
| `HOST` / `PORT` | Node HTTP 监听配置 |

实时 Moss 运行要求 `MOSS_RUNTIME_PATH` 保留 `.git` 元数据，并与配置的版本/修订版匹配。缺少该路径时，实时报价/检查会以 `UNSUPPORTED` 明确关闭；记录回放仍是分开的路径。

请勿提交 RPC 凭据或已经填入真实值的 `.env` 文件。

## 开发命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:acceptance
pnpm test:integration
pnpm --filter @parallax/web build
pnpm smoke:kuru
pnpm smoke:kuru:live
```

实时冒烟需要固定 Moss 运行环境与只读 RPC 配置，不属于默认 CI 路径。

## API 概览

### `POST /api/quote`

执行精确输入的实时报价边界，返回报价、明确的不可用/无路径结果或范围受限错误；不会执行完整模拟，也不会创建 Decision。

### `POST /api/check`

对标准化 Swap Intent 执行后端签名前检查。再次检查通过 `parentRunId` 关联，并且只允许修改一个 Intent 条件。没有配置实时 Moss 时，接口返回明确的 `UNSUPPORTED` 错误与 `UNKNOWN` Run，不会替换为 Replay。

### `GET /api/runs/:runId`

按 ID 返回一个已持久化的 Check Run。持久化 PostgreSQL 存储可以在重启后恢复已完成/失败的 Run；不会为进行中的 Run 伪造 Receipt。

### `GET /api/replay/:id`

返回冻结的记录回放样例。它保留记录中的溯源信息，但不是当前实时 Run，也不能作为实时 Check 的父 Run。

请求结构、错误映射、CORS 与启动说明请参阅[前端 API 交接文档](docs/integration/api-frontend-handoff.md)。

## 部署

公开前端部署在 Vercel，并通过同源 `/api/*` 重写转发到已部署的 Render 后端。可用性仍取决于外部后端、RPC 和固定 Moss 运行环境；该部署不代表生产就绪，也不扩大已核验的协议范围。

## 文档导航

### 产品

- [产品需求文档](docs/product/prd.md)
- [产品交付规范](docs/product/product-delivery.md)

### 研究

- [用户研究](docs/research/user-research.md)
- [竞品分析](docs/research/competitive-analysis.md)
- [市场定位与证据研究](docs/research/market-positioning-and-evidence.md)
- [Arbitrum 生态与技术栈](docs/research/arbitrum-ecosystem-and-stack.md)

### 计划

- [Arbitrum Open House 计划索引](docs/planning/arbitrum-open-house/README.md)
- [02 总览](docs/planning/arbitrum-open-house/02-overview.md)
- [02-A 架构边界](docs/planning/arbitrum-open-house/02-A-architecture-boundaries.md)
- [02-B Provider 实施](docs/planning/arbitrum-open-house/02-B-provider-implementation.md)
- [02-C 职责与协作](docs/planning/arbitrum-open-house/02-C-ownership-collaboration.md)
- [02-D 验收与时间](docs/planning/arbitrum-open-house/02-D-acceptance-timeline.md)

### 集成与证据

- [前端 API 交接文档](docs/integration/api-frontend-handoff.md)
- [后端 P0 验收矩阵](docs/integration/backend-p0-acceptance.md)
- [Moss/Kuru 实时运行环境](docs/integration/moss-kuru-live-runtime.md)
- [P0 规则与原因到操作规范](docs/risk-methodology/p0-rule-and-reason-action-spec.md)
- [架构决策记录](docs/adr/)

## 测试与质量门禁

GitHub Actions 使用 Node.js 22，执行依赖安装、lint、typecheck、确定性测试和 Node 集成测试。实时 RPC/Moss 冒烟测试需要外部运行环境，因此单独运行。

## 团队

| 成员 | GitHub | 角色 |
| --- | --- | --- |
| Kai | [@chin0312](https://github.com/chin0312) | Product Owner |
| Rei | [@rainypilgrimage](https://github.com/rainypilgrimage) | Contract Owner |
| Jie | [@jzhao0](https://github.com/jzhao0) | Provider Owner |
| Clare | [@brightheartma](https://github.com/brightheartma) | Backend Owner |
| Antony | [@antony819](https://github.com/antony819) | Frontend Owner |

## 协作

- 从最新 `main` 创建短期分支开始工作；
- 将实现、Contract 语义、Product 语义和 Evidence 陈述保留在各自负责的层中；
- 将研究视为背景依据；实现行为以代码和已合并的产品文档为准；
- 不得使用 Replay 或 mock 数据证明实时用户决策；
- 创建 PR 前运行相关检查，并邀请变更语义对应的负责人审查。

## 免责声明

Parallax 是用于解释和验证范围受限的签名前决策的实验性软件。它不提供投资建议，也不签名、广播、执行或托管交易。Evidence 可能不完整或不可用；用户必须自行核验交易细节，并理解 `PROCEED` 仅在已检查范围内成立，不构成安全保证。

## 许可证

仓库当前没有声明许可证文件。是否采用 OSS 许可证仍由团队决定。
