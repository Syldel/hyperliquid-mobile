import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import {
  activationLabel,
  liveTrailingState,
  pinToPane,
  trailingChartMark,
  trailingStart,
  trailingStopSummary,
  trailingStopView,
} from './trailing-stop-view.util';

/**
 * Les trois premiers ordres sont recopiés de `frontendOpenOrders` sur le compte de développement :
 * S1 et S2 de la sonde du 2026-11-17, et T2 du 2026-11-16 (`nest-trading-bot/docs/hyperliquid/
 * live-check.md`). Seuls les champs lus ici sont gardés.
 */
const S1_TRACKING = {
  orderType: 'Trailing Stop Market',
  triggerCondition: 'Activation immediate, retracement 10%, best 1811.5',
  triggerPx: '1630.35',
};

const S2_WAITING = {
  orderType: 'Trailing Stop Market',
  triggerCondition: 'Activation above 2355, retracement 275, best waiting',
  triggerPx: '0.0',
};

const WRONG_SIDE_TRACKING = {
  orderType: 'Trailing Stop Market',
  triggerCondition: 'Activation above 1719.4, retracement 10%, best 1809.9',
  triggerPx: '1628.91',
};

const order = (fields: Partial<HLFrontendOpenOrder>) =>
  ({ ...S1_TRACKING, ...fields }) as Pick<
    HLFrontendOpenOrder,
    'orderType' | 'triggerCondition' | 'triggerPx'
  >;

describe('trailingStopView', () => {
  it('ignores an order that is not a native trailing stop', () => {
    expect(trailingStopView(order({ orderType: 'Stop Market' }))).toBeNull();
  });

  // Comparé à l'exact : un nom voisin n'est pas un trailing stop.
  it('ignores a label that only resembles it', () => {
    expect(trailingStopView(order({ orderType: 'Trailing Stop' }))).toBeNull();
  });

  it('reads an immediate trailing stop as tracking, with its current stop (measured)', () => {
    expect(trailingStopView(S1_TRACKING)).toEqual({
      state: 'tracking',
      stopPx: '1630.35',
      best: '1811.5',
      retracement: '10 %',
      activation: null,
    });
  });

  // `triggerPx` vaut 0.0 en attente : il ne doit jamais être lu comme un stop.
  it('reads a waiting trailing stop by its activation, not by its zero trigger (measured)', () => {
    expect(trailingStopView(S2_WAITING)).toEqual({
      state: 'waiting',
      activation: { direction: 'above', px: '2355' },
      retracement: '275 $',
    });
  });

  // Écrit tel quel par l'exchange le 2026-11-17, pour 3,5 % posé depuis l'interface officielle.
  it('rounds a float artifact to the four decimals an action can carry (measured)', () => {
    const view = trailingStopView(
      order({
        triggerCondition: 'Activation immediate, retracement 3.5000000000000004%, best 1785.44',
      }),
    );
    expect(view).toMatchObject({ state: 'tracking', retracement: '3.5 %' });
  });

  it('keeps the four decimals that can be signed', () => {
    const view = trailingStopView(
      order({ triggerCondition: 'Activation immediate, retracement 1.2345%, best 1800' }),
    );
    expect(view).toMatchObject({ retracement: '1.2345 %' });
  });

  it('keeps the activation of a trailing stop that is already tracking (measured)', () => {
    expect(trailingStopView(WRONG_SIDE_TRACKING)).toMatchObject({
      state: 'tracking',
      activation: { direction: 'above', px: '1719.4' },
    });
  });

  describe('shows what it cannot read instead of guessing', () => {
    it('an unknown text', () => {
      expect(trailingStopView(order({ triggerCondition: 'Price below 1800' }))).toEqual({
        state: 'unreadable',
        raw: 'Price below 1800',
        reason: 'Unrecognised trailing stop state',
      });
    });

    it('a missing text', () => {
      expect(
        trailingStopView(order({ triggerCondition: undefined as unknown as string })),
      ).toMatchObject({ state: 'unreadable', raw: '' });
    });

    it('a tracking state with a zero stop', () => {
      expect(trailingStopView(order({ triggerPx: '0.0' }))).toMatchObject({
        state: 'unreadable',
        reason: 'Tracking with a stop at 0.0',
      });
    });

    it('an immediate activation that is still waiting', () => {
      expect(
        trailingStopView(
          order({ triggerCondition: 'Activation immediate, retracement 10%, best waiting' }),
        ),
      ).toMatchObject({ state: 'unreadable', reason: 'Immediate tracking cannot be waiting' });
    });
  });
});

describe('trailingStopSummary', () => {
  it('says where the stop is, from what best price, and how far', () => {
    expect(trailingStopSummary(trailingStopView(S1_TRACKING)!)).toBe(
      'Stop 1630.35 · best 1811.5 · 10 %',
    );
  });

  it('says what it waits for, and what it will do then', () => {
    expect(trailingStopSummary(trailingStopView(S2_WAITING)!)).toBe(
      'Waiting above 2355 · then 275 $',
    );
  });

  it('quotes the text it could not read', () => {
    expect(
      trailingStopSummary(trailingStopView(order({ triggerCondition: 'Price below 1800' }))!),
    ).toBe('Unrecognised trailing stop state: "Price below 1800"');
  });
});

describe('activationLabel', () => {
  it('names the side the price must cross', () => {
    expect(activationLabel({ direction: 'above', px: '2355' })).toBe('Above 2355');
    expect(activationLabel({ direction: 'below', px: '1500.5' })).toBe('Below 1500.5');
  });
});

describe('trailingChartMark', () => {
  const reduceSell = { side: 'A', reduceOnly: true } as const;

  it('marks a tracking stop at its current level, in the stop tone', () => {
    expect(trailingChartMark(trailingStopView(S1_TRACKING)!, reduceSell)).toEqual({
      price: '1630.35',
      label: 'TS 1630.35',
      tone: 'stop',
    });
  });

  // Un trailing non reduce-only peut ouvrir une position : il prend la couleur de son côté.
  it('marks a tracking order that is not reduce-only in the tone of its side', () => {
    const view = trailingStopView(S1_TRACKING)!;
    expect(trailingChartMark(view, { side: 'A', reduceOnly: false })?.tone).toBe('sell');
    expect(trailingChartMark(view, { side: 'B', reduceOnly: false })?.tone).toBe('buy');
  });

  // Jamais au déclencheur `0.0` : là où il commencera à suivre.
  it('marks a waiting stop at its activation price, in a neutral tone', () => {
    expect(trailingChartMark(trailingStopView(S2_WAITING)!, reduceSell)).toEqual({
      price: '2355',
      label: 'TS ≥ 2355',
      tone: 'waiting',
    });
  });

  it('marks nothing for a state it could not read', () => {
    const view = trailingStopView(order({ triggerCondition: 'Price below 1800' }))!;
    expect(trailingChartMark(view, reduceSell)).toBeNull();
  });
});

describe('liveTrailingState', () => {
  // Les deux lectures du même ordre BTC à 14:26:38Z le 2026-11-17 (`live-check.md`, S6) : `orderStatus`
  // rendait encore l'état de la pose, et l'ordre a été rempli sous son stop.
  const FROZEN = {
    oid: 608143361101,
    orderType: 'Trailing Stop Market',
    triggerCondition: 'Activation immediate, retracement 0.3%, best 64971',
    triggerPx: '65165.9',
    limitPx: '71682.0',
  };
  const LISTED = {
    oid: 608143361101,
    triggerCondition: 'Activation immediate, retracement 0.3%, best 64893',
    triggerPx: '65087.7',
    limitPx: '71596.0',
  };

  it('takes the current state from the open orders list, not the frozen one (measured)', () => {
    expect(liveTrailingState(FROZEN, 'open', [LISTED])).toEqual({
      kind: 'live',
      order: { ...FROZEN, ...LISTED },
    });
  });

  it('says so when the open order is not in the list, instead of falling back on the frozen state', () => {
    expect(liveTrailingState(FROZEN, 'open', [])).toMatchObject({ kind: 'missing' });
  });

  it('says so when the list could not be read', () => {
    expect(liveTrailingState(FROZEN, 'open', null)).toEqual({
      kind: 'missing',
      reason: 'The open orders list could not be read',
    });
  });

  it('reads nothing more for an order that has ended, or that is not a trailing stop', () => {
    expect(liveTrailingState(FROZEN, 'filled', [LISTED])).toEqual({ kind: 'not-needed' });
    expect(liveTrailingState({ ...FROZEN, orderType: 'Stop Market' }, 'open', [LISTED])).toEqual({
      kind: 'not-needed',
    });
  });
});

describe('pinToPane', () => {
  // Mesuré le 2026-11-17 : un trailing en attente à 1250 sous une échelle de 1700 à 2200 était
  // dessiné hors du canvas, sans rien qui le dise.
  it('pins a level below the scale to the bottom edge, and says so', () => {
    expect(pinToPane(900, 400, 9)).toEqual({ y: 391, pinned: 'below' });
  });

  it('pins a level above the scale to the top edge, and says so', () => {
    expect(pinToPane(-50, 400, 9)).toEqual({ y: 9, pinned: 'above' });
  });

  it('leaves a level inside the pane where it is', () => {
    expect(pinToPane(200, 400, 9)).toEqual({ y: 200, pinned: null });
  });

  // Dans le pane mais trop près du bord pour une étiquette entière : on la rentre, sans flèche,
  // puisque le niveau lui-même est visible.
  it('keeps a label whole near an edge without calling the level off-scale', () => {
    expect(pinToPane(396, 400, 9)).toEqual({ y: 391, pinned: null });
    expect(pinToPane(3, 400, 9)).toEqual({ y: 9, pinned: null });
  });
});

describe('trailingStart', () => {
  // L'achat de S6 (BTC, 2026-11-17) : l'enregistrement `open` garde l'état de la pose, celui `triggered`
  // le stop appliqué au déclenchement (`live-check.md`).
  const OID = 608143361101;
  const S6_POSE = {
    order: {
      oid: OID,
      orderType: 'Trailing Stop Market',
      triggerCondition: 'Activation immediate, retracement 0.3%, best 64971',
      triggerPx: '65165.9',
    },
    status: 'open',
    statusTimestamp: 1_795_000_027_000,
  };
  const S6_TRIGGERED = {
    order: { ...S6_POSE.order, triggerCondition: 'Triggered', triggerPx: '64983.4' },
    status: 'triggered',
    statusTimestamp: 1_795_001_619_946,
  };

  it('starts at the stop the order was placed with, not the one it triggered at', () => {
    expect(trailingStart(OID, [S6_TRIGGERED, S6_POSE])).toEqual({
      time: 1_795_000_027_000,
      price: '65165.9',
      waiting: false,
    });
  });

  // Posé en attente, le stop de la pose vaut 0.0 : le départ est le prix d'activation.
  it('starts a trailing stop placed waiting at its activation price', () => {
    const pose = { order: { ...S2_WAITING, oid: 7 }, status: 'open', statusTimestamp: 5 };
    expect(trailingStart(7, [pose])).toEqual({ time: 5, price: '2355', waiting: true });
  });

  // Un trailing annulé garde son dernier état, lisible (T2 du 2026-11-16, `live-check.md`) : sans la pose
  // dans l'historique, cet état de la fin ne doit pas passer pour le départ.
  it('never takes a later record for the start', () => {
    const canceled = {
      order: {
        ...S6_POSE.order,
        triggerCondition: 'Activation immediate, retracement 10%, best 1834.6',
        triggerPx: '1651.14',
      },
      status: 'canceled',
      statusTimestamp: 1_795_000_000_000,
    };
    expect(trailingStart(OID, [canceled])).toBeNull();
  });

  it('has no start when the placement is not in the history', () => {
    expect(trailingStart(OID, [S6_TRIGGERED])).toBeNull();
    expect(trailingStart(1, [S6_POSE])).toBeNull();
  });
});
