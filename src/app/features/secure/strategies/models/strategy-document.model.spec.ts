import type { IExchangeStrategy, StrategyParameter } from '@syldel/trading-shared-types';
import {
  ruleBranchesOf,
  STRATEGY_DOCUMENT_SCHEMA_VERSION,
  toStrategyDocument,
} from './strategy-document.model';

const PARAMETERS: StrategyParameter[] = [
  { id: 'long.entry', label: 'Long Entry Rules', type: 'rule-builder', defaultValue: null },
  { id: 'atrPeriod', label: 'ATR Period', type: 'number', defaultValue: 14 },
  { id: 'short.exit', label: 'Short Exit Rules', type: 'rule-builder', defaultValue: null },
  { id: 'useOracle', label: 'Use Oracle', type: 'boolean', defaultValue: false },
];

describe('ruleBranchesOf', () => {
  it('keeps the rule-builder fields and drops the scalar ones', () => {
    expect(ruleBranchesOf(PARAMETERS)).toEqual([
      { id: 'long.entry', label: 'Long Entry Rules' },
      { id: 'short.exit', label: 'Short Exit Rules' },
    ]);
  });

  // C'est le test « cette stratégie se pilote-t-elle par règles ? ».
  it('returns nothing for a hard-coded strategy', () => {
    expect(ruleBranchesOf(undefined)).toEqual([]);
    expect(ruleBranchesOf([])).toEqual([]);
    expect(ruleBranchesOf([PARAMETERS[1]])).toEqual([]);
  });

  it('keeps the labels the server sent rather than deriving them from the id', () => {
    expect(ruleBranchesOf(PARAMETERS).map((branch) => branch.label)).toEqual([
      'Long Entry Rules',
      'Short Exit Rules',
    ]);
  });
});

describe('toStrategyDocument', () => {
  const STRATEGY: IExchangeStrategy = {
    name: 'BTC breakout',
    shortname: 'advanced-rules',
    description: 'Breaks out of the range',
    rules: { long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } },
  };

  it('carries the name, description and rules over', () => {
    const document = toStrategyDocument(STRATEGY, 'st_1');

    expect(document.id).toBe('st_1');
    expect(document.name).toBe('BTC breakout');
    expect(document.description).toBe('Breaks out of the range');
    expect(document.rules).toBe(STRATEGY.rules);
  });

  it('omits the description rather than storing an empty one', () => {
    const document = toStrategyDocument({ name: 'X', shortname: 'advanced-rules' }, 'st_2');

    expect('description' in document).toBe(false);
  });

  it('starts from empty rules when the pair has none', () => {
    expect(toStrategyDocument({ name: 'X', shortname: 'advanced-rules' }, 'st_3').rules).toEqual(
      {},
    );
  });

  // Rien dans `IExchangeStrategy` ne dit quel build a écrit ces règles : le
  // document repart donc de la version courante, sans prétendre en savoir plus.
  it('stamps the current schema version', () => {
    expect(toStrategyDocument(STRATEGY, 'st_4').schemaVersion).toBe(
      STRATEGY_DOCUMENT_SCHEMA_VERSION,
    );
  });

  it('leaves behind everything that is not rules', () => {
    const document = toStrategyDocument(
      { ...STRATEGY, settings: { atrPeriod: 14 }, protective: { entries: [] } },
      'st_5',
    );

    expect('settings' in document).toBe(false);
    expect('protective' in document).toBe(false);
  });
});
