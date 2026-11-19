import {
  botStopNotice,
  formatStop,
  planTrailingEntry,
  readTrailingMarket,
  trailingSendFailure,
  type TrailingEntryInput,
} from './trailing-stop-entry.util';

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

    // S7, mesuré le 2026-11-19 : la pose sur un dex HIP-3 passe, sous le nom préfixé de la paire.
    it('places on a HIP-3 perp as on the main dex', () => {
      const result = planTrailingEntry({
        ...longEth,
        coin: 'xyz:BRENTOIL',
        positionSzi: '0.15',
        markPx: '90.588',
        szDecimals: 2,
        sz: '0.15',
      });
      expect(result).toMatchObject({
        ok: true,
        plan: { body: { assetName: 'xyz:BRENTOIL', isBuy: false, sz: '0.15', reduceOnly: true } },
      });
      if (result.ok) expect(result.plan.stopAtStart).toBeCloseTo(81.5292);
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

    it('a market that has no trailing stop: spot or outcome', () => {
      for (const coin of ['@107', 'PURR/USDC', '#10']) {
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

describe('botStopNotice', () => {
  // Fermer un long : une vente, dont le stop le plus HAUT part le premier.
  const sellAt = (stopAtStart: number) => ({ isBuy: false, stopAtStart });
  // Fermer un short : un achat, dont le stop le plus BAS part le premier.
  const buyAt = (stopAtStart: number) => ({ isBuy: true, stopAtStart });

  it("says nothing off the bot's pairs", () => {
    expect(botStopNotice(sellAt(81.5), null)).toBeNull();
  });

  it("flags a sell starting above the bot's stop: it would exit first", () => {
    expect(botStopNotice(sellAt(81.5), { stopPx: '80' })).toMatchObject({ tighter: true });
  });

  it("keeps a sell starting below the bot's stop as behind it", () => {
    expect(botStopNotice(sellAt(79), { stopPx: '80' })).toMatchObject({ tighter: false });
  });

  // Le miroir : sans lui, un short serait jugé à l'envers.
  it("flags a buy starting below the bot's stop, and not one above it", () => {
    expect(botStopNotice(buyAt(95), { stopPx: '96' })).toMatchObject({ tighter: true });
    expect(botStopNotice(buyAt(97), { stopPx: '96' })).toMatchObject({ tighter: false });
  });

  it('says when the bot has no stop on its own pair', () => {
    const notice = botStopNotice(sellAt(81.5), { stopPx: null });
    expect(notice).toMatchObject({ tighter: false });
    expect(notice?.text).toContain('no stop');
  });
});

describe('formatStop', () => {
  it('writes six significant digits, without float noise', () => {
    expect(formatStop(90.588 * 0.9)).toBe('81.5292');
    expect(formatStop(64971 * 1.003)).toBe('65165.9');
  });
});

describe('readTrailingMarket', () => {
  const metaAndCtx = [
    {
      universe: [
        { name: 'xyz:NVDA', szDecimals: 3 },
        { name: 'xyz:BRENTOIL', szDecimals: 2 },
      ],
    },
    [{ markPx: '156.77' }, { markPx: '90.588' }],
  ];

  it('reads the grid and the mark of the pair, by its index', () => {
    expect(readTrailingMarket('xyz:BRENTOIL', metaAndCtx)).toEqual({
      ok: true,
      szDecimals: 2,
      markPx: '90.588',
    });
  });

  // Par égalité exacte : une sous-chaîne a déjà fait lire à 38 perps la grille d'un autre.
  it('does not take a market whose name only contains the pair', () => {
    expect(readTrailingMarket('BRENTOIL', metaAndCtx)).toMatchObject({ ok: false });
  });

  it('refuses a missing or unreadable mark', () => {
    const noMark = [metaAndCtx[0], [{ markPx: '156.77' }, { markPx: '' }]];
    expect(readTrailingMarket('xyz:BRENTOIL', noMark)).toMatchObject({ ok: false });
    expect(readTrailingMarket('xyz:BRENTOIL', null)).toMatchObject({ ok: false });
  });
});

describe('trailingSendFailure', () => {
  it('knows nothing was placed when the gateway refused before signing', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(trailingSendFailure(status, { message: 'Validation failed' })).toBe('nothing-placed');
    }
  });

  it('knows nothing was placed when the exchange refused the action', () => {
    expect(
      trailingSendFailure(502, { error: 'EXCHANGE_TRAILING_STOP_REFUSED', message: 'refused' }),
    ).toBe('nothing-placed');
  });

  // Sans cloid, renvoyer après une issue inconnue poserait un second trailing.
  it('treats every other failure as an outcome to read, never to resend', () => {
    expect(trailingSendFailure(502, { error: 'EXCHANGE_OUTCOME_UNKNOWN' })).toBe('unknown');
    expect(trailingSendFailure(502, { error: 'EXCHANGE_UNEXPECTED_RESPONSE' })).toBe('unknown');
    expect(trailingSendFailure(502, { error: 'SOMETHING_NEW' })).toBe('unknown');
    expect(trailingSendFailure(0, null)).toBe('unknown');
    expect(trailingSendFailure(500, 'Internal')).toBe('unknown');
    expect(trailingSendFailure(504, null)).toBe('unknown');
  });
});
