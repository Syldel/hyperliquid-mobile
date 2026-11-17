import { planTrailingEntry, type TrailingEntryInput } from './trailing-stop-entry.util';

/** Le long ETH des mesures du 2026-11-17 : 0,0065 ETH, quatre décimales de taille. */
const longEth: TrailingEntryInput = {
  coin: 'ETH',
  positionSzi: '0.0065',
  markPx: '1830',
  szDecimals: 4,
  sz: '0.0065',
  retracement: { unit: 'pct', value: '10' },
  activationPx: null,
};
const shortEth: TrailingEntryInput = { ...longEth, positionSzi: '-0.0065' };

const issuesOf = (input: TrailingEntryInput) => {
  const result = planTrailingEntry(input);
  return result.ok ? [] : result.issues;
};

describe('planTrailingEntry', () => {
  describe('what it sends', () => {
    it('closes a long with a reduce-only sell tracking from now', () => {
      const result = planTrailingEntry(longEth);
      expect(result).toMatchObject({
        ok: true,
        plan: {
          body: {
            assetName: 'ETH',
            isBuy: false,
            sz: '0.0065',
            reduceOnly: true,
            retracement: { pct: '10' },
          },
          activation: null,
        },
        warnings: [],
      });
      if (result.ok) {
        expect(result.plan.stopAtStart).toBeCloseTo(1647);
        expect('activationPx' in result.plan.body).toBe(false);
      }
    });

    it('closes a short with a buy, its stop above the mark', () => {
      const result = planTrailingEntry(shortEth);
      expect(result.ok && result.plan.body.isBuy).toBe(true);
      expect(result.ok && result.plan.stopAtStart).toBeCloseTo(2013);
    });

    // S2, mesuré le 2026-11-17 : une vente qui attend 2 355, puis suit à 275 $.
    it('waits for an activation on the right side, and starts its stop from there', () => {
      const result = planTrailingEntry({
        ...longEth,
        retracement: { unit: 'px', value: '275' },
        activationPx: '2355',
      });
      expect(result).toMatchObject({
        ok: true,
        plan: {
          body: { retracement: { px: '275' }, activationPx: '2355' },
          activation: { direction: 'above', px: '2355' },
          stopAtStart: 2080,
        },
      });
    });

    it('sends values in the canonical form the gateway compares', () => {
      const result = planTrailingEntry({
        ...longEth,
        retracement: { unit: 'pct', value: '10.0' },
      });
      expect(result.ok && result.plan.body.retracement).toEqual({ pct: '10' });
    });

    it('treats a blank activation as none', () => {
      const result = planTrailingEntry({ ...longEth, activationPx: '  ' });
      expect(result.ok && result.plan.activation).toBeNull();
    });
  });

  describe('what it refuses, and says why', () => {
    // S4, mesuré le 2026-11-17 : l'exchange a accepté cette vente et suivi tout de suite.
    it('an activation on the wrong side of the mark (measured: the exchange accepts it)', () => {
      expect(issuesOf({ ...longEth, markPx: '1809.9', activationPx: '1719.4' })).toEqual([
        {
          field: 'activation',
          message:
            'A sell activates above the mark (1809.9): at 1719.4 tracking would start at once.',
        },
      ]);
      expect(issuesOf({ ...shortEth, activationPx: '1900' })[0]?.field).toBe('activation');
    });

    it('an activation at the mark, which waits for nothing', () => {
      expect(issuesOf({ ...longEth, activationPx: '1830' })[0]?.field).toBe('activation');
    });

    it('a size off the grid, naming the nearest one below, instead of truncating it', () => {
      expect(issuesOf({ ...longEth, sz: '0.00651' })).toEqual([
        {
          field: 'sz',
          message: 'Size 0.00651 is not on the size grid: the nearest size below is 0.0065.',
        },
      ]);
    });

    it('a size larger than the position', () => {
      expect(issuesOf({ ...longEth, sz: '0.007' })[0]?.message).toContain(
        'larger than the position',
      );
    });

    it('a price distance off the price grid', () => {
      expect(
        issuesOf({ ...longEth, retracement: { unit: 'px', value: '275.123' } })[0]?.message,
      ).toBe('Retracement 275.123 is not on the price grid: the nearest price below is 275.12.');
    });

    // 100 % a été refusé par l'exchange le 2026-11-17 ; 0 l'est par le gateway.
    it('a percentage of zero, of 100 or more, or with more than four decimals', () => {
      for (const value of ['0', '100', '150', '1.23456', 'ten']) {
        expect(issuesOf({ ...longEth, retracement: { unit: 'pct', value } })[0]?.field).toBe(
          'retracement',
        );
      }
    });

    it('a price distance that would put the stop at or below zero', () => {
      expect(
        issuesOf({ ...longEth, retracement: { unit: 'px', value: '2000' } })[0]?.message,
      ).toContain('above zero');
    });

    it('a market the gateway does not place trailing stops on', () => {
      for (const coin of ['xyz:BRENTOIL', '@107']) {
        expect(issuesOf({ ...longEth, coin })[0]?.field).toBe('position');
      }
    });

    it('no position, or a mark it cannot read', () => {
      expect(issuesOf({ ...longEth, positionSzi: '0' })[0]?.message).toContain('No open position');
      expect(issuesOf({ ...longEth, markPx: '' })[0]?.field).toBe('position');
    });

    it('reports every field at once, so the form can mark them together', () => {
      const fields = issuesOf({
        ...longEth,
        sz: '0.00651',
        retracement: { unit: 'pct', value: '0' },
        activationPx: '1000',
      }).map((i) => i.field);
      expect(fields).toEqual(['sz', 'retracement', 'activation']);
    });
  });

  // La position BTC du 2026-11-17 : 0,00016 BTC, 10,41 $ au marqué.
  it('warns when the market order sent at the stop would be under the 10 $ minimum', () => {
    const result = planTrailingEntry({
      coin: 'BTC',
      positionSzi: '0.00016',
      markPx: '65064',
      szDecimals: 5,
      sz: '0.00016',
      retracement: { unit: 'pct', value: '0.3' },
      activationPx: null,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings[0]).toContain('10.38 $');
  });
});
