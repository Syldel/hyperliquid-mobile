import {
  fillSideBadge,
  orderSideBadge,
  positionSideBadge,
  tifDescription,
  tifLabel,
} from './order-labels.util';

describe('orderSideBadge', () => {
  it('says LONG for a buy and SHORT for a sell on a perp, main dex or builder dex', () => {
    expect(orderSideBadge('ETH', true)).toEqual({ text: 'LONG', tone: 'success' });
    expect(orderSideBadge('ETH', false)).toEqual({ text: 'SHORT', tone: 'danger' });
    expect(orderSideBadge('xyz:BRENTOIL', true).text).toBe('LONG');
  });

  // Décidé le 2026-11-20 : le côté de l'API, reduce-only compris. Un stop qui ferme un long est une
  // vente, donc SHORT ; « Reduce only » dit qu'il ferme. La fonction ne prend plus l'argument.

  it('says BUY / SELL on a spot market', () => {
    expect(orderSideBadge('@107', true)).toEqual({ text: 'BUY', tone: 'success' });
    expect(orderSideBadge('PURR/USDC', false)).toEqual({ text: 'SELL', tone: 'danger' });
  });
});

describe('positionSideBadge', () => {
  it('says the side of the position', () => {
    expect(positionSideBadge('xyz:NVDA', false)).toEqual({ text: 'SHORT', tone: 'danger' });
    expect(positionSideBadge('ETH', true)).toEqual({ text: 'LONG', tone: 'success' });
  });
});

describe('fillSideBadge', () => {
  // `Close Short` est un achat : LONG, comme l'ordre qui l'a produit (décidé le 2026-11-20).
  it('says the side of the execution for an open or a close, never CLOSE', () => {
    expect(fillSideBadge({ dir: 'Open Short', side: 'A' })).toEqual({
      text: 'SHORT',
      tone: 'danger',
    });
    expect(fillSideBadge({ dir: 'Close Short', side: 'B' })).toEqual({
      text: 'LONG',
      tone: 'success',
    });
    expect(fillSideBadge({ dir: 'Close Long', side: 'A' })).toEqual({
      text: 'SHORT',
      tone: 'danger',
    });
  });

  it('writes any other direction as it came, in capitals, coloured by its side', () => {
    expect(fillSideBadge({ dir: 'Long > Short', side: 'A' })).toEqual({
      text: 'LONG > SHORT',
      tone: 'danger',
    });
    expect(fillSideBadge({ dir: 'Buy', side: 'B' })).toEqual({ text: 'BUY', tone: 'success' });
  });

  it('falls back on the side rather than an empty badge', () => {
    expect(fillSideBadge({ dir: '', side: 'B' }).text).toBe('BUY');
    expect(fillSideBadge({ dir: null, side: 'A' }).text).toBe('SELL');
  });
});

describe('tifLabel and tifDescription', () => {
  it('writes the three sendable TIFs in capitals, as the initials they are', () => {
    expect(tifLabel('Alo')).toBe('ALO');
    expect(tifLabel('Gtc')).toBe('GTC');
    expect(tifLabel('Ioc')).toBe('IOC');
  });

  it('adds the meaning for the detail and the form', () => {
    expect(tifDescription('Alo')).toBe('ALO – Post only');
    expect(tifDescription('Gtc')).toBe('GTC – Good till cancelled');
    expect(tifDescription('Ioc')).toBe('IOC – Immediate or cancel');
  });

  // Un TIF hors des trois : écrit comme l'API l'écrit, casse comprise, et sans sens inventé. Un
  // trader averti doit pouvoir le rapprocher de la réponse brute.
  it('shows any other TIF exactly as the API writes it', () => {
    expect(tifLabel('FrontendMarket')).toBe('FrontendMarket');
    expect(tifDescription('FrontendMarket')).toBe('FrontendMarket');
  });
});
