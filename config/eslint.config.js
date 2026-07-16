import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist/**',
    'coverage/**',
    'playwright-report/**',
    '.worktrees/**',
    '.claude/worktrees/**',
    'public/vditor/dist/**',
    'src-tauri/gen/**',
    'src-tauri/target/**',
    'test-results/**',
    'website/.astro/**',
    'website/dist/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Markdown 脑图仍是 React Flow 的命令式适配器，尚未迁移到 React Compiler
    // 数据模型；只在该旧适配器目录关闭编译器纯度规则，不放宽新代码。
    files: ['src/components/mindmap/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // 测试夹具会故意保留不可见空格和仅用于装配场景的局部变量。
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-irregular-whitespace': 'off',
    },
  },
])
