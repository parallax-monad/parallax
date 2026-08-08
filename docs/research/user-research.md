# Parallax User Research Reference

---

## 1. Purpose

This document consolidates Parallax's existing user interviews and internal research notes into one repository-ready user research reference.

It answers five questions:

1. Who experiences the transaction-decision problem Parallax is addressing?
2. At what moment does the problem become important?
3. What do users currently understand, misunderstand, or ignore?
4. Which findings are supported by interviews or public evidence, and which remain hypotheses?
5. What should the team test next before making stronger product or market claims?

Parallax is currently framed as a transaction decision layer for Monad swaps:

> **Moss tells us what will happen. Parallax helps the user decide what to do next.**

This research therefore focuses on the user decision before signing or retrying a transaction—not on whether Parallax has more features than another product.

---

## Related documents

- [Product Requirements Document](../product/prd.md) — converts the research findings into the current P0 product decisions.
- [Competitive Analysis](./competitive-analysis.md) — evaluates whether existing products already address the observed user problems.

---

## 2. Research Scope and Evidence Standard

### 2.1 Included evidence

This synthesis uses two evidence groups:

**First-party research**

- 8 documented user perspectives:
  - 3 external DeFi users with different experience levels;
  - 5 team-member perspectives used as exploratory or internal evidence.
- Existing notes on swap behavior, decision heuristics, losses, failure handling, trust, and willingness to use a risk tool.
- Existing candidate-problem validation plans and prototype-task criteria.

**Second-round public research**

- Consumer surveys on crypto awareness, usage, risk tolerance, and wallet familiarity;
- Human-computer interaction research on transaction comprehension and signing decisions;
- Publicly documented transaction-failure categories and recovery actions;
- Monad's official account and reserve-balance mechanics.

Public product support pages are referenced only to identify user-facing failure categories and possible recovery decisions. They are **not** used here to compare products or assess competitive coverage.

### 2.2 Evidence levels

| Level | Evidence type | What it may support |
| --- | --- | --- |
| **A** | Observed past behavior, transaction records, incident data, product-flow evidence, controlled experiment | The behavior or problem exists |
| **B** | Repeated feedback across target users, repeated public reports, structured survey evidence | Directional prioritization |
| **C** | One interview, one user story, expert judgment, internal team experience | A hypothesis worth testing |
| **D** | Team assumption, AI inference, demo concept | A question only; not a validated need |

### 2.3 Important limitations

- The interview sample is small and partially based on convenience sampling.
- Five of eight perspectives are from team members and must not be weighted equally with external target users.
- The current evidence does not establish market size, pain-point frequency, willingness to pay, or retention.
- Public crypto surveys are broader than Monad DeFi and cannot be directly treated as Parallax demand.
- Official failure documentation shows that distinct failure modes exist; it does not show how frequently ordinary users experience or correctly understand them.
- Technical reproducibility of a scenario is not the same as user-demand validation.

---

## 3. Existing Research Sample

For a public repository, participants are anonymized as `P01`–`P08`.

| ID | Source | User segment | Relevant behavior | Main decision heuristic | Research implication |
| --- | --- | --- | --- | --- | --- |
| **P01** | External | Intermediate DeFi user | Has used Uniswap, PancakeSwap, Pendle, and Aave | Trusts known protocols, built-in warnings, token addresses, liquidity, volume, explorers, and experienced friends | Demand increases for unfamiliar tokens, low liquidity, and unfamiliar protocols; familiar small swaps create little motivation to open a separate tool |
| **P02** | External | Low-frequency crypto/DeFi user | Uses DeFi only every few weeks; limited swap, lending, staking, or LP activity | Thinks first about fees, speed, and whether the platform is reputable | High sensitivity to friction; unlikely to configure complex policies or seek a standalone risk report |
| **P03** | External | Professional DeFi/yield user | Uses aggregators, lending markets, Pendle, perpetuals, and yield strategies | Evaluates contract risk and protocol-specific market parameters | Generic swap risk is not the strongest professional use case; any risk model must be evidence-specific rather than generic |
| **P04** | Internal | Beginner with basic judgment | Prioritizes expected output and established DEX reputation | Wants a reasonable result and a familiar venue | The user goal is transaction completion, not learning a complete risk framework |
| **P05** | Internal | Trust- and safety-oriented user | Treats an unfamiliar tool as a possible risk itself | Prefers trusted or embedded assistance | Parallax must state that it does not request keys, sign, broadcast, or custody funds, and must make evidence inspectable |
| **P06** | Internal | Beginner with weak risk vocabulary | Does not know which swap risks should be checked | Seeks expert or AI guidance | Default protections are more realistic than asking beginners to configure many thresholds |
| **P07** | Internal | Task-oriented beginner | Swaps mainly to obtain a token unavailable on a centralized exchange | Focuses on whether the transaction can complete | The first information layer should show payment, expected receipt, material loss, and the next action—not specialist categories |
| **P08** | Internal | User with a past loss experience | Repeated conversions without understanding gas and route loss; learned only after value had fallen materially | Investigated only where the flow became blocked | The strongest internal story is not malicious activity but executing a transaction without understanding why value was lost |

---

## 4. Interview Findings

### 4.1 Users rely on shortcuts rather than formal risk models

Across the sample, users rarely describe decisions using formal categories such as protocol risk, execution risk, liquidity risk, or contract risk.

They more often use practical shortcuts:

- Is the protocol familiar?
- Is the token address correct?
- Is liquidity visibly sufficient?
- Does the interface show a warning?
- Is the output plausible?
- Has a trusted friend or community used it?
- Can I complete the task quickly?

**Implication:** Parallax should not require users to learn the team's internal risk taxonomy before receiving value.

### 4.2 The entry-point paradox

The sample reveals a consistent tension:

- Beginners are more likely to need protection but are less likely to know that a separate risk tool exists or what to ask it.
- Intermediate users already rely on protocol reputation, interface warnings, and basic checks.
- Professional users can understand detailed evidence but often have established workflows and do not need an additional page for an ordinary swap.

This creates the central distribution and usability problem:

> **The users who most need a guardrail may not search for one, while the users most capable of interpreting a full report may not need one for routine swaps.**

**Directional implication:** The natural long-term entry point is inside a wallet, DEX, agent, or transaction workflow. A standalone web demo can prove the interaction, but it should imitate an embedded pre-sign step rather than a research dashboard.

### 4.3 Users want a decision, not a report

The repeated user questions are concrete:

- What will I pay?
- What will I receive?
- Why is the result lower than expected?
- Will this create an approval?
- Can the transaction execute?
- Does successful simulation mean the result is acceptable?
- Which change is relevant?
- Which change will not help?
- Should I retry, adjust, or stop?

The product value is therefore not the amount of information displayed. It is whether evidence changes the next action.

### 4.4 Failure creates a reason-to-action gap

The current primary problem hypothesis is:

> A Monad or EVM user has received a failed swap or simulation result and is preparing to retry, but cannot determine whether changing slippage, priority fee, amount, route, balance, allowance, or token pair is relevant.

The user may then:

- retry without changing the cause;
- increase slippage unnecessarily;
- increase priority fee when the problem is unrelated to inclusion speed;
- spend more time searching communities or explorers;
- abandon the transaction;
- mistake an infrastructure or evidence failure for a transaction-risk result.

The key unmet need is not simply “explain the error.” It is:

> **Connect the observed failure to a bounded recommendation and explicitly identify irrelevant adjustments.**

### 4.5 Executable is not necessarily acceptable

A separate but related pain point appears when a transaction can execute but violates the user's explicit boundary.

Examples include:

- expected output below a user-declared minimum;
- a stale amount from a previous attempt;
- an output with an implausible order of magnitude;
- an unresolved warning or evidence gap;
- a technically valid action whose result the user did not intend.

This does not justify an AI-generated opinion about what the user “should” accept. The acceptance boundary must come from:

- a user-declared `Minimum Received`;
- another explicit transaction constraint;
- a trusted, documented reference;
- or an `UNKNOWN` result when the evidence is insufficient.

### 4.6 Trust is itself part of the user problem

A pre-sign tool asks the user to trust an interpretation at a high-stakes moment. An unfamiliar application can therefore create additional anxiety.

The user-facing trust boundary should be explicit:

- no private key or seed phrase;
- no signing;
- no broadcasting;
- no custody;
- no silent upgrade from missing evidence to a positive verdict;
- raw evidence available on demand;
- clear distinction between Live, Recorded Replay, Demo, Mock, Derived, and Unknown evidence.

---

## 5. Second-Round Public User Research

### 5.1 Crypto awareness is high, but understanding and workflow maturity remain uneven

The UK Financial Conduct Authority's 2025 consumer research used a nationally representative phase-one sample of 2,353 adults and a 1,053-person boost sample of current and former cryptoasset users. It reported 91% cryptoasset awareness, 58% stablecoin awareness among crypto users, and centralized exchanges as the most common acquisition channel at 73%.[^fca-2025]

A 2024 Consensys/YouGov survey covered 18,652 respondents across 18 countries. It reported 93% crypto awareness, while knowledge of decentralization and Web3 concepts remained uneven. Among respondents aware of Web3, 33% reported having used a Web3 wallet.[^consensys-2024]

**Interpretation for Parallax**

- Crypto familiarity should not be equated with transaction-level comprehension.
- A user may know tokens, wallets, and major brands while still lacking a reliable model of calldata, approvals, routes, execution evidence, or failure causes.
- Parallax should not position itself as introductory crypto education. The narrower problem is helping a user make one transaction decision with clearer, evidence-backed reasoning.

**Caveat:** These surveys are broad crypto studies, not Monad swap studies, and do not prove demand for Parallax.

### 5.2 Transaction-signing interfaces can hide the meaning users need

The 2026 preprint *What I Sign Is Not What I See* reports formative studies in which users misread critical transaction parameters, underestimated high-risk signatures, and relied on superficial familiarity rather than transaction intent. In a between-subjects evaluation with 128 participants, a semantic transaction decoder improved risky-signature identification, clarity, confidence, and cognitive workload.[^semantic-decoder]

Earlier peer-reviewed work presented at USENIX SOUPS studied 29 cryptocurrency users and found that misconceptions in users' mental models affected security and privacy behavior, while available tools did not reliably counter those misconceptions.[^mental-models]

**Interpretation for Parallax**

- Raw transaction data and generic warnings are not enough when users cannot connect them to intent.
- The explanation should be semantic and task-based:
  - what the transaction will do;
  - what evidence supports that conclusion;
  - whether it matches the stated intent;
  - what action follows.
- Evidence should remain available, but the primary interface should not require users to decode it themselves.

### 5.3 Better warning design can improve comprehension, but comprehension is not behavior change

A 2026 Central Bank of Ireland randomized experiment found that behaviorally informed crypto-risk warnings increased measured risk comprehension by approximately 5% and risk perception by approximately 4%.[^cbi-warning]

**Interpretation for Parallax**

Warnings can help, but the product should test a stronger outcome:

- Did the user choose a safer or more relevant action?
- Did the user stop changing an irrelevant parameter?
- Did the user understand why an adjustment would or would not help?
- Did the rerun confirm improvement?

A warning that users acknowledge but ignore is not sufficient validation.

### 5.4 Public failure taxonomies show that “swap failed” covers materially different causes

Public transaction-support documentation distinguishes causes such as:

- slippage tolerance exceeded;
- quote or deadline expired;
- insufficient native token for execution costs;
- insufficient token balance;
- insufficient allowance;
- token transfer restrictions or transfer fees;
- missing transaction value;
- out-of-gas execution;
- unavailable route;
- unknown or infrastructure failure.[^uniswap-failure][^uniswap-slippage][^lifi-debug]

These categories imply different actions. For example:

| Failure condition | Potentially relevant action | Common but potentially irrelevant action |
| --- | --- | --- |
| No usable route | Change route, protocol, or token pair; stop | Increase priority fee |
| Insufficient token balance | Reduce amount or fund the account | Increase slippage |
| Insufficient allowance | Approve the required amount, if intended | Increase priority fee |
| Expired quote/deadline | Re-quote | Repeatedly submit the same stale transaction |
| Slippage exceeded | Re-quote; review market movement; cautiously reassess tolerance | Treat any larger tolerance as automatically safe |
| Token restriction or unsupported behavior | Stop or seek protocol/token-specific evidence | Repeated generic retries |
| RPC/runtime unavailable | Wait, retry infrastructure, or return `UNKNOWN` | Label the transaction itself unsafe |
| Evidence incomplete | Return `UNKNOWN` | Infer `PROCEED` from partial success |

**Interpretation for Parallax**

The public evidence supports a reason-action mapping problem. It does **not** yet establish how often target users experience each cause or whether existing interfaces already resolve it adequately in their real workflow.

### 5.5 Monad introduces an account-affordability hypothesis that must remain separate from simulation success

Monad's official documentation describes a reserve-balance mechanism. A transaction that would reduce an account below the required reserve may revert, subject to defined account-state exceptions. Monad also documents gas charging based on the transaction gas limit rather than refunding all unused gas under the same assumptions users may bring from other EVM chains.[^monad-how][^monad-reserve]

**Interpretation for Parallax**

A quote or a simulation performed with synthetic prefunding does not necessarily prove that the user's real account can afford the transaction under Monad's account rules.

This creates a research hypothesis:

> Users may misdiagnose account-affordability failures as slippage, priority-fee, or protocol failures.

For the current product, this must be handled conservatively:

- do not claim wallet affordability without authoritative account-state evidence;
- separate simulated executability from real-account affordability;
- return `UNKNOWN` where the required evidence is unavailable.

**Caveat:** This is presently a technical and user-research hypothesis, not a validated high-frequency user pain point.

---

## 6. Consolidated User Pain Inventory

| ID | User pain | Existing first-party evidence | Public evidence | Current confidence | Product-research implication |
| --- | --- | --- | --- | --- | --- |
| **UP-01** | User sees a failed swap/simulation but cannot identify the cause or relevant adjustment | Repeated across project research; primary candidate problem; internal and external users rely on shortcuts rather than a failure model | Official failure taxonomies distinguish materially different causes and actions | **Medium** | Test whether reason + relevant/irrelevant action changes retry behavior |
| **UP-02** | User treats successful execution as proof that the result is acceptable | P08 loss story; interview questions emphasize output and unexplained loss; technical economic-boundary scenario exists | Transaction-intent research shows users misread semantic effects | **Medium-low for frequency; high for plausibility** | Require an explicit boundary such as Minimum Received; do not infer preference |
| **UP-03** | User cannot interpret transaction parameters, approvals, or semantic intent | Beginners in the sample do not know what to check; trust is delegated to brands or experts | HCI studies show parameter and mental-model comprehension gaps | **Medium** | Present semantic outcomes first; keep raw evidence expandable |
| **UP-04** | The users who need protection are unlikely to seek a standalone tool | Repeated across beginner, low-frequency, intermediate, and professional segments | Broad surveys show awareness is higher than workflow literacy | **Medium** | Test an embedded or wallet-like entry point rather than a report-first dashboard |
| **UP-05** | Complex configuration creates cognitive load and prevents use | Beginners cannot define risk categories; low-frequency users prioritize speed and low friction | Warning-design and semantic-decoder studies support simpler, contextual presentation | **Medium** | Use defaults and one explicit user boundary rather than a large policy builder |
| **UP-06** | Users may confuse infrastructure/evidence failures with transaction risk | Research documents the need to preserve Integration Error and Unknown separately | Public taxonomies distinguish RPC, route, balance, allowance, and transaction failures | **Medium-low** | Never map missing evidence or infrastructure failure to a risk verdict |
| **UP-07** | Monad real-account constraints may invalidate an otherwise plausible transaction | No completed target-user validation; current concern comes from technical research | Monad officially documents reserve-balance and gas-accounting behavior | **Exploratory** | Keep wallet affordability outside a positive verdict until evidence is available |
| **UP-08** | Users distrust unfamiliar pre-sign tools | P05 and other users rely on reputable platforms and familiar interfaces | Crypto mental-model research shows trust often follows superficial cues | **Medium-low** | Make non-custodial scope, evidence provenance, and fail-closed behavior visible |

---

## 7. Primary User Hypothesis

### 7.1 Proposed primary user for the next validation round

> **A light-to-intermediate EVM or Monad user who has completed several swaps, has experienced at least one failed, uncertain, or unexpectedly poor transaction, and is deciding whether to sign or retry.**

This user is not completely new to wallets. They can:

- connect or use a wallet;
- select tokens and enter an amount;
- read a quote at a basic level;
- recognize common terms such as slippage or gas.

However, they may not be able to:

- distinguish route, liquidity, balance, allowance, token, RPC, and slippage failures;
- assess whether a successful simulation satisfies their intent;
- identify which adjustment is relevant;
- determine whether evidence is missing;
- verify a recommendation independently.

### 7.2 Trigger moment

The highest-value moment is:

> **After the user enters a swap, but before signing—or after a failed attempt, before retrying.**

This moment is preferable to a broad “research a protocol” use case because:

- the user has a concrete intent;
- the decision is immediate;
- evidence can be tied to a proposed transaction;
- behavior change can be observed;
- Adjust & Re-run can test whether the recommendation worked.

### 7.3 Core job to be done

**Functional job**

> When my swap fails or produces a questionable result, help me determine whether to proceed, change one relevant condition, or stop—without requiring me to diagnose low-level transaction data.

**Trust job**

> Show me what evidence supports the decision, and clearly state what is unknown, so I do not have to trust an unexplained score.

**Emotional job**

> Reduce uncertainty at the signing or retry moment without overwhelming me or making me feel that I need to become a protocol expert.

### 7.4 Users who are not the current primary segment

- Professional users evaluating complex lending or yield-market parameters;
- Users performing familiar, small swaps on trusted routes with no warning;
- Complete beginners who cannot yet operate a wallet;
- Institutions requiring approval workflows and custody policy;
- Users seeking protocol ratings or broad investment research.

These groups may become later segments, but combining them into the current primary persona would weaken validation.

---

## 8. Priority Problem Statements

### Priority 1 — Failure reason and effective adjustment

> A user preparing to retry a swap sees a generic failure or simulation error but cannot determine whether changing slippage, priority fee, amount, balance, allowance, route, or token pair is relevant.

**Desired behavioral outcome**

- Stop an irrelevant retry;
- choose one supported adjustment;
- rerun the check;
- understand whether the result improved.

**Current evidence status:** Directionally supported; requires external task validation.

### Priority 2 — Executable but outside an explicit boundary

> A transaction can execute, but its expected output or another verified result violates a boundary the user explicitly supplied.

**Desired behavioral outcome**

- Reject the current path;
- change one condition;
- rerun;
- proceed only after the same boundary passes.

**Current evidence status:** Strong technical demonstrability; weaker evidence on frequency and primary-user demand.

### Supporting problem — Evidence comprehension

> A user cannot reliably translate raw transaction evidence into an intent-level decision.

**Desired behavioral outcome**

- Understand what happened;
- identify what proves it;
- identify the relevant action;
- recognize what remains unknown.

**Current evidence status:** Supported by interviews and public HCI research.

### Exploratory problem — Real-account affordability on Monad

> A simulation result does not necessarily prove that the user's real account satisfies Monad-specific execution constraints.

**Desired behavioral outcome**

- Distinguish simulated executability from account affordability;
- avoid false reassurance;
- return `UNKNOWN` when affordability evidence is absent.

**Current evidence status:** Technical hypothesis only; not yet a validated user-demand priority.

---

## 9. Research-Derived Interaction Principles

These are research implications, not a complete product specification.

1. **Lead with the decision.**
   Show `PROCEED`, `ADJUST`, `STOP`, or `UNKNOWN` before technical detail.

2. **Show one bounded reason.**
   Avoid a long generic risk checklist when one evidenced cause is decisive.

3. **Separate relevant and irrelevant adjustments.**
   “Changing slippage will not help this no-route result” may be as valuable as the recommended action.

4. **Require explicit acceptance boundaries.**
   Do not infer that an output is unacceptable without a user boundary or trusted rule.

5. **Preserve Unknown.**
   Missing evidence, infrastructure failure, and unsupported semantics must not become a positive or negative risk claim.

6. **Keep evidence available on demand.**
   The first layer should be understandable; deeper provenance should remain inspectable.

7. **Use Adjust & Re-run as the proof of value.**
   The core research loop is:

   ```text
   First check
   → problem found
   → one relevant change
   → rerun
   → result comparison
   ```

8. **State the trust boundary.**
   No keys, signing, broadcasting, or custody; explain Live, Replay, Demo, Mock, Derived, and Unknown evidence.

9. **Design for an embedded moment.**
   Even when delivered as a standalone demo, the interaction should resemble a pre-sign wallet or DEX step.

---

## 10. What Is Directionally Supported

The current research supports the following directional conclusions:

- Users do not naturally think in the team's formal risk categories.
- Low-frequency and beginner users resist configuration and additional workflow steps.
- Intermediate users rely heavily on reputation and existing interface cues.
- Professional users need protocol-specific evidence, not a generic score.
- A standalone “complete risk report” is a weak default entry point.
- Users care about payment, receipt, loss, authorization, failure reason, and next action.
- Evidence is valuable when it changes the user's decision.
- A failure should be mapped to relevant and irrelevant actions.
- Successful simulation and acceptable outcome are separate questions.
- Unknown and infrastructure failure must remain visible rather than being forced into a risk verdict.

---

## 11. What Is Not Yet Validated

The team should not yet claim that:

- failed-swap diagnosis is a high-frequency problem for most Monad users;
- users routinely increase slippage or priority fee after every failure;
- users will open a standalone Parallax site before normal swaps;
- users are willing to pay for the product;
- a Minimum Received check is insufficient in existing user workflows;
- the CHOG technical example represents common user behavior;
- Monad reserve-balance failures are a major user pain point;
- professional DeFi users are a strong primary segment for ordinary swaps;
- users prefer exactly four verdict labels without usability testing;
- better comprehension automatically produces safer behavior;
- the current eight-person sample represents the wider market.

---

## 12. Public Research References

[^fca-2025]: UK Financial Conduct Authority, **Cryptoassets Consumer Research 2025**. Nationally representative phase-one sample of 2,353 adults, with a 1,053-person current/former-owner boost sample. Accessed 2026-08-07.
    https://www.fca.org.uk/publications/research-notes/cryptoassets-consumer-research-2025

[^consensys-2024]: Consensys and YouGov, **Web3 and Crypto Global Survey 2024**. 18,652 respondents in 18 countries; fieldwork conducted from February to May 2024. Industry-sponsored survey; used directionally. Accessed 2026-08-07.
    https://consensys.io/insight-report/web3-and-crypto-global-survey

[^semantic-decoder]: Zhang et al., **What I Sign Is Not What I See: An Intent-Centric Interaction Framework for Human-Comprehensible Transaction Signing** (2026 preprint). Includes a between-subjects study with 128 participants. Accessed 2026-08-07.
    https://arxiv.org/abs/2601.16751

[^mental-models]: Mai et al., **User Mental Models of Cryptocurrency Systems—A Grounded Theory Approach**, USENIX SOUPS 2020. Qualitative study with 29 cryptocurrency users. Accessed 2026-08-07.
    https://www.usenix.org/conference/soups2020/presentation/mai

[^cbi-warning]: Central Bank of Ireland, **Can Behaviourally-Informed Risk Warnings Improve Crypto-Asset Risk Comprehension and Risk Perception?** (2026 research paper / randomized experiment). Accessed 2026-08-07.
    https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6269619

[^uniswap-failure]: Uniswap Labs Support, **Why did my transaction fail?** Used only as a public taxonomy of failure causes, not as competitor analysis. Accessed 2026-08-07.
    https://support.uniswap.org/hc/en-us/articles/8643975058829-Why-did-my-transaction-fail

[^uniswap-slippage]: Uniswap Labs Support, **What is Price Slippage?** Used to distinguish low-tolerance failure from the downside of excessive tolerance. Accessed 2026-08-07.
    https://support.uniswap.org/hc/en-us/articles/8643879653261-What-is-Price-Slippage-

[^lifi-debug]: LI.FI Documentation, **Debug Failed Transactions**. Used only for publicly documented failure categories and bounded debugging actions. Accessed 2026-08-07.
    https://docs.li.fi/guides/debug-failed-transactions

[^monad-how]: Monad, **How Monad Works**. Official description of Monad account and execution mechanics. Accessed 2026-08-07.
    https://blog.monad.xyz/blog/how-monad-works

[^monad-reserve]: Monad Improvement Proposal 4, **Reserve Balance Introspection**. Used to document the reserve-balance mechanism and the need to separate simulation from real-account affordability. Accessed 2026-08-07.
    https://forum.monad.xyz/t/mip-4-reserve-balance-introspection/363
