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

storybook:
    pnpm storybook dev -p 6006

storybook-build:
    pnpm storybook build

db-indexes:
    node --env-file=.env scripts/db-indexes.mjs
