import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // physics/ and rules/ must stay pure TS (plan §4): no Three.js, no DOM
    files: ['src/physics/**', 'src/rules/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['three', 'three/*'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator'],
    },
  },
);
