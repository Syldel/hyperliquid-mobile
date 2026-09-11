import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * ============================================================================
 * 🛑 NO CATALOG IMPORTS
 * Empêche le mobile de reconstruire localement une copie du catalogue que le
 * bot expose déjà (`GET /exchanges/meta`) — indicateurs, transforms,
 * functions, grammaire du rule-builder. Un build mobile qui dérive sa propre
 * liste/ordre depuis le paquet compilé peut diverger silencieusement d'un
 * bot plus récent (voir `VersionMismatchBannerComponent`, qui couvre la
 * dérive de VERSION mais pas celle-ci : deux builds à la même version du
 * paquet ne divergent jamais entre eux, mais dériver du paquet au lieu de
 * lire la réponse serveur reste une seconde source de vérité en germe).
 *
 * Ne s'applique qu'aux imports de VALEURS (`import { X } from '...'`) : un
 * `import type { X }` est erasé à la compilation, donc structurellement sans
 * risque de dérive (voir indicator-default-styles.util.ts). La détection
 * `import type` est volontairement simple (mot-clé juste après `import`) —
 * un `import { type X, Y }` avec modificateur par-spécificateur n'est pas
 * reconnu, mais n'est utilisé nulle part dans ce repo à ce jour.
 * ============================================================================
 */

const PACKAGE = '@syldel/trading-shared-types';

/**
 * Symboles qui exposent un catalogue ou dérivent une clé/donnée du registre
 * compilé, plutôt qu'une donnée servie par `/exchanges/meta`. Volontairement
 * distinct des types et des fonctions pures sur l'AST (`Operand`, `RuleNode`,
 * `walkRuleTree`, `collectStrategyRulesIssues`...), qui ne portent aucun
 * catalogue et restent libres d'usage partout.
 *
 * La dépendance peut être **transitive**, et c'est le piège : `buildOperandKey`
 * a longtemps figuré dans la liste des fonctions « pures sur l'AST »
 * ci-dessus. Elle l'est pour tout l'arbre sauf une branche — `indicator`
 * délègue à `buildIndicatorKeyFromOperand`, qui complète les paramètres
 * absents depuis `INDICATOR_DEFAULTS` compilé. Un `ema` sans période explicite
 * se lit donc `ema_9` ici et `ema_12` sur un bot dont les défauts ont bougé, et
 * la série correspondante devient introuvable dans la réponse. Juger une
 * fonction sur sa signature ne suffit pas : il faut lire ce qu'elle appelle.
 */
const FORBIDDEN_CATALOG_IMPORTS = [
  'isIndicatorName',
  'getIndicatorSubFieldNames',
  'isMultiLineIndicator',
  'INDICATOR_SUBFIELDS',
  'INDICATOR_DEFAULTS',
  'INDICATOR_REGISTRY',
  'AVAILABLE_INDICATORS_METADATA',
  'AVAILABLE_TRANSFORMS_METADATA',
  'AVAILABLE_FUNCTIONS_METADATA',
  'RULE_BUILDER_GRAMMAR',
  'resolveIndicatorParams',
  'buildIndicatorKey',
  'buildIndicatorKeyFromOperand',
  // Transitivement dépendante du registre compilé — voir l'en-tête ci-dessus.
  // `AnalysisRequest.expressions[]` s'en passe en portant un `id` calculé
  // localement (strategy-operands.util.ts).
  'buildOperandKey',
  'computeStrategyRulesLookback',
  'computeOperandLookback',
  'getIndicatorOperandLookback',
] as const;

/**
 * Exceptions nominatives, chacune documentée à son point d'usage. Un fichier
 * absent de cette liste n'a droit à aucun des noms ci-dessus.
 */
const ALLOWED_EXCEPTIONS: Record<string, readonly string[]> = {
  // Clé de cache LOCALE (couleur sauvegardée dans Preferences) et libellé
  // d'affichage — jamais une clé de lookup sur une réponse serveur. Voir le
  // commentaire en tête de indicator-key.util.ts.
  'src/app/shared/components/indicator-picker/utils/indicator-key.util.ts': [
    'buildIndicatorKeyFromOperand',
  ],
};

const IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@syldel\/trading-shared-types['"]/g;

function extractSpecifiers(rawBraceContent: string): string[] {
  return rawBraceContent
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s
        .split(/\s+as\s+/)[0]
        .replace(/^type\s+/, '')
        .trim(),
    );
}

/** Logique pure, testée isolément ci-dessous — indépendante du système de fichiers. */
export function findCatalogImportViolations(
  content: string,
  allowedNames: readonly string[] = [],
): string[] {
  const violations: string[] = [];

  for (const match of content.matchAll(IMPORT_RE)) {
    const isTypeOnly = !!match[1];
    if (isTypeOnly) continue; // erasé à la compilation — sans risque de dérive

    for (const name of extractSpecifiers(match[2])) {
      if (!(FORBIDDEN_CATALOG_IMPORTS as readonly string[]).includes(name)) continue;
      if (allowedNames.includes(name)) continue;
      violations.push(name);
    }
  }

  return violations;
}

function listTsFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      files.push(...listTsFiles(full));
      continue;
    }

    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      files.push(full);
    }
  }

  return files;
}

describe('findCatalogImportViolations (detection logic)', () => {
  it('flags a plain value import of a forbidden symbol', () => {
    const content = `import { isIndicatorName } from '@syldel/trading-shared-types';`;
    expect(findCatalogImportViolations(content)).toEqual(['isIndicatorName']);
  });

  it('flags a forbidden symbol aliased on import', () => {
    const content = `import { isIndicatorName as check } from '@syldel/trading-shared-types';`;
    expect(findCatalogImportViolations(content)).toEqual(['isIndicatorName']);
  });

  it('flags a forbidden symbol inside a multi-line, multi-symbol import', () => {
    const content = `import {\n  IndicatorMetadata,\n  isIndicatorName,\n  isMultiLineIndicator,\n} from '@syldel/trading-shared-types';`;
    expect(findCatalogImportViolations(content).sort()).toEqual(
      ['isIndicatorName', 'isMultiLineIndicator'].sort(),
    );
  });

  it('ignores an "import type" of the same symbol (erased at compile time)', () => {
    const content = `import type { INDICATOR_SUBFIELDS } from '@syldel/trading-shared-types';`;
    expect(findCatalogImportViolations(content)).toEqual([]);
  });

  it('ignores symbols not in the forbidden list (types, AST helpers)', () => {
    const content = `import { Operand, walkRuleTree, collectStrategyRulesIssues } from '@syldel/trading-shared-types';`;
    expect(findCatalogImportViolations(content)).toEqual([]);
  });

  // Sa signature ne prend qu'un `Operand` : rien n'y annonce qu'elle lit le
  // registre compilé une branche plus bas.
  it('flags a symbol that depends on the registry only transitively', () => {
    const content = `import { buildOperandKey } from '@syldel/trading-shared-types';`;
    expect(findCatalogImportViolations(content)).toEqual(['buildOperandKey']);
  });

  it('ignores imports from an unrelated package', () => {
    const content = `import { isIndicatorName } from 'some-other-package';`;
    expect(findCatalogImportViolations(content)).toEqual([]);
  });

  it('allows a forbidden symbol explicitly passed as allowed (documented exception)', () => {
    const content = `import { buildIndicatorKeyFromOperand } from '@syldel/trading-shared-types';`;
    expect(findCatalogImportViolations(content, ['buildIndicatorKeyFromOperand'])).toEqual([]);
  });
});

describe('no-catalog-imports (repo-wide regression guard)', () => {
  it(`forbids importing catalog symbols from "${PACKAGE}" as values outside documented exceptions`, () => {
    const srcAppRoot = join(__dirname, '..', '..'); // src/app/shared/testing → src/app
    const repoRoot = join(srcAppRoot, '..', '..');
    const report: string[] = [];

    for (const absPath of listTsFiles(srcAppRoot)) {
      const relPath = relative(repoRoot, absPath).replace(/\\/g, '/');
      const content = readFileSync(absPath, 'utf-8');
      const allowed = ALLOWED_EXCEPTIONS[relPath] ?? [];

      for (const name of findCatalogImportViolations(content, allowed)) {
        report.push(
          `${relPath}: imports "${name}" as a value from "${PACKAGE}" — read it from ` +
            `/exchanges/meta (BotService) instead, or add a documented exception here ` +
            `if it's genuinely local-only (see indicator-key.util.ts for the pattern).`,
        );
      }
    }

    expect(report).toEqual([]);
  });
});
