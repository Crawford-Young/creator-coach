// Mutation testing for the code where a wrong-but-passing test is most
// costly: connectors, token handling, ingest, and the tenant chokepoint.
// Run with `just mutate`. Not a CI gate yet — set `thresholds.break` from
// the first local baseline score, then add the recipe to CI.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  mutate: [
    'src/lib/connectors/**/*.ts',
    'src/lib/ingest/**/*.ts',
    'src/lib/token-crypto.ts',
    'src/lib/tenant.ts',
    'src/lib/provision.ts',
    'src/lib/connections/**/*.ts',
  ],
  reporters: ['clear-text', 'progress', 'html'],
  coverageAnalysis: 'perTest',
  thresholds: { high: 85, low: 70, break: null },
}

export default config
