import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import { editRefusal } from './editable-order.util';

/**
 * Un trailing stop natif, recopié de `frontendOpenOrders` le 2026-11-16 (ETH, posé depuis la ligne de
 * position de l'interface Hyperliquid ; `nest-trading-bot/docs/hyperliquid/live-check.md`). Seul
 * `orderType` est lu ici, mais l'ordre entier dit ce que l'écran recevra.
 */
const MEASURED_TRAILING = {
  coin: 'ETH',
  side: 'A',
  limitPx: '1481.0',
  sz: '0.0065',
  oid: 607485054558,
  timestamp: 1794866197053,
  triggerCondition: 'Activation immediate, retracement 10%, best 1828.3',
  isTrigger: true,
  triggerPx: '1645.47',
  isPositionTpsl: false,
  reduceOnly: true,
  orderType: 'Trailing Stop Market',
  origSz: '0.0065',
  tif: null,
  cloid: null,
} as HLFrontendOpenOrder;

describe('editRefusal', () => {
  it.each(['Limit', 'Stop Market', 'Stop Limit', 'Take Profit Market', 'Take Profit Limit'])(
    'lets a %s order be edited',
    (orderType) => {
      expect(editRefusal({ orderType })).toBeNull();
    },
  );

  it('refuses a native trailing stop, and says what to do instead and what it costs', () => {
    // « Stop » et « Market » dans le nom : l'écran le prenait pour un Stop Market.
    const refusal = editRefusal(MEASURED_TRAILING);

    expect(refusal).toContain('A trailing stop cannot be edited here');
    expect(refusal).toContain('Cancel it and place a new one');
    expect(refusal).toContain('tracking starts over from the current mark price');
  });

  it('refuses a type it has never read, and names it', () => {
    expect(editRefusal({ orderType: 'Twap Slice' })).toBe(
      'A "Twap Slice" order cannot be edited here. Cancel it and place a new one if needed.',
    );
  });

  it('compares the type exactly, as the exchange writes it', () => {
    expect(editRefusal({ orderType: 'stop market' })).not.toBeNull();
  });
});
