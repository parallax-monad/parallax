# Mutation / Incident Ledger

## 2026-09-19 — #69 Git identity attribution incident

Old commits:

- `9be5e8190f25516c46f2bf0713766d2e95cfa9eb` — merge main into #69;
- `503545b2a8c4e72596665a0840340a89578233af` — Provider mode/provenance + failure-text fix;
- `8e1f28bec2f10f3b8134c85498cc74f534d00748` — merge updated main into #69.

Root cause: repo-local Git config `jie <jie@users.noreply.github.com>` overrode the actual operator identity, and GitHub mapped that noreply address to existing account `@jie`.

Integrity review:

- first merge delta exactly matched contemporaneous #79 main delta;
- second merge delta exactly matched contemporaneous #76/#77 main delta;
- no extra conflict-resolution delta;
- Provider fix matched intended #69 scope.

Repair rebuilt the same trees/messages/timestamps/topology with corrected author/committer:

- `9be5e8190f25516c46f2bf0713766d2e95cfa9eb` → `72b683fad84282c8fab165130adcad7b8df58e04`
- `503545b2a8c4e72596665a0840340a89578233af` → `4f5c0f3091ecb495a62f7d440bad992325a81d4e`
- `8e1f28bec2f10f3b8134c85498cc74f534d00748` → `8d97e7536110a10955a48e5825988f96ec15c08f`

Remote update used exact `--force-with-lease` against `8e1f28bec2f10f3b8134c85498cc74f534d00748`.

## 2026-09-19 — project control plane

Added durable takeover/context recovery files and local identity preflight. Feature development remains paused until the repaired #69 head and this control change are validated.

## 2026-09-19 — proportional gating supersedes blanket development freeze

Policy update, appended. The earlier "Feature development remains paused" note is retained
unchanged above as the historical state at the time it was written.

- The blanket development freeze is superseded by proportional gating (`AGENTS.md`,
  `RUNBOOK.md`): gate depth is keyed to risk, reversibility, and semantic reach, not to the
  number of unrelated open PRs or reviewers.
- Routine, scoped, low-risk, reversible work in an already-clear owner boundary may proceed
  after preflight, following `preflight → implement → validate → normal push → scoped review
  if needed`.
- Hard-stop categories that still require an explicit owner/gate decision: Product/Contract
  semantic changes, architecture-wide changes, history rewrite / force push, destructive Git
  operations, security/secrets incidents, signing/broadcasting/custody/wallet mutation, owner
  authority conflicts, accepted-evidence rewrite or meaning change, large cross-owner public
  API changes, and uncertain frozen-boundary impact.
- #82 no longer blocks routine #69/#81 development or review fixes.

The #69 identity-attribution incident history above is unchanged.
