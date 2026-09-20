SHELL := /bin/bash

BRANCH := main
SITE := https://nikitakiselev.github.io/node_wars/

# Exported so the release script reads them from the environment: a commit
# message may contain quotes and newlines, which make would otherwise paste
# straight into the recipe for the shell to re-parse.
export BRANCH
export SITE
export M

.DEFAULT_GOAL := help
.PHONY: help dev test check deploy open

help:
	@echo 'make dev      — запустить игру локально на http://localhost:5173'
	@echo 'make test     — прогнать тесты'
	@echo 'make check    — тесты, типы и сборка'
	@echo 'make deploy   — опубликовать: проверить, закоммитить, запушить, дождаться прода'
	@echo '                нужен текст коммита: make deploy M="что изменилось"'
	@echo 'make open     — открыть прод'

dev:
	npm run dev

test:
	npm test

# Everything that must hold before anything reaches the live site.
check:
	npm test
	npx tsc --noEmit
	npm run build

deploy: check
	@bash scripts/deploy.sh

open:
	@open "$(SITE)"
