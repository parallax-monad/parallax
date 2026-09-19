# Parallax Agent / Repository Runbook

## Startup

```bash
git status
git remote -v
./scripts/agent-preflight.sh --read
```

Then follow the mandatory reading order in `AGENTS.md` and fresh-fetch remote truth.

## Before any write

```bash
cp .parallax-agent.local.example .parallax-agent.local
# edit once per clone for the actual operator
./scripts/agent-preflight.sh --write
```

Write mode must pass before AI-assisted repository or GitHub mutation.

## Task scope

Record target Issue/PR, exact base/head SHA, owner, allowed files/boundaries, known blockers, dependency-gated items, and non-goals.

For reviews, inspect only the material delta plus directly affected boundaries.

## Implementation

Prefer small atomic commits. Do not mix unrelated cleanup into blocker fixes. Do not sign/broadcast transactions unless explicitly scoped. Do not bypass owner review or silently change frozen semantics.

## Validation

Use repository-standard checks as applicable:

```bash
pnpm typecheck
pnpm test
pnpm lint
git diff --check
```

Run focused tests first, then the full relevant gate.

## Synchronization

Before branch reconciliation:

```bash
git fetch origin --prune
git status
```

Compare exact old/new heads. Material reconciliation may require fresh exact-head review.

## History repair

Required:

- explicit authorization;
- exact old remote SHA;
- proven target;
- `--force-with-lease=<ref>:<expected-old-sha>`;
- no blind `git push --force`;
- rerun exact-head CI/review.

## Checkpoint

After a material gate, update:

1. `docs/context/PROJECT_STATE.md`;
2. `docs/context/DECISION_LOG.md` if needed;
3. `docs/context/MUTATION_LEDGER.md` if material;
4. `docs/context/AGENT_HANDOFF.md`.

## Context overflow recovery

Start a clean AI session and tell it to open `parallax-monad/parallax`, run repository preflight, follow `AGENTS.md`, fresh-fetch GitHub, and not write until `TAKEOVER_READY=YES`.

## Dangerous commands

Do not run without explicit task-specific authorization:

```text
git reset --hard
git clean -fd
git push --force
git rebase --onto ...
git filter-repo
git filter-branch
```
