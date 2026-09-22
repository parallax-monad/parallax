# Context Recovery / AI Handoff Protocol

Parallax uses GitHub as the durable external brain for long-running multi-agent development.

`conversation = temporary reasoning surface`

`GitHub = durable project state`

## Recovery order

1. `scripts/agent-preflight.sh --read`
2. `AGENTS.md`
3. `docs/context/PROJECT_STATE.md`
4. `docs/context/DECISION_LOG.md`
5. `docs/context/AGENT_HANDOFF.md`
6. `RUNBOOK.md`
7. `docs/README.md`
8. relevant Product/architecture/evidence documents
9. fresh GitHub main/PR/Issue/reviews/threads/CI

Only then decide whether old chat is still needed.

## Checkpoint minimum

Persist `checkpoint_head = main tip at checkpoint time`, active PR heads, accepted/frozen decisions, pass/fail state, unresolved owner gates, critical path, next executable action, and material incidents.

`checkpoint_head` is historical, not a claim about current main. Future takeover verifies after a fresh fetch that it is an ancestor of current main; equality is neither required nor expected. PR heads are not covered by this ancestry rule: because this repository uses squash merges, a merged PR's historical head need not be an ancestor of main, so record the actual merge/squash commit when known and label any retained PR head as historical.

## Parallel-agent rule

Before writes: fresh-fetch, run write preflight, confirm exact target head, inspect owner/review state, avoid duplicating another agent, and make the smallest scoped mutation.

## Context contamination

If unrelated project context appears, stop writes immediately and restart from this protocol.

## Security

Do not persist secrets or credentials in context files.
