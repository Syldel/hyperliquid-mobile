// @ts-check
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * ESLint 9 (config « flat ») + angular-eslint, sur `src/`.
 *
 * Ce que ça apporte que ni `tsc` ni Prettier ne disent : `CLAUDE.md` et
 * `docs/angular.md` tiennent pour une **régression** l'introduction d'un
 * `@Input()`, d'un `*ngIf`, d'un `NgModule` ou d'une injection par constructeur.
 * Jusqu'ici c'était une convention qu'on lisait ; c'est maintenant une règle qui
 * échoue. Mesuré le 2026-10-16 avant de l'écrire : `*ngIf` 0, `@Input` 0,
 * `NgModule` 0 — la règle n'a donc pas eu à être desserrée pour entrer.
 *
 * Le format n'est PAS ici : Prettier a son propre script (`format:check`), et
 * `eslint-config-prettier` coupe seulement les règles qui s'en disputeraient.
 *
 * Volontairement absent : `@angular-eslint/prefer-signals` (214 occurrences). Il
 * n'interdit rien d'ancien, il exige `readonly` sur chaque signal — du style, pas
 * une protection.
 */

/** Les formes anciennes d'Angular, que le dépôt a quittées. */
const LEGACY_ANGULAR = [
  {
    selector: "Decorator[expression.callee.name='Input']",
    message: 'Use input() / input.required() (signal inputs), not @Input().',
  },
  {
    selector: "Decorator[expression.callee.name='Output']",
    message: 'Use output(), not @Output().',
  },
  {
    selector: 'Decorator[expression.callee.name=/^(ViewChild|ViewChildren)$/]',
    message: 'Use viewChild() / viewChildren(), not the query decorators.',
  },
  {
    selector: 'Decorator[expression.callee.name=/^(ContentChild|ContentChildren)$/]',
    message: 'Use contentChild() / contentChildren(), not the query decorators.',
  },
  {
    selector: "Decorator[expression.callee.name='NgModule']",
    message: 'Everything is standalone: no NgModule.',
  },
  {
    selector: "NewExpression[callee.name='EventEmitter']",
    message: 'Use output(), not EventEmitter.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'www',
      'android',
      'ios',
      'node_modules',
      '.angular',
      'coverage',
      'eslint.config.mjs',
    ],
  },

  {
    files: ['src/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
      eslintConfigPrettier,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // `_x` marque une valeur écartée à dessein (`const { a: _a, ...rest } = obj`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/prefer-standalone': 'error',
      'no-restricted-syntax': ['error', ...LEGACY_ANGULAR],
    },
  },

  {
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended, eslintConfigPrettier],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
    },
  },

  // ── Exceptions, nommées ─────────────────────────────────────────────────────

  {
    // `docs/angular.md`, « Ce qui est de l'ancien et mériterait de partir » :
    // des constructeurs `(private …)` qu'on ne convertit pas sans test d'abord.
    // La règle reste en erreur partout ailleurs : le NOUVEAU constructeur échoue.
    files: [
      'src/app/core/services/config.service.ts',
      'src/app/core/services/theme.service.ts',
      'src/app/features/auth/login/login.page.ts',
      'src/app/features/auth/url-config/url-config.page.ts',
      'src/app/features/secure/watchlist/components/add-watchlist-modal/add-watchlist-modal.component.ts',
    ],
    rules: { '@angular-eslint/prefer-inject': 'off' },
  },

  {
    // Les faux composants imitent l'API d'Ionic, qui est décoratrice : les
    // moderniser les rendrait infidèles (`docs/angular.md`).
    files: ['src/app/shared/testing/ionic-stubs.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
