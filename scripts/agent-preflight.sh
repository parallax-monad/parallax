#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---read}"
case "$MODE" in
  --read|--write) ;;
  *) echo "usage: $0 [--read|--write]" >&2; exit 2 ;;
esac

die() {
  echo "PREFLIGHT=FAIL"
  echo "REASON=$*" >&2
  exit 1
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a Git repository"
cd "$ROOT"

REMOTE="$(git remote get-url origin 2>/dev/null || true)"
case "$REMOTE" in
  "https://github.com/parallax-monad/parallax.git"|"git@github.com:parallax-monad/parallax.git") ;;
  *) die "unexpected origin: ${REMOTE:-<unset>}" ;;
esac

BRANCH="$(git branch --show-current)"
[[ -n "$BRANCH" ]] || die "detached HEAD"

echo "ROOT=$ROOT"
echo "ORIGIN=$REMOTE"
echo "BRANCH=$BRANCH"
echo "HEAD=$(git rev-parse HEAD)"

NAME="$(git config --local --get user.name || true)"
EMAIL="$(git config --local --get user.email || true)"
echo "LOCAL_GIT_NAME=${NAME:-<unset>}"
echo "LOCAL_GIT_EMAIL=${EMAIL:-<unset>}"

DIRTY=0
git diff --quiet || DIRTY=1
git diff --cached --quiet || DIRTY=1
[[ -z "$(git ls-files --others --exclude-standard)" ]] || DIRTY=1
echo "WORKTREE_DIRTY=$DIRTY"

if [[ "$MODE" == "--read" ]]; then
  echo "PREFLIGHT=PASS"
  exit 0
fi

[[ "$BRANCH" != "main" ]] || die "write mode refuses direct main writes"
[[ "$DIRTY" == "0" ]] || die "write mode requires a clean pre-task worktree"
[[ -f ".parallax-agent.local" ]] || die "missing .parallax-agent.local"

# shellcheck disable=SC1091
source ".parallax-agent.local"

[[ -n "${PARALLAX_GIT_NAME:-}" ]] || die "PARALLAX_GIT_NAME is empty"
[[ -n "${PARALLAX_GIT_EMAIL:-}" ]] || die "PARALLAX_GIT_EMAIL is empty"
[[ "$NAME" == "$PARALLAX_GIT_NAME" ]] || die "local git name does not match operator declaration"
[[ "$EMAIL" == "$PARALLAX_GIT_EMAIL" ]] || die "local git email does not match operator declaration"
[[ "$EMAIL" != "jie@users.noreply.github.com" ]] || die "known-bad generic local identity detected"

git fetch --quiet origin main

echo "REMOTE_MAIN=$(git rev-parse origin/main)"
echo "IDENTITY=PASS"
echo "PREFLIGHT=PASS"
