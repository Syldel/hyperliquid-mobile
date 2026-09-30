import type { HLPerpMarketInfo } from '@syldel/hl-shared-types';
import {
  dexesToLoad,
  dexLabel,
  dexToLoadFor,
  isKnownUnexecutableMarket,
  pairMarketStatus,
  type PerpMarketCatalogue,
} from './pair-market-status.util';

/**
 * Le contrat tient en une phrase : une paire configurée sur un marché qui
 * n'existe plus doit se voir — et une paire dont on ne sait rien ne doit pas
 * être accusée.
 *
 * L'incident qui a motivé ce module, mesuré le 2026-09-30 : `vntl:ROBOT` était
 * configurée sur l'écran Bot Strategies, avec ratio, intervalle et trois
 * protections, sur un dex dont `meta({dex:'vntl'})` rend **15 actifs sur 15
 * délistés**. Rien ne le disait. Même constat pour `cash` (17/17) et `hyna`
 * (25/25), tous deux éteints par annonce officielle — et `perpDexs` continue
 * pourtant de les servir, parce que c'est un registre de déploiements et non
 * un catalogue de marchés vivants.
 *
 * La partition reprend délibérément celle de [`pair-strategy-status.util`], y
 * compris son quatrième état : le catalogue arrive du réseau, et accuser une
 * paire sur une absence de réponse serait la décision qu'un client n'a pas le
 * droit de prendre.
 */

/** Le dex principal tel que l'API le rend : des noms nus, sans préfixe. */
const MAIN_UNIVERSE: HLPerpMarketInfo[] = [
  { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
  { name: 'ETH', szDecimals: 4, maxLeverage: 25, isDelisted: false },
  { name: 'SOL', szDecimals: 2, maxLeverage: 20 },
];

/** Ventuals, relevé le 2026-09-30 : tout l'univers est délisté. */
const VNTL_UNIVERSE: HLPerpMarketInfo[] = [
  { name: 'vntl:ROBOT', szDecimals: 2, maxLeverage: 5, isDelisted: true },
  { name: 'vntl:SPACEX', szDecimals: 2, maxLeverage: 5, isDelisted: true },
];

/** Paragon, vivant au même relevé. */
const PARA_UNIVERSE: HLPerpMarketInfo[] = [{ name: 'para:TOTAL2', szDecimals: 2, maxLeverage: 5 }];

function catalogue(over: Partial<PerpMarketCatalogue> = {}): PerpMarketCatalogue {
  return {
    dexNames: ['xyz', 'para', 'mkts', 'io', 'vntl'],
    universeByDex: new Map([
      ['', MAIN_UNIVERSE],
      ['vntl', VNTL_UNIVERSE],
      ['para', PARA_UNIVERSE],
    ]),
    ...over,
  };
}

describe('dexToLoadFor', () => {
  it('maps a bare perp name to the main dex', () => {
    expect(dexToLoadFor('BTC')).toBe('');
  });

  it('maps a HIP-3 pair to the dex carried by its prefix', () => {
    expect(dexToLoadFor('vntl:ROBOT')).toBe('vntl');
  });

  // Le catalogue perp ne parle pas des marchés spot : Hyperliquid ne publie
  // aucun drapeau de délistage pour eux (`spotMeta.universe` porte
  // `tokens`, `name`, `index`, `isCanonical` — relevé le 2026-09-30).
  it('has nothing to load for a canonical spot pair', () => {
    expect(dexToLoadFor('PURR/USDC')).toBeNull();
  });

  // Le piège mesuré : sur 330 paires spot, la grande majorité s'appelle `@N`
  // et ne porte donc **ni** barre oblique **ni** deux-points. Les traiter par
  // défaut comme des perps les ferait chercher — et manquer — dans l'univers
  // du dex principal, donc accuser à tort un marché parfaitement vivant.
  it('has nothing to load for a spot pair named by its index', () => {
    expect(dexToLoadFor('@107')).toBeNull();
  });

  it('has nothing to load for an empty pair name', () => {
    expect(dexToLoadFor('')).toBeNull();
  });
});

describe('pairMarketStatus', () => {
  it('accepts a live market of the main dex', () => {
    expect(pairMarketStatus('BTC', catalogue())).toBe('ok');
  });

  // `isDelisted` est optionnel : absent et `false` doivent se valoir.
  it('treats an explicit isDelisted false exactly like an absent flag', () => {
    expect(pairMarketStatus('ETH', catalogue())).toBe('ok');
  });

  it('accepts a live market of a HIP-3 dex', () => {
    expect(pairMarketStatus('para:TOTAL2', catalogue())).toBe('ok');
  });

  // Le cas réel, celui qui a ouvert ce chantier.
  it('reports a configured pair whose HIP-3 market is delisted', () => {
    expect(pairMarketStatus('vntl:ROBOT', catalogue())).toBe('delisted');
  });

  it('reports a delisted market of the main dex', () => {
    const universeByDex = new Map([
      ['', [{ name: 'XMR', szDecimals: 2, maxLeverage: 5, isDelisted: true }]],
    ]);

    expect(pairMarketStatus('XMR', catalogue({ universeByDex }))).toBe('delisted');
  });

  it('reports a pair the loaded universe does not carry', () => {
    expect(pairMarketStatus('NOPE', catalogue())).toBe('unknown-market');
  });

  // Comparaison exacte : un préfixe commun n'est pas le même marché. Sans ce
  // test, un passage à `startsWith` rendrait `ok` pour une paire inexistante.
  it('matches the market name exactly, not by prefix', () => {
    expect(pairMarketStatus('vntl:ROBO', catalogue())).toBe('unknown-market');
  });

  // Le quatrième état : l'univers de ce dex n'est pas encore arrivé. Ne pas
  // savoir n'est pas un défaut de la paire.
  it('withholds judgement while the universe of that dex is not loaded', () => {
    expect(pairMarketStatus('xyz:AAPL', catalogue())).toBe('unverified');
  });

  // Le dex principal n'est jamais listé par `perpDexs` — celui-ci ne sert que
  // les HIP-3. Le garde de registre ne doit donc pas s'y appliquer, sans quoi
  // toute paire ordinaire serait déclarée inexistante le temps que son univers
  // arrive.
  it('withholds judgement while the main dex universe is not loaded', () => {
    const universeByDex = new Map<string, readonly HLPerpMarketInfo[]>([['vntl', VNTL_UNIVERSE]]);

    expect(pairMarketStatus('BTC', catalogue({ universeByDex }))).toBe('unverified');
  });

  // Mais une fois `perpDexs` chargé, un dex qui n'y figure pas n'existe pas :
  // c'est une réponse, pas une absence de réponse.
  it('reports a dex that a loaded registry does not serve', () => {
    expect(pairMarketStatus('ghost:BTC', catalogue())).toBe('unknown-market');
  });

  // Tant que le registre lui-même n'est pas là, la même paire n'est plus
  // jugeable : le même verdict ne doit pas sortir des deux situations.
  it('withholds judgement on an unserved dex while the registry is not loaded', () => {
    expect(pairMarketStatus('ghost:BTC', catalogue({ dexNames: null }))).toBe('unverified');
  });

  it('withholds judgement on a spot pair, which carries no delisting flag', () => {
    expect(pairMarketStatus('PURR/USDC', catalogue())).toBe('unverified');
    expect(pairMarketStatus('@107', catalogue())).toBe('unverified');
  });

  // Un univers **vide** est une réponse du catalogue, pas une absence : le dex
  // est servi et ne porte aucun marché. `abcd` est dans ce cas au relevé.
  it('reports a pair as unknown when its dex serves an empty universe', () => {
    const universeByDex = new Map<string, readonly HLPerpMarketInfo[]>([['abcd', []]]);

    expect(pairMarketStatus('abcd:BTC', catalogue({ dexNames: ['abcd'], universeByDex }))).toBe(
      'unknown-market',
    );
  });
});

describe('isKnownUnexecutableMarket', () => {
  it('is certain about a delisted market', () => {
    expect(isKnownUnexecutableMarket('delisted')).toBe(true);
  });

  it('is certain about a market no catalogue carries', () => {
    expect(isKnownUnexecutableMarket('unknown-market')).toBe(true);
  });

  // La règle qui protège l'utilisateur d'un faux diagnostic : un catalogue
  // absent ne condamne personne.
  it('never condemns a pair it could not verify', () => {
    expect(isKnownUnexecutableMarket('unverified')).toBe(false);
  });

  it('never condemns a live market', () => {
    expect(isKnownUnexecutableMarket('ok')).toBe(false);
  });
});

describe('dexesToLoad', () => {
  it('asks for the main dex when a pair is an ordinary perp', () => {
    expect(dexesToLoad(['BTC', 'ETH'])).toEqual(['']);
  });

  it('asks for each HIP-3 dex a pair points at', () => {
    expect(dexesToLoad(['vntl:ROBOT', 'xyz:AAPL'])).toEqual(['vntl', 'xyz']);
  });

  // Une même clé demandée deux fois serait deux requêtes vers Hyperliquid pour
  // la même réponse. Le dédoublonnage est ici, pas dans l'appelant.
  it('asks only once for a dex carried by several pairs', () => {
    expect(dexesToLoad(['vntl:ROBOT', 'vntl:SPACEX', 'BTC', 'SOL'])).toEqual(['vntl', '']);
  });

  it('asks for nothing on behalf of a spot pair', () => {
    expect(dexesToLoad(['PURR/USDC', '@107'])).toEqual([]);
  });

  it('asks for nothing when there is no pair at all', () => {
    expect(dexesToLoad([])).toEqual([]);
  });
});

describe('dexLabel', () => {
  /** La forme réelle de `perpDexs` : le dex principal y est un `null` de tête. */
  const DEXES = [null, { name: 'vntl', fullName: 'Ventuals' }, { name: 'abcd', fullName: '' }];

  it('names a HIP-3 dex by its full name', () => {
    expect(dexLabel('vntl', DEXES)).toBe('Ventuals');
  });

  // Un `fullName` vide n'est pas un libellé : on retombe sur la clé technique
  // plutôt que d'afficher un blanc au milieu d'une phrase.
  it('falls back to the technical key when the full name is empty', () => {
    expect(dexLabel('abcd', DEXES)).toBe('abcd');
  });

  // Le dex principal n'a pas de nom — il n'est même pas listé par `perpDexs`,
  // qui ne sert que les HIP-3. `null` fait choisir la formulation générique.
  it('has no name to offer for the main dex', () => {
    expect(dexLabel('', DEXES)).toBeNull();
  });

  it('has no name to offer for a dex the registry does not serve', () => {
    expect(dexLabel('ghost', DEXES)).toBeNull();
  });

  it('has no name to offer while the registry is not loaded', () => {
    expect(dexLabel('vntl', null)).toBeNull();
  });
});
