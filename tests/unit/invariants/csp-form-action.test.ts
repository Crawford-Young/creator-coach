// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'

// Rule under test (CLAUDE.md, "Auth lessons"): the CSP form-action list and
// the CLAUDE.md bullet naming the sign-in redirect chain must list the SAME
// hosts. W1 shipped with the doc at 3 hosts and the config at 2 because
// nothing checked the two against each other.

async function servedFormActionHosts(): Promise<string[]> {
  const routes = (await nextConfig.headers?.()) ?? []
  const csp = routes
    .flatMap((route) => route.headers)
    .find((header) => header.key === 'Content-Security-Policy')?.value
  const directive = csp
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('form-action '))
  expect(directive, 'CSP has no form-action directive').toBeDefined()
  return (directive as string)
    .split(/\s+/)
    .slice(1)
    .filter((source) => source !== "'self'")
    .map((source) => new URL(source).host)
    .sort()
}

function documentedChainHosts(): string[] {
  const doc = readFileSync(resolve(__dirname, '../../../CLAUDE.md'), 'utf8')
  const sentence = /sign-in form's chain crosses (.+?) —/.exec(doc)?.[1]
  expect(sentence, 'CLAUDE.md no longer names the sign-in redirect chain').toBeDefined()
  return [...(sentence as string).matchAll(/`([^`]+)`/g)].map((match) => match[1]).sort()
}

describe('CSP form-action', () => {
  it('allow-lists exactly the hosts CLAUDE.md names for the sign-in redirect chain', async () => {
    const documented = documentedChainHosts()
    expect(documented.length).toBeGreaterThan(0)
    expect(await servedFormActionHosts()).toEqual(documented)
  })
})
