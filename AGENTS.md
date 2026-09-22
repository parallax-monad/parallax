# Parallax Agent Contract

This file is the project-level contract for AI agents, coding assistants, and human operators using agent-assisted workflows.

## Durable source of truth

Chats are temporary reasoning surfaces. GitHub is the durable project state.

Source-of-truth priority:

1. current merged code and exact Git state;
2. frozen Product/Contract decisions and accepted evidence;
3. `docs/context/PROJECT_STATE.md`;
4. current PR/Issue review state and exact-head CI;
5. `docs/context/DECISION_LOG.md`;
6. `docs/context/AGENT_HANDOFF.md`;
7. recent chat not yet checkpointed;
8. historical chat.

## Mandatory takeover gate

Every new AI/session must:

1. run `./scripts/agent-preflight.sh --read`;
2. read, in order:
   - `AGENTS.md`
   - `docs/context/CONTEXT_RECOVERY.md`
   - `docs/context/PROJECT_STATE.md`
   - `docs/context/DECISION_LOG.md`
   - `docs/context/AGENT_HANDOFF.md`
   - `RUNBOOK.md`
   - `docs/README.md`
3. fresh-fetch current `main`, target PR/Issue heads, reviews, threads, and CI;
4. identify owner boundaries from `.github/CODEOWNERS` and relevant specs;
5. report `TAKEOVER_READY=YES` only after repository identity, local identity, current state, frozen decisions, dependency graph, and pending mutations are reconciled.

If any of those disagree, report `TAKEOVER_READY=NO` and repair takeover state before development.

## Mandatory write gate

Before any commit, push, branch reconciliation, review mutation, issue mutation, or merge:

```bash
./scripts/agent-preflight.sh --write
```

Write mode requires a local, untracked `.parallax-agent.local` file containing the operator's expected Git identity.

Do not write if repository/remote is unexpected, identity differs, worktree is already dirty, target head moved, owner scope is unclear, or unrelated-project context appears.

## Proportional gating

Gate depth is proportional to risk, reversibility, and semantic reach. It is not
proportional to how many unrelated PRs or reviewers happen to be open. A blanket freeze
over unrelated work is not a safety control and must not be used as one.

### Direct lane — no hard gate

Ordinary, localized, low-risk, reversible work inside an already-clear owner boundary may
proceed directly, without waiting for unrelated reviewers or PRs:

`preflight → implement → validate → normal push → scoped review if needed`

This lane covers, for example:

- localized bug fixes;
- regression tests;
- documentation truth corrections;
- lint / format fixes;
- clearly scoped review findings;
- non-semantic fixture / index maintenance;
- other explicitly owner-bounded, low-risk, reversible changes.

### Hard-stop lane — explicit gate required

Stop and obtain an explicit owner/gate decision before writing when a change is any of:

- a Product semantic change;
- a shared Contract semantic change;
- an architecture-wide change;
- a history rewrite / force push;
- a destructive Git operation;
- a security / secrets incident;
- a signing / broadcasting / custody / wallet mutation;
- an owner authority conflict;
- accepted evidence fabrication, rewrite, or meaning change;
- a large cross-owner public API change;
- a change whose frozen-semantic-boundary impact cannot be determined.

## Ownership and decision boundaries

Write access is not authority to approve, merge, close, or reopen another owner's semantic gate.

Respect `.github/CODEOWNERS`, active Issue/PR ownership, and frozen Product/Contract decisions.

## Exact-head discipline

Every review and merge gate is bound to an exact commit head. When a head moves, inspect the material delta and rerun only the required validation. Do not blindly transfer old exact-head claims.

A head move re-opens only that material delta. It does not automatically trigger a full stacked-baseline broad re-review.

A recorded main checkpoint is historical; fresh GitHub state is live truth. Validate checkpoint ancestry: after a fresh fetch, confirm the recorded `checkpoint_head` is an ancestor of current `main`, and never require `current_main == checkpoint_head`. Non-ancestry means history divergence or rewrite and requires explicit reconciliation before `TAKEOVER_READY=YES`.

This ancestry rule applies to main checkpoints only. Because the repository uses squash merges, a merged PR's historical head need not be an ancestor of `main`: record the actual merge/squash commit when known, and label a retained PR head explicitly as historical.

## Mutation discipline

Before mutation record repository, branch/ref, expected old SHA, intended scope, and owner/gate.

History rewrite is exceptional and requires explicit authorization, exact expected old SHA, tree/content equality proof when metadata-only, `--force-with-lease`, and new exact-head CI/review.

## Context and handoff discipline

After every material gate, merge, architecture decision, evidence acceptance, incident, or handoff:

- update `PROJECT_STATE.md`;
- append durable decisions to `DECISION_LOG.md` when needed;
- append material mutations/incidents to `MUTATION_LEDGER.md`;
- refresh `AGENT_HANDOFF.md`.

## Context contamination rule

If an AI mentions or acts on an unrelated project/task, stop before further writes.

Treat this as `CONTEXT_CONTAMINATION=TRUE` and restart takeover from the repository files.

## Safety boundary

Never persist private keys, API keys, RPC secrets, session tokens, wallet seed phrases, or unrelated private contents.

Parallax P0 remains unsigned/read-only unless explicitly accepted future scope changes that boundary.
