install:
    pnpm install

dev:
    pnpm dev

test:
    pnpm vitest run --coverage

e2e:
    pnpm playwright test

lint:
    pnpm eslint . && pnpm prettier --check .

typecheck:
    pnpm tsc --noEmit

# Mutation testing on the high-risk modules (stryker.config.mjs). Local only for now.
mutate:
    pnpm stryker run

check: lint typecheck test e2e

db-indexes:
    node --env-file=.env scripts/db-indexes.mjs
