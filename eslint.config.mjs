import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

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
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    plugins: {
      'jsx-a11y': jsxA11y,
    },
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
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
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
