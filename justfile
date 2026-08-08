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

check: lint typecheck test e2e

db-indexes:
    node --env-file=.env scripts/db-indexes.mjs
