import type { LogicalGroup, StrategyRules } from '@syldel/trading-shared-types';
import type { WatchlistItem } from '../../watchlist/models/watchlist-item.model';
import { migrateLegacyWatchlistStrategies } from './legacy-strategy-migration.util';

const rules: StrategyRules = {
  long: {
    entry: {
      type: 'logical',
      operator: 'AND',
      conditions: [
        {
          type: 'comparison',
          left: { type: 'price', field: 'close' },
          operator: 'GT',
          right: { type: 'number', value: 1 },
        },
      ],
    } as LogicalGroup,
  },
};

function legacyItem(coin: string, strategy: unknown): WatchlistItem {
  return { coin, interval: '1h', addedAt: 1, activeStrategy: strategy } as unknown as WatchlistItem;
}

describe('migrateLegacyWatchlistStrategies', () => {
  it('reports nothing to do on already-migrated items', () => {
    const items: WatchlistItem[] = [
      {
        coin: 'BTC',
        interval: '1h',
        addedAt: 1,
        strategyRefs: [{ strategyId: 's1', visible: true }],
      },
    ];

    const result = migrateLegacyWatchlistStrategies(items);

    expect(result.changed).toBe(false);
    expect(result.recovered).toEqual([]);
    expect(result.items).toEqual(items);
  });

  it('turns a copied strategy into a library document plus a reference', () => {
    const items = [legacyItem('BTC', { id: 's1', name: 'Breakout', rules })];

    const result = migrateLegacyWatchlistStrategies(items, 1000);

    expect(result.changed).toBe(true);
    expect(result.recovered).toEqual([
      {
        id: 's1',
        name: 'Breakout',
        rules,
        createdAt: 1000,
        updatedAt: 1000,
        schemaVersion: 1,
      },
    ]);
    expect(result.items[0].strategyRefs).toEqual([{ strategyId: 's1', visible: true }]);
    expect('activeStrategy' in result.items[0]).toBe(false);
  });

  // Conserver l'id d'origine est ce qui rend la migration rejouable et évite de
  // dupliquer une stratégie partagée par deux charts.
  it('recovers a strategy shared by two charts only once, under its original id', () => {
    const items = [
      legacyItem('BTC', { id: 's1', name: 'Shared', rules }),
      legacyItem('ETH', { id: 's1', name: 'Shared', rules }),
    ];

    const result = migrateLegacyWatchlistStrategies(items);

    expect(result.recovered).toHaveLength(1);
    expect(result.items.map((item) => item.strategyRefs)).toEqual([
      [{ strategyId: 's1', visible: true }],
      [{ strategyId: 's1', visible: true }],
    ]);
  });

  it('drops a copy that carried no rules, recovering nothing', () => {
    const items = [legacyItem('BTC', { id: 's1', name: 'Hard-coded strategy' })];

    const result = migrateLegacyWatchlistStrategies(items);

    expect(result.changed).toBe(true);
    expect(result.recovered).toEqual([]);
    expect(result.items[0].strategyRefs).toBeUndefined();
    expect('activeStrategy' in result.items[0]).toBe(false);
  });

  it('drops an explicitly null copy', () => {
    const result = migrateLegacyWatchlistStrategies([legacyItem('BTC', null)]);

    expect(result.changed).toBe(true);
    expect(result.recovered).toEqual([]);
    expect('activeStrategy' in result.items[0]).toBe(false);
  });

  it('keeps the other fields of the item intact', () => {
    const items = [
      {
        coin: 'BTC',
        interval: '4h',
        addedAt: 42,
        activeIndicators: [
          { id: 'i1', request: { name: 'ema', period: 9 }, visible: true, color: '#fff' },
        ],
        activeStrategy: { id: 's1', name: 'Breakout', rules },
      } as unknown as WatchlistItem,
    ];

    const result = migrateLegacyWatchlistStrategies(items);

    expect(result.items[0].coin).toBe('BTC');
    expect(result.items[0].interval).toBe('4h');
    expect(result.items[0].addedAt).toBe(42);
    expect(result.items[0].activeIndicators).toHaveLength(1);
  });
});
