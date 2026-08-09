import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { fixupConfigRules } from '@eslint/compat'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
import jsxA11y from 'eslint-plugin-jsx-a11y'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const eslintConfig = [
  // Raw `eslint .` (no `next lint` wrapper) scans build artifacts without this —
  // .next/ + next-env.d.ts regenerate on every dev run. Mirrors .prettierignore.
  {
    ignores: [
      '.next/**',
      'next-env.d.ts',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  // eslint-config-next 16 ships native flat configs — FlatCompat over the
  // legacy 'next/*' names throws on the plugin objects' circular references.
  // fixupConfigRules: eslint-plugin-react 7.37.5 (bundled by config-next)
  // still calls context.getFilename, removed in eslint 10.
  ...fixupConfigRules(nextCoreWebVitals),
  ...fixupConfigRules(nextTypescript),
  {
    // eslint-config-next 16 registers the jsx-a11y plugin itself — redefining
    // it here with our own instance is a flat-config error. Rule IDs resolve
    // against the registration next's config already made.
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Every switch has a default; non-empty cases must terminate
      'default-case': 'error',
      'no-fallthrough': 'error',
      // const enum breaks isolatedModules; use string literal unions instead
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration[const=true]',
          message: 'const enum is banned — use a string literal union.',
        },
      ],
    },
  },
  // Typed rules only on src/ files where tsconfig project is available
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
      },
    },
    // No plugins key: eslint-config-next/typescript already registers
    // @typescript-eslint (wrapped by fixupConfigRules — re-registering our
    // own instance is a redefine error). Rule IDs resolve by name.
    rules: {
      // Type-only imports/exports are erased at compile time — keeps builds fast
      // and works with verbatimModuleSyntax
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      // Record<string, T> over {[key: string]: T}
      '@typescript-eslint/consistent-indexed-object-style': ['error', 'record'],
      // Throw/reject only Error instances
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
    },
  },
]

export default eslintConfig
