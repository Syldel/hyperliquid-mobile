import {
  afterTrailingForm,
  readCancelReply,
  stopChange,
  trailingPrefill,
} from './trailing-stop-replace.util';
import { trailingStopView } from './trailing-stop-view.util';

/**
 * Les états d'ordre sont recopiés de `frontendOpenOrders` (`nest-trading-bot/docs/hyperliquid/live-check.md`) :
 * le trailing BRENTOIL posé depuis l'app le 2026-11-19, S2 en attente et le 3,5 % posé depuis l'interface
 * officielle le 2026-11-17. Les réponses d'annulation sont celles de S3 et S7 ; le refus « never placed »
 * vient de la doc, pas d'une mesure.
 */
const BRENT_TRACKING = {
  orderType: 'Trailing Stop Market',
  sz: '0.15',
  triggerCondition: 'Activation immediate, retracement 10%, best 89.644',
  triggerPx: '80.6796',
};

const S2_WAITING = {
  orderType: 'Trailing Stop Market',
  sz: '0.0065',
  triggerCondition: 'Activation above 2355, retracement 275, best waiting',
  triggerPx: '0.0',
};

describe('trailingPrefill', () => {
  it('takes the size and the retracement with its unit, and no activation once tracking', () => {
    expect(trailingPrefill(BRENT_TRACKING)).toEqual({
      sz: '0.15',
      unit: 'pct',
      value: '10',
      activation: '',
    });
  });

  // Une activation déjà franchie, reprise telle quelle, serait du mauvais côté du marqué.
  it('keeps the activation only while it still waits', () => {
    expect(trailingPrefill(S2_WAITING)).toEqual({
      sz: '0.0065',
      unit: 'px',
      value: '275',
      activation: '2355',
    });
    const reached = {
      ...S2_WAITING,
      triggerCondition: 'Activation above 1719.4, retracement 10%, best 1809.9',
    };
    expect(trailingPrefill(reached)?.activation).toBe('');
  });

  // L'exchange relit 3,5 % comme `3.5000000000000004%` : pré-remplir ce texte ferait refuser la saisie.
  it('rounds the percentage the exchange writes back to the signed precision', () => {
    const official = {
      ...BRENT_TRACKING,
      triggerCondition: 'Activation immediate, retracement 3.5000000000000004%, best 1785.44',
    };
    expect(trailingPrefill(official)?.value).toBe('3.5');
  });

  it('prefills nothing from a state it cannot read', () => {
    expect(trailingPrefill({ ...BRENT_TRACKING, triggerCondition: 'Triggered' })).toBeNull();
  });
});

describe('stopChange', () => {
  const old = trailingStopView(BRENT_TRACKING); // stop 80.6796
  const sell = (stopAtStart: number) => ({ isBuy: false, stopAtStart, activation: null });
  const buy = (stopAtStart: number) => ({ isBuy: true, stopAtStart, activation: null });

  // Une vente ferme un long : un stop plus bas est plus loin du prix.
  it('calls a sell starting lower than the old stop looser', () => {
    expect(stopChange(old, sell(80.1))).toMatchObject({
      kind: 'compare',
      from: '80.6796',
      to: '80.1',
      looser: true,
    });
    expect(stopChange(old, sell(81))).toMatchObject({ kind: 'compare', looser: false });
  });

  // Le miroir : sans lui, remplacer le stop d'un short se lirait à l'envers.
  it('calls a buy starting higher than the old stop looser', () => {
    const shortStop = trailingStopView({ ...BRENT_TRACKING, triggerPx: '95' });
    expect(stopChange(shortStop, buy(96))).toMatchObject({ looser: true });
    expect(stopChange(shortStop, buy(94))).toMatchObject({ looser: false });
  });

  it('says the tracking starts over from the current mark', () => {
    expect(stopChange(old, sell(80.1)).text).toContain('starts over from the current mark');
  });

  it('says an old one still waiting protects nothing yet', () => {
    expect(stopChange(trailingStopView(S2_WAITING), sell(80))).toMatchObject({
      kind: 'old-waiting',
    });
  });

  it('does not compare with an old one it cannot read', () => {
    expect(stopChange(null, sell(80)).kind).toBe('old-unknown');
    const unreadable = trailingStopView({ ...BRENT_TRACKING, triggerCondition: 'Triggered' });
    expect(stopChange(unreadable, sell(80)).kind).toBe('old-unknown');
  });
});

describe('readCancelReply', () => {
  it('reads a measured success', () => {
    const reply = { status: 'ok', response: { type: 'cancel', data: { statuses: ['success'] } } };
    expect(readCancelReply(reply)).toEqual({ kind: 'cancelled' });
  });

  it('knows an order that was no longer there', () => {
    const error = 'Order was never placed, already canceled, or filled.';
    const reply = { status: 'ok', response: { type: 'cancel', data: { statuses: [{ error }] } } };
    expect(readCancelReply(reply)).toEqual({ kind: 'gone', message: error });
  });

  // « filled » seul ne suffit pas : un autre refus qui le contient n'est pas un ordre disparu.
  it('keeps any other per-order error as a refusal, with its text', () => {
    const error = 'Order could not be cancelled: partially filled elsewhere';
    const reply = { status: 'ok', response: { type: 'cancel', data: { statuses: [{ error }] } } };
    expect(readCancelReply(reply)).toEqual({ kind: 'refused', message: error });
  });

  it('reads a refusal of the whole action', () => {
    const reply = { status: 'err', response: 'User or API Wallet 0x0 does not exist.' };
    expect(readCancelReply(reply)).toMatchObject({ kind: 'refused' });
  });

  it('reads a reply without a status as unknown', () => {
    expect(readCancelReply({ status: 'ok', response: { type: 'cancel' } })).toEqual({
      kind: 'unknown',
    });
    expect(readCancelReply(null)).toEqual({ kind: 'unknown' });
  });
});

describe('afterTrailingForm', () => {
  const replaced = { kind: 'replaced', newOid: 610375977814, oldOid: 610366939959 } as const;

  // Mesuré le 2026-11-19 : relu juste après une annulation réussie, `orderStatus` disait encore `open`.
  it('goes back to the list after a replacement, instead of re-reading the cancelled order', () => {
    expect(afterTrailingForm('confirm', replaced)).toBe('list');
  });

  it('re-reads after any other write: two trailing stops, an old one gone, an unknown outcome', () => {
    expect(afterTrailingForm('confirm', null)).toBe('reread');
    expect(afterTrailingForm('confirm', undefined)).toBe('reread');
  });

  it('stays when nothing was sent', () => {
    expect(afterTrailingForm('cancel', null)).toBe('stay');
    expect(afterTrailingForm('backdrop', undefined)).toBe('stay');
    expect(afterTrailingForm(undefined, undefined)).toBe('stay');
  });
});
