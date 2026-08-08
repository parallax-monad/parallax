<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

# Parallax

Parallax 是面向 Monad 兑换交易、由 Moss 驱动的只读签名前决策层。

> Moss 告诉我们将会发生什么。Parallax 帮助用户判断下一步该做什么。

## 项目演示

- [体验在线应用](https://parallax-web-snowy.vercel.app)
- [查看 Demo Day 演示文稿](https://parallax-monad.github.io/parallax/parallax-demo-day.html)
- [观看产品演示视频](https://www.youtube.com/watch?v=j43WqH6TrTE)

无需演示账号。公开前端通过 Vercel API 重写连接到已部署的后端。
该连接仍处于实验阶段、保持只读，并仅限文档所述的 Moss/Kuru 范围；
它不代表系统已达到生产就绪状态，也不代表交易执行已完成。

## 产品主张

兑换界面可以展示报价、警告和模拟结果，却不一定能把已经观察到的原因与边界明确的下一步行动连接起来。Parallax 将可追溯的执行证据转化为带有范围说明的决策：用户可以检查决策依据，并在有证据支持时修改一个相关条件后再次检查。

核心流程如下：

```text
交易意图
→ Moss 报价、操作与模拟证据
→ 标准化证据
→ 原因
→ PROCEED / ADJUST / STOP / UNKNOWN
→ 相关或无关的调整
→ 可选的再次检查
→ 比较上一次运行与新运行
```

`UNKNOWN` 不是通过。`PROCEED` 表示在已检查范围内没有发现阻断证据；它不构成安全保证或投资建议。

## 主要功能

- 接收结构化且未签名的兑换交易意图；
- 获取并标准化报价、已准备操作、模拟与溯源证据；
- 执行确定性的 P0 规则，并将 Integration Error 与交易本身的不确定性分开；
- 展示 `PROCEED`、`ADJUST`、`STOP` 或 `UNKNOWN`，同时披露已检查、未知和未检查范围；
- 将经过验证的相关调整与无关修改分开；
- 支持记录回放，以及仅修改一个条件的受限再次检查对比；
- 始终保持只读：不签名、不广播、不执行、不托管，也不修改钱包状态。

## 演示流程

落地页位于 `#/`。选择 **体验 Demo** 即可在 `#/analyze` 打开钱包式 MVP。

MVP 接收受支持的兑换交易意图，请求报价，执行签名前检查，展示决策结果背后的证据与检查范围，并在适用时提供记录回放或受限的再次检查。

`main` 上的前端适配层会调用 `POST /api/quote`、`POST /api/check` 和 `GET /api/replay/:id`。本地 Vite 开发服务器会把这些路径代理到 `127.0.0.1:8787` 上的 API 进程。

## 当前实现状态

| 范围 | `main` 当前状态 |
| --- | --- |
| 落地页体验 | 已实现英文和简体中文文案，以及交互式 Three.js 证据星图 |
| 钱包式前端 MVP | 已在 `#/analyze` 实现报价、检查、回放、证据和再次检查界面 |
| 前端/API 适配层 | 已接入 `/api/quote`、`/api/check` 和 `/api/replay/:id`；本地 Vite 开发环境会代理到 API |
| 共享契约与决策规则 | 已实现当前 P0 范围，并有自动化测试覆盖 |
| 后端 API 与编排 | 已通过 Hono 实现进程内运行记录存储、实时报价/检查边界和记录回放 |
| 实时 Moss/Kuru 后端 | 已针对固定 Kuru 运行环境和经验证范围实现；需要显式配置运行环境与 RPC |
| Vercel 公开演示 | 前端可公开访问，并通过 Vercel 重写将同源 `/api/*` 请求转发到已部署的 Render 后端 |
| 签名、广播、执行或托管 | 明确不实现 |

经验证的实时证据仅限文档所述的固定 Kuru MON → USDC 路径与运行环境范围。它不能证明所有代币对、协议、资产行为、运行环境修订版或未来市场条件都受支持。

## P0 范围与明确排除项

P0 面向一个工作假设中的轻度 DeFi 用户：该用户即将签署 Monad 兑换交易，或正在失败后重试。P0 覆盖由证据支持的原因、检查范围披露、边界明确的决策结果、经过验证的操作可见性，以及可选的再次检查对比。

P0 不提供：

- 投资建议，或“交易安全”的承诺；
- 最优价格、最优路径或全市场聚合；
- 完整的协议、代币或智能合约安全审计；
- 自动签名、广播、执行或托管；
- 自主 AI 判断；
- RPC、Moss 或必要证据不可用时的实时可用性保证。

用户提供的 `Minimum Received` 是显式接受边界。Parallax 不会降低该数值来制造 `PROCEED`。

## 架构与技术栈

| 路径 | 职责 |
| --- | --- |
| `apps/web` | React 18 + Vite 前端、落地页、钱包式 MVP、API 适配层与 Three.js 可视化 |
| `apps/api` | 用于实时报价/检查与记录回放的 Node.js/Hono HTTP 运行环境 |
| `packages/contracts` | 共享模式、标准化 Intent/Run 类型、Evidence、Replay 与序列化 |
| `packages/moss-bridge` | Moss/Kuru 运行环境加载、实时执行证据适配、标准化与溯源检查 |
| `packages/orchestrator` | Agent Flow、再次检查生命周期、Action Gate 与应用编排 |
| `packages/risk` | 确定性的 P0 规则评估与集中式决策策略 |
| `fixtures` | 已记录的原始/标准化证据与回放样例 |
| `docs` | 产品、研究、风险方法论、集成、ADR 与运行环境文档 |
| `scripts` | 确定性及实时 Kuru 冒烟与验收工具 |

主要工具链包括 Node.js 22、pnpm、TypeScript、React、Vite、Three.js、采用 Node 服务器运行环境的 Hono、Vitest 和 Biome。

## 仓库结构

```text
apps/
  api/                 后端 API 与运行环境组合
  web/                 落地页与钱包式前端 MVP
packages/
  contracts/           共享契约与序列化
  moss-bridge/         Moss/Kuru 适配与标准化
  orchestrator/        Agent Flow 与应用生命周期
  risk/                规则与决策逻辑
fixtures/              证据与回放样例
docs/                  产品、研究、集成、方法论与 ADR
scripts/               冒烟测试与仓库验证脚本
```

## 安装与本地开发

环境要求：

- Node.js 22；
- 与 pnpm 11 兼容的工具；
- Git。

安装依赖并创建本地环境文件：

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

启动前端：

```bash
pnpm --filter @parallax/web dev
```

打开 Vite 提供的地址，使用 `#/` 访问落地页，或使用 `#/analyze` 访问 MVP。

如需在本地使用报价与检查请求，请配置 `.env`，并在另一个终端启动 API：

```bash
pnpm --filter @parallax/api start
```

Vite 开发服务器会把 `/api/*` 代理到 `http://127.0.0.1:8787`。

## 环境配置

`.env.example` 是环境变量的权威清单。

| 变量 | 用途 |
| --- | --- |
| `MONAD_RPC_URL` | 后端实时报价/检查请求使用的只读 Monad RPC |
| `MOSS_RPC_URL` | 本地实时冒烟命令使用的只读 RPC；后端不会自动读取 |
| `MOSS_RUNTIME_VERSION` | 预期的 Moss 软件包/运行环境版本 |
| `MOSS_RUNTIME_REVISION` | 预期的不可变 Moss Git 修订版 |
| `MOSS_RUNTIME_PATH` | 指向已构建、固定 Moss Git 检出目录的可选绝对路径；用于启用实时 Kuru Agent Flow |
| `PARALLAX_TOKEN_REGISTRY_JSON` | 后端标准化使用的可信代币元数据 |
| `CORS_ORIGIN` | 允许调用 API 的浏览器来源 |
| `HOST` / `PORT` | Node HTTP 监听配置 |

实时后端要求 `MOSS_RUNTIME_PATH` 指向的 Moss 检出目录保留 `.git` 元数据、匹配已配置的版本与修订版，并能由安装了 `git` 的运行环境读取。如果没有该路径，实时报价/检查请求会以 `UNSUPPORTED` 明确关闭；记录回放始终是分开的、带有明确标签的路径。

请勿提交 RPC 凭据或已经填入真实值的 `.env` 文件。

## 开发命令

```bash
pnpm lint                         # Biome 检查
pnpm typecheck                    # 根目录与工作区 TypeScript 检查
pnpm test                         # 确定性 Vitest 测试套件
pnpm test:acceptance              # 后端 P0 验收矩阵
pnpm test:integration             # 真实 Node 监听器集成测试
pnpm --filter @parallax/web build # 生产前端构建
pnpm smoke:kuru                   # 确定性 Kuru 冒烟测试
pnpm smoke:kuru:live              # 外部实时 Moss/RPC 冒烟测试
```

`pnpm smoke:kuru:live` 需要固定的 Moss 运行环境与只读 RPC 配置，因此不属于默认 CI 路径。

## API 概览

### `POST /api/quote`

在提交表单前执行精确输入的实时报价边界。它会返回可用报价、明确的无路径/不可用结果，或范围受限的错误。它不会执行完整模拟，也不会生成交易决策结果。

### `POST /api/check`

执行由后端负责的签名前检查。请求携带标准化的兑换交易意图；处理成功后返回已完成或 Integration Error 运行封装。再次检查继续使用同一端点，通过 `parentRunId` 关联，并且只允许修改一个交易意图字段。

如果没有配置实时 Moss，该端点会返回明确的 `UNSUPPORTED` 应用错误与 `UNKNOWN` 运行结果。它绝不会用记录回放替代实时结果。

### `GET /api/replay/:id`

返回冻结的记录回放样例。回放保留已记录的溯源信息，但它不是当前实时运行，也不能作为实时检查的父运行。

请求结构、错误映射、CORS 与启动说明请参阅[前端 API 交接文档](docs/integration/api-frontend-handoff.md)。

## 部署

前端演示版本通过 Vercel 公开部署：

**[https://parallax-web-snowy.vercel.app](https://parallax-web-snowy.vercel.app)**

无需演示账号。公开前端会通过 Vercel 将同源 `/api/*` 请求转发到已部署的
Render 后端。文档所述的 Kuru MON → USDC 报价流程已通过该公开入口验证。
服务可用性仍取决于外部后端、RPC 与固定的 Moss 运行环境；该部署不代表
系统已达到生产就绪状态，也不代表支持更广泛的协议范围。

## 文档导航

### 产品

- [产品需求文档](docs/product/prd.md)
- [产品交付规范](docs/product/product-delivery.md)

### 研究

- [用户研究](docs/research/user-research.md)
- [竞品分析](docs/research/competitive-analysis.md)

### 集成与证据

- [前端 API 交接文档](docs/integration/api-frontend-handoff.md)
- [后端 P0 验收矩阵](docs/integration/backend-p0-acceptance.md)
- [Moss/Kuru 实时运行环境](docs/integration/moss-kuru-live-runtime.md)
- [P0 规则与原因到操作规范](docs/risk-methodology/p0-rule-and-reason-action-spec.md)
- [架构决策记录](docs/adr/)

## 测试与质量门禁

GitHub Actions 使用 Node.js 22 并执行：

```text
pnpm install --frozen-lockfile
→ pnpm lint
→ pnpm typecheck
→ pnpm test
→ pnpm test:integration
```

实时 RPC/Moss 冒烟测试因需要外部运行环境配置而明确独立运行。证据与运行环境相关陈述必须始终限制在具体记录样例与固定修订版的范围内。

## 团队

| 成员 | GitHub | 负责范围 |
| --- | --- | --- |
| Kai | [@chin0312](https://github.com/chin0312) | 产品、研究与演示 |
| Rei | [@rainypilgrimage](https://github.com/rainypilgrimage) | 产品、风险方法论与研究 |
| Jie | [@jzhao0](https://github.com/jzhao0) | Moss 集成与风险引擎 |
| Clare | [@brightheartma](https://github.com/brightheartma) | API、后端、编排与部署 |
| Antony | [@antony819](https://github.com/antony819) | 网页前端 |

## 协作

- 从最新 `main` 创建短期分支开始工作。
- 运行环境、契约、产品文案与证据陈述应保留在各自负责的层中。
- 不得使用记录回放或模拟数据证明实时用户决策。
- 创建 PR 前运行相关检查。
- 根据变更涉及的文件与语义请求对应负责人审查。

## 免责声明

Parallax 是用于解释和验证签名前决策的实验性软件。它不提供投资建议，也不签名、广播、执行或托管交易。证据可能不完整或不可用；用户必须自行验证交易细节，并理解 `PROCEED` 仅在已检查范围内成立，不构成安全保证。
