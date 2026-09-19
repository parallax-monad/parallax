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

## Ownership and decision boundaries

Write access is not authority to approve, merge, close, or reopen another owner's semantic gate.

Respect `.github/CODEOWNERS`, active Issue/PR ownership, and frozen Product/Contract decisions.

## Exact-head discipline

Every review and merge gate is bound to an exact commit head. When a head moves, inspect the delta and rerun only the required validation. Do not blindly transfer old exact-head claims.

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
