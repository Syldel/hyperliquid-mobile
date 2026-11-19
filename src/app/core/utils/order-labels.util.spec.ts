import {
  fillSideBadge,
  orderSideBadge,
  positionSideBadge,
  sideBadgeGlyph,
  tifDescription,
  tifLabel,
} from './order-labels.util';

describe('orderSideBadge', () => {
  it('opens LONG / SHORT on a perp, main dex or builder dex', () => {
    expect(orderSideBadge('ETH', true)).toEqual({ text: 'LONG', action: 'open', tone: 'success' });
    expect(orderSideBadge('ETH', false)).toEqual({ text: 'SHORT', action: 'open', tone: 'danger' });
    expect(orderSideBadge('xyz:BRENTOIL', true).text).toBe('LONG');
  });

  // Un trailing stop ETH du 2026-11-17, achat reduce-only sur un short, s'affichait « LONG ».
  it('names what a reduce-only perp order closes, in the colour of that side', () => {
    expect(orderSideBadge('ETH', true, true)).toEqual({
      text: 'SHORT',
      action: 'close',
      tone: 'danger',
    });
    expect(orderSideBadge('ETH', false, true)).toEqual({
      text: 'LONG',
      action: 'close',
      tone: 'success',
    });
  });

  it('says BUY / SELL on a spot market, with no action, reduce-only or not', () => {
    expect(orderSideBadge('@107', true)).toEqual({ text: 'BUY', action: null, tone: 'success' });
    expect(orderSideBadge('@107', false, true)).toEqual({
      text: 'SELL',
      action: null,
      tone: 'danger',
    });
  });
});

describe('positionSideBadge', () => {
  it('says the side alone: a position is open by definition', () => {
    expect(positionSideBadge('xyz:NVDA', false)).toEqual({
      text: 'SHORT',
      action: null,
      tone: 'danger',
    });
  });
});

describe('fillSideBadge', () => {
  // Trade History coupait « OPEN SHORT » à droite à 360 px (téléphone, 2026-11-18).
  it('reads the action of an open or a close from the exchange direction', () => {
    expect(fillSideBadge({ dir: 'Open Short', side: 'A' })).toEqual({
      text: 'SHORT',
      action: 'open',
      tone: 'danger',
    });
    expect(fillSideBadge({ dir: 'Close Short', side: 'B' })).toEqual({
      text: 'SHORT',
      action: 'close',
      tone: 'danger',
    });
  });

  it('writes any other direction as it came, in capitals, with no action guessed', () => {
    expect(fillSideBadge({ dir: 'Long > Short', side: 'A' })).toEqual({
      text: 'LONG > SHORT',
      action: null,
      tone: 'danger',
    });
    expect(fillSideBadge({ dir: 'Buy', side: 'B' }).action).toBeNull();
  });

  it('falls back on the side rather than an empty badge', () => {
    expect(fillSideBadge({ dir: '', side: 'B' }).text).toBe('BUY');
    expect(fillSideBadge({ dir: null, side: 'A' }).text).toBe('SELL');
  });
});

// ▲ achat, ▼ vente : la convention des marqueurs de TradingView et des exécutions du chart. Un ▲ sur
// un short ferait lire une vente comme un achat — d'où un test par sens, et par source. Éprouvé sur le
// code cassé (LONG → 'sell') : les tests du ▲, ordre et remplissage, tombent.
describe('sideBadgeGlyph', () => {
  it('draws ▲ for an order that opens a long: a buy', () => {
    expect(sideBadgeGlyph(orderSideBadge('ETH', true))).toBe('buy');
  });

  it('draws ▼ for an order that opens a short: a sell', () => {
    expect(sideBadgeGlyph(orderSideBadge('ETH', false))).toBe('sell');
  });

  it('reads the same directions from a fill', () => {
    expect(sideBadgeGlyph(fillSideBadge({ dir: 'Open Long', side: 'B' }))).toBe('buy');
    expect(sideBadgeGlyph(fillSideBadge({ dir: 'Open Short', side: 'A' }))).toBe('sell');
  });

  // Fermer un short est un achat, mais le badge parle de la position : un carré, sans direction.
  it('draws ■ with no direction for any close, whatever the side of the trade', () => {
    expect(sideBadgeGlyph(orderSideBadge('ETH', true, true))).toBe('close');
    expect(sideBadgeGlyph(orderSideBadge('ETH', false, true))).toBe('close');
    expect(sideBadgeGlyph(fillSideBadge({ dir: 'Close Short', side: 'B' }))).toBe('close');
  });

  it('draws nothing for a badge that says no action: spot, position, unclassified fill', () => {
    expect(sideBadgeGlyph(orderSideBadge('PURR/USDC', true))).toBeNull();
    expect(sideBadgeGlyph(positionSideBadge('ETH', true))).toBeNull();
    expect(sideBadgeGlyph(fillSideBadge({ dir: 'Long > Short', side: 'A' }))).toBeNull();
  });

  // Une ouverture qui ne dit ni LONG ni SHORT : aucune direction ne se devine.
  it('draws nothing for an opening badge whose side it cannot name', () => {
    expect(sideBadgeGlyph({ text: 'BUY', action: 'open', tone: 'success' })).toBeNull();
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
