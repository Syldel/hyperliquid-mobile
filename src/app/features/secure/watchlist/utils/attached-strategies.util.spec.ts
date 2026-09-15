import type { StrategyRules } from '@syldel/trading-shared-types';
import {
  STRATEGY_DOCUMENT_SCHEMA_VERSION,
  type StrategyDocument,
} from '../../strategies/models/strategy-document.model';
import { partitionAttachedStrategies } from './attached-strategies.util';

/**
 * L'invariant que ces tests tiennent n'est pas « lesquelles sont valides »,
 * c'est **« ce qui est marqué à l'écran est exactement ce qui n'est pas
 * envoyé »**. Les deux sortaient jusqu'ici de deux endroits différents : la
 * page filtrait, la puce ne disait rien, et une stratégie muette était
 * indiscernable d'une stratégie sans signal sur la fenêtre affichée.
 */
function document(id: string, rules: StrategyRules): StrategyDocument {
  return {
    id,
    name: id,
    rules,
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: STRATEGY_DOCUMENT_SCHEMA_VERSION,
  };
}

const complete: StrategyRules = {
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
    },
  },
};

describe('partitionAttachedStrategies', () => {
  it('sends a strategy with a side to evaluate', () => {
    const { evaluated, skipped } = partitionAttachedStrategies([document('ok', complete)]);

    expect(evaluated.map((d) => d.id)).toEqual(['ok']);
    expect(skipped).toEqual([]);
  });

  /**
   * `POST /analysis` valide les stratégies en bloc et rejette **toute** la
   * requête si l'une d'elles n'a rien à évaluer — emportant les indicateurs,
   * qui n'y sont pour rien. D'où le filtre ; d'où, aussi, le besoin de le dire.
   */
  it('holds back a strategy with no side at all', () => {
    const { evaluated, skipped } = partitionAttachedStrategies([document('empty', {})]);

    expect(evaluated).toEqual([]);
    expect(skipped.map((d) => d.id)).toEqual(['empty']);
  });

  it('holds back a strategy whose branch is structurally broken', () => {
    const { skipped } = partitionAttachedStrategies([
      document('hollow', { long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } }),
    ]);

    expect(skipped.map((d) => d.id)).toEqual(['hollow']);
  });

  /**
   * Le cas qui décide de la forme du prédicat. Un indicateur que ce build ne
   * connaît pas dépend du **catalogue**, pas de la grammaire : il vient
   * peut-être d'un bot plus récent. Retenir la stratégie reviendrait à
   * trancher à la place du serveur — on l'envoie, et c'est lui qui refuse s'il
   * y a lieu.
   */
  it('still sends a strategy whose verdict belongs to the server', () => {
    const { evaluated, skipped } = partitionAttachedStrategies([
      document('newer', {
        long: {
          entry: {
            type: 'logical',
            operator: 'AND',
            conditions: [
              {
                type: 'comparison',
                left: { type: 'indicator', name: 'vwap' } as never,
                operator: 'GT',
                right: { type: 'number', value: 1 },
              },
            ],
          },
        },
      }),
    ]);

    expect(evaluated.map((d) => d.id)).toEqual(['newer']);
    expect(skipped).toEqual([]);
  });

  // L'ordre d'attachement est celui que l'utilisateur voit dans la bande.
  it('keeps each side in the order the charts were attached', () => {
    const { evaluated, skipped } = partitionAttachedStrategies([
      document('a', complete),
      document('b', {}),
      document('c', complete),
      document('d', {}),
    ]);

    expect(evaluated.map((d) => d.id)).toEqual(['a', 'c']);
    expect(skipped.map((d) => d.id)).toEqual(['b', 'd']);
  });

  it('answers on an empty chart without inventing anything', () => {
    expect(partitionAttachedStrategies([])).toEqual({ evaluated: [], skipped: [] });
  });
});
