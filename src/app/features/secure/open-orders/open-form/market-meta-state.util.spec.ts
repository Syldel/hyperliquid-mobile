import { MarketMetaError } from '@utils/market-meta.util';
import {
  blocksOnMarketMeta,
  marketMetaDetailOf,
  marketMetaNotice,
  marketMetaStateOf,
  type MarketMetaState,
} from './market-meta-state.util';

describe('marketMetaStateOf', () => {
  // Un marché illisible ne se répare pas en réessayant ; une méta qui n'a pas chargé, si.
  it.each(['invalid-name', 'not-found', 'ambiguous', 'unreadable'] as const)(
    'reads a %s failure as a market that is missing: retrying would not help',
    (code) => {
      expect(marketMetaStateOf(new MarketMetaError(code, 'why'))).toBe('missing');
    },
  );

  // Un outcome est connu et refusé : réessayer ne le rendra pas négociable, et ce n'est pas « illisible ».
  it('reads an unsupported market as unsupported, apart from one that is missing', () => {
    expect(marketMetaStateOf(new MarketMetaError('unsupported', 'why'))).toBe('unsupported');
  });

  it.each([
    ['a transport error', new Error('network down')],
    ['an HTTP failure', { status: 500, statusText: 'Server Error' }],
    ['nothing at all', undefined],
  ])('reads %s as a meta that is unavailable: retrying may help', (_, error) => {
    expect(marketMetaStateOf(error)).toBe('unavailable');
  });
});

describe('marketMetaDetailOf', () => {
  it('gives the reason a market read gave, and nothing for a transport failure', () => {
    expect(marketMetaDetailOf(new MarketMetaError('not-found', 'no perp market named "X"'))).toBe(
      'no perp market named "X"',
    );
    expect(marketMetaDetailOf(new Error('network down'))).toBeNull();
  });
});

describe('blocksOnMarketMeta', () => {
  // `none` ne bloque pas ici : sans actif choisi, c'est « aucun actif choisi » qui empêche l'envoi.
  it.each([
    ['none', false],
    ['loading', true],
    ['ok', false],
    ['missing', true],
    ['unsupported', true],
    ['unavailable', true],
  ] as [MarketMetaState, boolean][])('state %s blocks placement: %s', (state, blocks) => {
    expect(blocksOnMarketMeta(state)).toBe(blocks);
  });
});

describe('marketMetaNotice', () => {
  it('names the market and the reason for a market it cannot read', () => {
    expect(
      marketMetaNotice('missing', 'ETHX', 'no perp market named "ETHX" in the meta of its dex'),
    ).toBe(
      'The size and price grid of "ETHX" could not be read (no perp market named "ETHX" in the meta of its dex), so placing an order is disabled.',
    );
  });

  it('still says the market when the reason is absent', () => {
    expect(marketMetaNotice('missing', 'ETHX', null)).toBe(
      'The size and price grid of "ETHX" could not be read, so placing an order is disabled.',
    );
  });

  // Le détail dit déjà quel marché c'est : le bandeau ne dit pas « could not be read », qui serait faux.
  it('says an unsupported market is not traded, rather than that its grid could not be read', () => {
    const notice = marketMetaNotice(
      'unsupported',
      '#10',
      '"#10" is an outcome market (HIP-4), which this app does not trade',
    );

    expect(notice).toBe(
      '"#10" is an outcome market (HIP-4), which this app does not trade, so placing an order is disabled.',
    );
    expect(notice).not.toContain('could not be read');
  });

  it('still names the market when an unsupported failure carries no detail', () => {
    expect(marketMetaNotice('unsupported', '#10', null)).toContain('"#10"');
  });

  it('says the meta could not be loaded, and that placing is disabled until it does', () => {
    expect(marketMetaNotice('unavailable', 'ETH', null)).toContain('could not be loaded');
    expect(marketMetaNotice('unavailable', 'ETH', null)).toContain('disabled until it loads');
  });

  // Un bandeau rouge qui clignote pour un état de quelques instants serait pire que le bouton qui attend.
  it.each(['none', 'loading', 'ok'] as MarketMetaState[])('says nothing in state %s', (state) => {
    expect(marketMetaNotice(state, 'ETH', null)).toBeNull();
  });

  it('gives a reason for every state that blocks, except the one that lasts a few instants', () => {
    const states: MarketMetaState[] = [
      'none',
      'loading',
      'ok',
      'missing',
      'unsupported',
      'unavailable',
    ];

    for (const state of states) {
      if (blocksOnMarketMeta(state) && state !== 'loading') {
        expect(marketMetaNotice(state, 'ETH', 'why')).not.toBeNull();
      }
    }
  });
});
