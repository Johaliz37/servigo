import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      '.wrangler',
      'coverage',
      'playwright-report',
      'test-results',
      'worker-configuration.d.ts',
      'src/shared/database.types.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/client/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], jsxA11y.flatConfigs.recommended],
    plugins: { 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Generados por shadcn: exportan variantes junto a componentes.
    files: ['src/client/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['src/worker/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      // src/shared es TS puro: sin APIs de navegador ni de Workers (00 §5).
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'navigator', 'HTMLRewriter', 'caches'],
    },
  },
  {
    files: ['*.config.{js,ts}', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
