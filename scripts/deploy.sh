#!/usr/bin/env bash
#
# Publishes the game: verify, commit, push, wait for GitHub Pages.
#
# The logic lives here rather than in the Makefile because macOS ships GNU
# Make 3.81, which ignores .ONESHELL and runs every recipe line in its own
# shell — anything with an `if` falls apart there.
set -euo pipefail

BRANCH="${BRANCH:-main}"
SITE="${SITE:-https://nikitakiselev.github.io/node_wars/}"
MESSAGE="${M:-}"

if [[ -n "$(git status --porcelain)" ]]; then
  if [[ -z "$MESSAGE" ]]; then
    echo
    echo "Есть незакоммиченные изменения, но не задан текст коммита."
    echo 'Повторите так:  make deploy M="что изменилось"'
    exit 1
  fi
  git add -A
  git commit -m "$MESSAGE"
else
  echo "Коммитить нечего — публикую то, что уже в ветке."
fi

git push origin "$BRANCH"

echo
echo "Жду сборку на GitHub…"
sleep 5

run_id="$(gh run list --branch "$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId')"
if [[ -z "$run_id" ]]; then
  echo "Сборка не запустилась. Проверьте: gh run list"
  exit 1
fi

gh run watch "$run_id" --exit-status --interval 10 >/dev/null

echo
echo "Готово: $SITE"
