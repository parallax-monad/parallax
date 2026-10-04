<div align="center">

<img src="docs/assets/parallax-logo.png" alt="Parallax 标志" width="200" />

# Parallax

### 签名前，先知道下一步该怎么做。

面向链上交易的预执行决策层。

[在线演示](https://parallax-web-snowy.vercel.app/) ·
[演示文稿](https://parallax-monad.github.io/parallax/parallax-demo-day.html) ·
[产品演示视频](https://youtu.be/klOKwyWgiZU) ·
[项目路演视频](https://youtu.be/Dp_Ewlud5QU) ·
[文档](docs/README.md) ·
[GitHub 仓库](https://github.com/parallax-monad/parallax)

<sub>当前实现：Arbitrum Sepolia · Camelot V3 · TypeScript</sub>

<sub><a href="./README.md">English</a> · 简体中文</sub>

</div>

## 为什么需要 Parallax？

DEX 和聚合器提供报价与路由，钱包和安全产品提供交易预览、警告与交易上下文，模拟工具则展示执行行为。这些信息都很有价值，但用户仍需要自己判断：现有证据是否足以支持自己的交易目标？

一笔交易即使能够成功执行，也可能无法实现用户原本期待的结果。交易检查失败或存在不确定性时，用户也可能不知道哪种调整才相关。Parallax 聚焦这段决策缺口：让证据、检查范围和可能的下一步更容易理解，并由用户明确调整后再次检查。

## Parallax 能做什么

- 基于可用的执行证据，检查已报价并准备好的未签名交易。
- 给出范围明确的结果：`PROCEED`、`ADJUST`、`STOP` 或 `UNKNOWN`。
- 分开展示观察结果、有证据支持的原因、证据状态和用户明确提出的约束，不会把缺失数据包装成确定结论。
- 将决定权留给用户：Parallax 不会签名或提交 Swap 交易。
- 保存 Run，让用户之后可以取回历史结果，并比较明确发起的再次检查。

`PROCEED` 只表示在已检查范围内没有发现阻断证据，不保证交易安全或执行成功。`UNKNOWN` 不是通过。只有新的子检查提供充分证据后，候选调整才能被视为已验证的改善。

## 工作流程

```text
Swap 意图
→ 报价与已准备的未签名交易
→ 执行证据
→ 可解释、范围明确的决策
→ 用户主动调整
→ 重新检查并比较 Run
```

## 构建于 Arbitrum

当前真实测试网路径使用 Arbitrum Sepolia（`421614`）和 Camelot V3，支持真实测试网报价、精确的未签名交易准备，以及以 Native RPC 为主的执行证据路径。Trace RPC 提供补充性的深度证据；它不会取代 Native RPC 基线，也不会单独改变 Risk 结果。

结果会说明检查了什么、哪些范围仍未知或不可用，以及相关来源和链上状态上下文。Sepolia 上的代币余额和价格属于测试网数据，不能代表 Arbitrum One 的市场价格。本项目不声称支持 Arbitrum One 主网。

## 可选的链上 Decision Registry

Parallax 已在 Arbitrum Sepolia 部署了可选的 Decision Registry：

- 合约：[`0xdfc1f61e75fd551b9c309ec0bfae015adf6fe359`](https://sepolia.arbiscan.io/address/0xdfc1f61e75fd551b9c309ec0bfae015adf6fe359)
- [部署交易](https://sepolia.arbiscan.io/tx/0x46cd3fd97086a40c157be0cdc50baa9a40db9c24417d723cc5dd6f08e6e000f6)
- [决策证明交易](https://sepolia.arbiscan.io/tx/0x3e40db4fdc33b8bf3b726fa7f8a60049e0518c19e6cbc98eb69c20932f374af0)

操作人员可以通过 Backend CLI，为已完成且已持久化的 Run 锚定一项承诺。这是可选、非阻塞的流程，不会在每次 `/api/check` 后自动触发。指定的操作人员控制 attestor 并提交 Registry 交易；用户不需要连接钱包或签署证明交易。Attestor 只签署 Registry 交易，不签署用户的 Swap。

Registry 仅保存经过域分隔的 Run key、承诺哈希和必要的事件元数据，不保存完整 Run 或其证据。持有对应链下记录的人可以重新计算并核对承诺，以验证记录完整性；这不能证明底层证据真实、Risk 评估正确或 Swap 安全。操作与验证边界见 [Decision Registry 指南](contracts/decision-registry/README.md)。

## 开发者集成

仓库包含一个类型安全的 TypeScript SDK 和公开 HTTP API。SDK 支持报价、检查、Run 查询、再次检查和账户状态查询；它不会重复实现 Risk 或 Provider 逻辑。SDK 代码位于本仓库中；本文不声称它已发布到 npm。

- [SDK 指南](packages/sdk/README.md)
- [API 与前端集成参考](docs/integration/api-frontend-handoff.md)
- [Decision Registry 指南](contracts/decision-registry/README.md)

API 与 SDK 为未来将签名前决策流程嵌入钱包、DEX、聚合器和 DeFi 应用提供基础。这些属于集成机会，不代表已经建立第三方合作。

## 未来方向

1. **扩大覆盖范围** — 支持更多资产、协议、交易类型和执行环境。
2. **嵌入现有工作流** — 通过可复用的 API 与 SDK 接入钱包、DEX、聚合器和开发者应用，探索潜在的 B2B/API 交付模式。
3. **面向 Agent 的工作流** — 探索未来的 MCP 兼容接口与机器可读、范围受限的决策输出，供 AI Agent 编排流程使用。目前不声称已有 MCP 服务或自主交易执行能力。

## 快速开始

环境要求：Node.js 22 和 pnpm。

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

对于当前 Arbitrum Sepolia 路径，请配置 `ARBITRUM_RPC_URL` 和包含可信 Arbitrum 代币元数据的 `PARALLAX_TOKEN_REGISTRY_JSON`。凭据仅保存在本地环境配置中，切勿提交。

即使运行 Arbitrum 路径，API 启动配置目前仍会校验旧版共享配置中的有效 `MONAD_RPC_URL`，以及非空的 `MOSS_RUNTIME_VERSION` / `MOSS_RUNTIME_REVISION`。这是配置校验要求，不表示当前产品路径使用 Monad、Kuru 或 Moss。`MOSS_RUNTIME_PATH` 为可选项，可以留空；运行 Arbitrum 路径不需要 Moss 代码仓库。各变量的区别请见 [`.env.example`](.env.example)。

在两个终端分别启动 API 和 Web 应用：

```bash
pnpm --filter @parallax/api start
pnpm --filter @parallax/web dev
```

Vite 会将 `/api/*` 请求代理到本地 API。配置和请求说明见 [`.env.example`](.env.example)、[API 集成参考](docs/integration/api-frontend-handoff.md)和 [SDK 指南](packages/sdk/README.md)。

常用检查命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @parallax/web build
```

## 当前架构

| 区域 | 职责 |
| --- | --- |
| `apps/web` | Web 体验与 API 结果展示 |
| `apps/api` | 报价、检查、账户状态、Run 与编排 API |
| `packages/contracts` | 请求、证据、Run 与响应的共享 Schema |
| `packages/risk` | 确定性的 Risk 与 Verdict 评估 |
| `packages/orchestrator` | Provider 执行以及 Run / 再次检查编排 |
| `packages/sdk` | 公开 API 的类型安全客户端 |
| `contracts/decision-registry` | 可选的链上 Decision Registry |
| `fixtures` | 确定性测试数据与保留的证据记录 |
| `docs` | 产品、集成、研究与项目历史参考 |

## 团队

| 成员 | GitHub | 负责方向 |
| --- | --- | --- |
| Kai | [@chin0312](https://github.com/chin0312) | 产品策略、研究与产品方向 |
| Rei | [@rainypilgrimage](https://github.com/rainypilgrimage) | Core Contract 定义、Risk 语义与决策规则 |
| Jie | [@jzhao0](https://github.com/jzhao0) | Provider 集成与执行证据 |
| Clare | [@brightheartma](https://github.com/brightheartma) | Backend 基础设施、API 与持久化 |
| Antony | [@antony819](https://github.com/antony819) | 前端与用户体验 |

## 使用边界

Parallax 仍是实验性软件，本文所述 Arbitrum 集成仅限测试网。证据可能不完整或不可用；用户应自行检查交易细节。Parallax 不托管资产、不签名、广播或执行用户的 Swap、不提供投资建议，也不能替代独立安全审计。

## 许可证

仓库目前没有声明许可证。代码公开可见不代表可以不受限制地复用；许可证仍需由团队决定。
