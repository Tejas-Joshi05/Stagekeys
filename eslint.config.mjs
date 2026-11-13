import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Feature folders may only be imported through their index file. */
const features = [
  'actions',
  'midi',
  'mapping',
  'deck',
  'editor',
  'render',
  'animations',
  'presenter',
];

export default tseslint.config(
  { ignores: ['out', 'dist', 'release', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: features.map((f) => `**/${f}/*`),
              message: 'Import other features through their index file.',
            },
            { group: ['electron', 'node:*', 'fs', 'path'], message: 'Renderer must not use Node.' },
          ],
        },
      ],
    },
  },
  prettier,
);
