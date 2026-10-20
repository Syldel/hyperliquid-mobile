import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * ============================================================================
 * 🛑 PAS DE RÈGLE DE NOMMAGE DE MARCHÉ ÉCRITE À LA MAIN
 *
 * « Est-ce un spot ? » et « de quel dex ? » se décident par `hlMarketKind` et `hlPerpDexOf`
 * (`@syldel/hl-shared-types`), via `core/utils/market-kind.util.ts`. Le mobile en gardait cinq copies,
 * toutes différentes (`includes('/')`, `includes('/') || includes('-')`, `startsWith('@') || includes('/')`,
 * et deux découpes sur `:`). Mesuré le 2026-10-19 : sous leur nom brut, `includes('/')` ne reconnaît que 1
 * des 334 paires spot réelles — les 333 autres s'appellent `@N` —, ce qui affichait « Long/Short » pour un
 * ordre spot et empêchait de l'annuler.
 *
 * Ce test lit le **code source** et échoue sur toute forme de ces règles hors des fichiers listés, commentaires
 * retirés avant lecture. Si un usage de `/`, `-`, `:` ou `@` n'est pas une règle de nommage de marché, l'écrire
 * autrement est presque toujours possible ; à défaut, l'ajouter à `ALLOWED` avec la raison, ce qui rend la
 * dérogation visible à la relecture. Même principe que `no-catalog-imports.spec.ts` et que son pendant côté bot.
 * ============================================================================
 */

const APP = join(__dirname, '..', '..');

/**
 * Les dérogations, **à la ligne** : `fichier relatif :: ligne telle qu'écrite` → pourquoi. Une ligne exemptée ne
 * rend pas son fichier libre : toute autre occurrence reste refusée.
 */
const ALLOWED: Record<string, string> = {
  "core/services/hyperliquid-cache.service.ts :: return coin.toUpperCase().split('-')[0];":
    '`normalizeCoin` : normalisation de saisie, pas une règle spot/dex. Elle met en majuscules (`kPEPE` devient ' +
    "`KPEPE`) et coupe après un `-` ; les deux côtés d'une comparaison passent par elle, donc elle concorde avec " +
    'elle-même. À reprendre à part, en résolvant le nom contre la méta (docs/roadmap.md).',
  "features/secure/open-orders/open-orders.page.ts :: const parts = coin.split(':');":
    '`normalizeCoin` de la liste des ordres : met en majuscules la partie après `dex:`. Même sujet, même reprise à part.',
};

/**
 * `.includes('/')`, `.includes('-')`, `.includes(':')`, `.indexOf(':')`, `.split(':')`, `.split('-')`,
 * `.startsWith('@')` — sur un littéral d'un caractère, quel que soit le guillemet.
 */
const HANDMADE = /\.(?:includes|indexOf|split|startsWith)\(\s*(['"`])[/:@-]\1\s*\)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Retire les commentaires (blocs et fins de ligne), en gardant les numéros de ligne. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('no hand-made market naming rule', () => {
  const files = sourceFiles(APP);

  const offenders = files
    .map((path) => ({ path, rel: relative(APP, path).replace(/\\/g, '/') }))
    .flatMap(({ path, rel }) =>
      withoutComments(readFileSync(path, 'utf-8'))
        .split('\n')
        .map((line, index) => ({ rel, line: index + 1, text: line.trim() }))
        .filter(({ text }) => HANDMADE.test(text))
        .filter(({ text }) => !(`${rel} :: ${text}` in ALLOWED)),
    );

  // Une dérogation dont la ligne a disparu est périmée : elle exempterait en silence une ligne future identique.
  it('has no stale exemption: every allowed line still exists in its file', () => {
    const present = new Set(
      files.flatMap((path) => {
        const rel = relative(APP, path).replace(/\\/g, '/');
        return withoutComments(readFileSync(path, 'utf-8'))
          .split('\n')
          .map((line) => `${rel} :: ${line.trim()}`);
      }),
    );

    expect(Object.keys(ALLOWED).filter((key) => !present.has(key))).toEqual([]);
  });

  it('finds no includes/indexOf/split/startsWith on "/", "-", ":" or "@" outside tests', () => {
    expect(offenders.map((o) => `${o.rel}:${o.line}  ${o.text}`)).toEqual([]);
  });

  it('actually reads the source: the scan sees the files it is meant to guard', () => {
    // Sans ceci, un chemin faux ferait passer le garde-fou sur zéro fichier.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((p) => p.endsWith(join('core', 'utils', 'market-kind.util.ts')))).toBe(true);
    expect(
      files.some((p) => p.endsWith(join('core', 'services', 'hyperliquid-market.service.ts'))),
    ).toBe(true);
  });

  describe('the pattern itself', () => {
    it.each([
      "coin.includes('/')",
      "coin.includes('-')",
      "coin.includes(':')",
      "coin.indexOf(':')",
      "pairName.split(':')",
      "coin.split('-')[0]",
      "key.startsWith('@')",
      'name.includes( "/" )',
      "x.includes('/') || x.includes('-')",
    ])('catches %s', (code) => {
      expect(HANDMADE.test(code)).toBe(true);
    });

    it.each([
      "name.includes('USDC')",
      "path.split('/')[0] + 'x'.length",
      "list.join(':')",
      '`${dex}:${coin}`',
      'key.startsWith(`${coin}:${interval}:`)',
      "text.replace(/[:.]/g, '-')",
      "a.split('|')",
    ])('lets %s through', (code) => {
      // `path.split('/')` est volontairement attrapé plus haut : `split` sur `/` est une règle de nommage
      // possible. Seuls les cas ci-dessous sont des usages qui n'en sont pas.
      expect(HANDMADE.test(code)).toBe(code.includes("split('/')"));
    });

    it('ignores what a comment says about it', () => {
      expect(withoutComments("// coin.includes('/') était la règle\nconst a = 1;")).not.toMatch(
        HANDMADE,
      );
      expect(withoutComments("/* coin.split(':') */\nconst a = 1;")).not.toMatch(HANDMADE);
    });

    it('keeps a line that merely holds a URL-like `//` before the rule', () => {
      expect(withoutComments("const u = 'http://x'; coin.includes('/');")).toMatch(HANDMADE);
    });
  });
});

/**
 * Les genres de marché se lisent **un à un**, jamais par exclusion. `hlMarketKind` a gagné `outcome` (HIP-4, types
 * partagés 0.0.28) : `!isSpotMarket(name)` ou `kind !== 'spot'` rangeaient pourtant tout le reste parmi les perps, et
 * `Exclude<HLMarketKind, 'spot'>` aurait déclaré un outcome supporté. Aucune de ces formes ne ressent l'ajout : le
 * compilateur se tait. `=== 'perp' || === 'builderPerp'` (ou `isPerpMarket`) fait échouer la compilation à l'arrivée
 * d'un nouveau genre.
 */
const EXCLUSION_ALLOWED: Record<string, string> = {
  'core/services/hyperliquid-market.service.ts :: if (!isSpotMarket(coin)) return of(coin);':
    "Résolution des noms d'affichage : seul un spot a un autre nom que le sien ; tout le reste — perp, " +
    'outcome, nom douteux — est rendu tel quel, ce qui est la bonne lecture pour chacun. Aucun genre ' +
    "n'est déduit de ce test.",
};

describe('no market kind read by exclusion', () => {
  const BY_EXCLUSION =
    /!==?\s*(['"`])(?:spot|outcome|builderPerp)\1|Exclude\s*<\s*HLMarketKind|!\s*isSpotMarket\s*\(/;

  const files = sourceFiles(APP);

  const offenders = files.flatMap((path) => {
    const rel = relative(APP, path).replace(/\\/g, '/');
    return withoutComments(readFileSync(path, 'utf-8'))
      .split('\n')
      .map((line, index) => ({ rel, line: index + 1, text: line.trim() }))
      .filter(({ text }) => BY_EXCLUSION.test(text))
      .filter(({ text }) => !(`${rel} :: ${text}` in EXCLUSION_ALLOWED));
  });

  it('does not read a market kind by exclusion outside the listed lines', () => {
    expect(offenders.map((o) => `${o.rel}:${o.line}  ${o.text}`)).toEqual([]);
  });

  it('has no stale exemption: every allowed line still exists in its file', () => {
    const present = new Set(
      files.flatMap((path) => {
        const rel = relative(APP, path).replace(/\\/g, '/');
        return withoutComments(readFileSync(path, 'utf-8'))
          .split('\n')
          .map((line) => `${rel} :: ${line.trim()}`);
      }),
    );

    expect(Object.keys(EXCLUSION_ALLOWED).filter((key) => !present.has(key))).toEqual([]);
  });

  it('catches the forms it is meant to forbid, and lets the positive reading through', () => {
    expect(BY_EXCLUSION.test("if (kind !== 'spot') {")).toBe(true);
    expect(BY_EXCLUSION.test('if (kind != "outcome")')).toBe(true);
    expect(BY_EXCLUSION.test("type T = Exclude<HLMarketKind, 'spot'>;")).toBe(true);
    expect(BY_EXCLUSION.test('if (!isSpotMarket(coin)) return of(coin);')).toBe(true);
    expect(BY_EXCLUSION.test("if (kind === 'spot') {")).toBe(false);
    expect(BY_EXCLUSION.test('if (isSpotMarket(coin)) {')).toBe(false);
    expect(BY_EXCLUSION.test('return isPerpMarket(name);')).toBe(false);
  });

  it('ignores what a comment says about it', () => {
    expect(withoutComments("// kind !== 'spot' lisait tout le reste\nconst a = 1;")).not.toMatch(
      BY_EXCLUSION,
    );
  });
});
