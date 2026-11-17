import { fillDirectionLabel, sideBadgeLabel, tifDescription, tifLabel } from './order-labels.util';

describe('sideBadgeLabel', () => {
  it('says LONG / SHORT on a perp, main dex or builder dex', () => {
    expect(sideBadgeLabel('ETH', true)).toBe('LONG');
    expect(sideBadgeLabel('ETH', false)).toBe('SHORT');
    expect(sideBadgeLabel('xyz:BRENTOIL', true)).toBe('LONG');
  });

  // Un trailing stop ETH du 2026-11-17, achat reduce-only sur un short, s'affichait « LONG ».
  it('names what a reduce-only perp order closes, not the side it buys or sells', () => {
    expect(sideBadgeLabel('ETH', true, true)).toBe('CLOSE SHORT');
    expect(sideBadgeLabel('ETH', false, true)).toBe('CLOSE LONG');
  });

  it('says BUY / SELL on a spot market, reduce-only or not', () => {
    expect(sideBadgeLabel('@107', true)).toBe('BUY');
    expect(sideBadgeLabel('@107', false, true)).toBe('SELL');
  });
});

describe('fillDirectionLabel', () => {
  it('writes the direction the exchange gives, in capitals', () => {
    expect(fillDirectionLabel({ dir: 'Close Short', side: 'B' })).toBe('CLOSE SHORT');
    expect(fillDirectionLabel({ dir: 'Long > Short', side: 'A' })).toBe('LONG > SHORT');
  });

  it('falls back on the side rather than an empty badge', () => {
    expect(fillDirectionLabel({ dir: '', side: 'B' })).toBe('BUY');
    expect(fillDirectionLabel({ dir: null, side: 'A' })).toBe('SELL');
  });
});

describe('tifLabel and tifDescription', () => {
  it('writes the code in capitals for the lists', () => {
    expect(tifLabel('Alo')).toBe('ALO');
    expect(tifLabel('Gtc')).toBe('GTC');
  });

  it('adds the meaning for the detail and the form', () => {
    expect(tifDescription('Alo')).toBe('ALO – Post only');
    expect(tifDescription('Gtc')).toBe('GTC – Good till cancelled');
    expect(tifDescription('Ioc')).toBe('IOC – Immediate or cancel');
  });

  // Un TIF que cette table ne connaît pas : son code, sans sens inventé.
  it('shows an unknown TIF by its code alone', () => {
    expect(tifDescription('FrontendMarket')).toBe('FRONTENDMARKET');
  });
});
