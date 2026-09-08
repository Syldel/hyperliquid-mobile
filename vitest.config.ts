import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * ============================================================================
 * 🧪 CONFIGURATION DU RUNNER DE TEST
 * Chargée par `@angular/build:unit-test` via l'option `runnerConfig`
 * (angular.json). Le build lui-même reste piloté par Angular : ce fichier ne
 * sert qu'à ce que Vitest ne sait pas faire autrement.
 *
 * Redirige `@ionic/angular/standalone` et `@ionic/angular` vers nos stubs.
 *
 * Pourquoi un alias plutôt qu'un `vi.mock` dans un fichier de setup, qui
 * remplissait ce rôle jusqu'ici : un alias est résolu au chargement du module,
 * alors que `vi.mock` passe par un registre propre à chaque worker Vitest. Ce
 * registre échouait à résoudre le chemin au-delà de 15 fichiers de spec en
 * mode watch (`TypeError: Cannot read properties of undefined (reading
 * 'trim')`), et chaque fichier supplémentaire faisait tomber un spec de plus —
 * sans rapport avec le contenu du spec accusé.
 *
 * La raison d'être des stubs, elle, n'a pas changé : importer quoi que ce soit
 * d'Ionic charge tout son bundle, y compris une ligne d'import ESM cassée sous
 * Vitest (ionic-team/ionic-framework#30982). Voir l'en-tête de ionic-stubs.ts.
 * ============================================================================
 */
const stubs = fileURLToPath(new URL('./src/app/shared/testing/ionic-stubs.ts', import.meta.url));

export default defineConfig({
  resolve: {
    // Expressions ancrées, et non des chaînes : Vite fait de la correspondance
    // par sous-chaîne, si bien qu'un `find: '@ionic/angular'` capturerait aussi
    // `@ionic/angular/standalone`.
    alias: [
      { find: /^@ionic\/angular\/standalone$/, replacement: stubs },
      { find: /^@ionic\/angular$/, replacement: stubs },
    ],
  },
});
