import type { StrategyMeta } from '@syldel/trading-shared-types';
import {
  exchangeCatalogue,
  judgeableCatalogue,
  offeredStrategies,
  resolveStrategyMeta,
} from './exchange-catalogue.util';

/**
 * Le contrat tient en une phrase : une stratégie appartient à un exchange, et
 * aucune réponse ne se fabrique quand le catalogue n'a rien dit.
 *
 * Les fixtures déclarent **deux** exchanges à dessein — le bot n'en sert qu'un
 * aujourd'hui, et c'est précisément ce qui rendait le défaut invisible. Les
 * deux portent une stratégie de même famille mais de `shortname` distinct,
 * pour qu'une résolution qui cherche « partout » se trahisse.
 */
/**
 * Une stratégie codée en dur, donc sans paramètre : le pendant d'une stratégie
 * à règles dans toutes les assertions qui suivent.
 *
 * Elle s'appelait `tol-langit-atr-v7-pro` jusqu'au 2026-10-07, date à laquelle
 * le bot l'a retirée — le rule-builder l'exprimant intégralement. Un double qui
 * nomme une stratégie que le serveur ne sert plus décrit une réponse
 * impossible, et ce dépôt tient qu'une simulation qui mente est pire que pas de
 * simulation.
 */
const ORACLE_FLOW: StrategyMeta = {
  name: 'Oracle Flow Reversion',
  shortname: 'oracle-flow-reversion',
};

const ADVANCED_RULES: StrategyMeta = {
  name: 'Advanced Logical Rules',
  shortname: 'advanced-rules',
  parameters: [
    { id: 'long.entry', label: 'Long Entry Rules', type: 'rule-builder', defaultValue: null },
  ],
};

const BINANCE_ONLY: StrategyMeta = {
  name: 'Spot Grid',
  shortname: 'spot-grid',
};

const BY_EXCHANGE: Record<string, StrategyMeta[]> = {
  hyperliquid: [ORACLE_FLOW, ADVANCED_RULES],
  binance: [BINANCE_ONLY],
};

describe('exchangeCatalogue', () => {
  it('serves the strategies of the named exchange, and only those', () => {
    const catalogue = exchangeCatalogue(BY_EXCHANGE, 'binance');

    expect(catalogue).toEqual({
      state: 'served',
      exchangeKey: 'binance',
      strategies: [BINANCE_ONLY],
    });
    expect(offeredStrategies(catalogue)).not.toContain(ORACLE_FLOW);
  });

  it('separates “not loaded yet” from “nothing declared for this exchange”', () => {
    // Deux silences qui ne veulent pas dire la même chose : le premier interdit
    // tout verdict, le second en est un.
    expect(exchangeCatalogue(null, 'hyperliquid').state).toBe('not-loaded');
    expect(exchangeCatalogue(BY_EXCHANGE, 'kraken')).toEqual({
      state: 'undeclared',
      exchangeKey: 'kraken',
    });
  });

  it('treats an empty answer as an answer', () => {
    // `{}` est un catalogue servi qui ne déclare rien, pas un chargement en
    // cours : seul `null` signifie « on ne sait pas ».
    expect(exchangeCatalogue({}, 'hyperliquid').state).toBe('undeclared');
  });

  it('asks nothing while no exchange is chosen', () => {
    expect(exchangeCatalogue(BY_EXCHANGE, '').state).toBe('no-exchange');
    expect(exchangeCatalogue(BY_EXCHANGE, undefined).state).toBe('no-exchange');
    expect(exchangeCatalogue(BY_EXCHANGE, '   ').state).toBe('no-exchange');
  });
});

describe('offeredStrategies', () => {
  it('offers nothing rather than falling back on another exchange', () => {
    // La règle qui a coûté le défaut : un sélecteur vide est exact, une liste
    // empruntée à un autre exchange est une invitation à enregistrer une paire
    // que le bot n'exécutera pas.
    expect(offeredStrategies(exchangeCatalogue(BY_EXCHANGE, 'kraken'))).toEqual([]);
    expect(offeredStrategies(exchangeCatalogue(null, 'hyperliquid'))).toEqual([]);
    expect(offeredStrategies(exchangeCatalogue(BY_EXCHANGE, ''))).toEqual([]);
  });
});

describe('judgeableCatalogue', () => {
  it('refuses to judge while nothing authoritative has arrived', () => {
    expect(judgeableCatalogue(exchangeCatalogue(null, 'hyperliquid'))).toBeNull();
    expect(judgeableCatalogue(exchangeCatalogue(BY_EXCHANGE, ''))).toBeNull();
  });

  it('judges an undeclared exchange on an empty catalogue, not on ignorance', () => {
    // La liste des exchanges servie par le bot vient du même enregistrement :
    // un exchange qui n'y figure pas est un exchange sans stratégie. `[]` fait
    // rendre `unknown-shortname`, donc la paire est signalée — ce que `null`
    // n'aurait pas fait.
    expect(judgeableCatalogue(exchangeCatalogue(BY_EXCHANGE, 'kraken'))).toEqual([]);
  });
});

describe('resolveStrategyMeta', () => {
  it('resolves within the exchange, never across the whole catalogue', () => {
    const hyperliquid = exchangeCatalogue(BY_EXCHANGE, 'hyperliquid');

    expect(resolveStrategyMeta(hyperliquid, 'oracle-flow-reversion')).toBe(ORACLE_FLOW);
    // Servie par le bot, mais pas sur cet exchange : la résoudre reviendrait à
    // charger le sélecteur d'une valeur absente de ses propres options.
    expect(resolveStrategyMeta(hyperliquid, 'spot-grid')).toBeUndefined();
  });

  it('matches the way the bot routes, so a verdict and a resolution agree', () => {
    // Le moteur compare sur `toLowerCase().trim()`. Une casse différente était
    // jugée saine par `pairStrategyStatus` et introuvable ici : sélecteur vide,
    // aucune bannière, aucune explication.
    expect(
      resolveStrategyMeta(exchangeCatalogue(BY_EXCHANGE, 'hyperliquid'), ' Advanced-Rules '),
    ).toBe(ADVANCED_RULES);
  });

  it('resolves nothing when there is nothing to resolve on', () => {
    expect(
      resolveStrategyMeta(exchangeCatalogue(BY_EXCHANGE, 'hyperliquid'), undefined),
    ).toBeUndefined();
    expect(
      resolveStrategyMeta(exchangeCatalogue(BY_EXCHANGE, 'hyperliquid'), '  '),
    ).toBeUndefined();
    expect(
      resolveStrategyMeta(exchangeCatalogue(null, 'hyperliquid'), 'advanced-rules'),
    ).toBeUndefined();
  });
});
