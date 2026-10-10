import { defineConfig } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { createConfig } from 'eslint-plugin-boundaries/config';
import prettier from 'eslint-config-prettier';

const el = (type: string) => ({ element: { type } });
const toEl = (...types: string[]) => types.map((t) => ({ to: el(t) }));
const toExternal = { to: { module: { origin: ['external', 'core'] } } };

const layer = (name: string) => [
  `src/shared/${name}/**`,
  `src/modules/*/${name}/**`,
];

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', 'drizzle/**', 'coverage/**'] },

  // ---------- Rule cơ bản + type-aware ----------
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },

  // ---------- Import resolver ----------
  // Phải tách thành block riêng: createConfig chỉ nhận settings có tiền tố "boundaries/"
  {
    files: ['src/**/*.ts'],
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true }, node: true },
    },
  },

  // ---------- Ranh giới kiến trúc ----------
  createConfig({
    files: ['src/**/*.ts'],
    settings: {
      'boundaries/ignore': [
        'src/main.ts',
        'src/app.controller.ts',
        'src/app.service.ts',
        'src/app.module.ts',
        'src/utility/**/*.ts',
        // composition root (giống app.module.ts): element pattern không match được file đơn lẻ
        'src/modules/*/*.module.ts',
        'src/apps/**/*.ts',
      ],
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'domain', pattern: layer('domain'), partialMatch: false },
        {
          type: 'application',
          pattern: layer('application'),
          partialMatch: false,
        },
        {
          type: 'infrastructure',
          pattern: layer('infrastructure'),
          partialMatch: false,
        },
        {
          type: 'presentation',
          pattern: layer('presentation'),
          partialMatch: false,
        },
        {
          type: 'composition',
          pattern: [
            'src/main.ts',
            'src/app.module.ts',
            'src/modules/*/*.module.ts',
          ],
          partialMatch: false,
        },
        {
          type: 'api',
          partialMatch: false,
          pattern: layer('api'),
        },
        { type: 'external', pattern: 'node_modules/**', partialMatch: false },
      ],
    },
    rules: {
      'boundaries/no-unknown-files': 'error',
      'boundaries/dependencies': [
        'error',
        {
          checkAllOrigins: true, // kiểm tra cả thư viện ngoài, không chỉ file local
          default: 'disallow',
          policies: [
            // Domain: chỉ được import domain. Thư viện ngoài bị chặn theo default.
            { from: el('domain'), allow: toEl('domain') },

            // Application: được dùng thư viện ngoài, TRỪ thư viện persistence
            {
              from: el('application'),
              allow: [...toEl('domain', 'application', 'api'), toExternal],
            },
            {
              from: el('application'),
              disallow: [
                {
                  to: {
                    module: {
                      origin: 'external',
                      source: ['drizzle-orm', 'postgres'],
                    },
                  },
                },
              ],
            },

            {
              from: el('infrastructure'),
              allow: [
                ...toEl('domain', 'application', 'infrastructure', 'api'),
                toExternal,
              ],
            },
            {
              from: el('presentation'),
              allow: [
                ...toEl('domain', 'application', 'presentation'),
                toExternal,
              ],
            },
            {
              from: el('composition'),
              allow: [
                ...toEl(
                  'domain',
                  'application',
                  'infrastructure',
                  'presentation',
                  'composition',
                ),
                toExternal,
              ],
            },
          ],
        },
      ],
    },
  }),

  // ---------- File test ----------
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },

  prettier,
);
