import { modifyMessage, unknownOrderText, readModifyOutcome } from './modify-outcome.util';

/**
 * Les réponses sont celles **mesurées** sur le mainnet, par les routes du gateway que l'app appelle
 * (`nest-trading-bot/docs/hyperliquid/live-check.md`, 2026-10-27, 2026-11-09 et 2026-11-12), réduites à
 * une entrée. Seule `filled` n'a jamais été vue pour une modification : elle est marquée comme telle.
 */
describe('readModifyOutcome', () => {
  // W4, l'entrée valide : l'ancien oid `canceled`, le nouveau né à la même milliseconde.
  it('gives the new oid of an order that went back on the book', () => {
    const reply = {
      status: 'ok',
      response: { type: 'order', data: { statuses: [{ resting: { oid: 599951351972 } }] } },
    };

    expect(readModifyOutcome(reply)).toEqual({ kind: 'resting', oid: 599951351972 });
  });

  // W6 : dans un lot, le refus est rangé dans l'entrée — et l'original a été annulé.
  it('reads a refusal stored in the entry', () => {
    const reply = {
      status: 'ok',
      response: {
        type: 'order',
        data: {
          statuses: [
            {
              error:
                'Error placing new order during modify: Post only order would have immediately matched, bbo was 74940@74941.',
            },
          ],
        },
      },
    };

    const outcome = readModifyOutcome(reply);

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.message).toContain('Post only order');
  });

  // W2 : la forme d'un `modify` seul refusé, possible aussi pour un lot (un agent inconnu, par exemple).
  it('reads a refusal of the whole action', () => {
    const reply = {
      status: 'err',
      response: 'Error placing new order during modify: Order must have minimum value of $10.',
    };

    const outcome = readModifyOutcome(reply);

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.message).toContain('minimum value');
  });

  // ⚠️ Jamais mesuré pour une modification : la forme d'un `order` exécuté aussitôt, supposée identique.
  it('says the order filled at once', () => {
    const reply = {
      status: 'ok',
      response: {
        type: 'order',
        data: { statuses: [{ filled: { oid: 77, totalSz: '0.001', avgPx: '74000' } }] },
      },
    };

    expect(readModifyOutcome(reply)).toEqual({ kind: 'filled', oid: 77 });
  });

  // L'accusé d'un `modify` seul (live-check.md, phase 1 du stop de position, « Pas 3 ») : accepté, sans
  // dire où est l'ordre. Pas d'oid deviné.
  it('does not guess an oid when an accepted reply gives none', () => {
    expect(readModifyOutcome({ status: 'ok', response: { type: 'default' } })).toEqual({
      kind: 'unknown',
    });
  });

  it('does not take an oid that is not a number', () => {
    const reply = {
      status: 'ok',
      response: { type: 'order', data: { statuses: [{ resting: { oid: '599951351972' } }] } },
    };

    expect(readModifyOutcome(reply)).toEqual({ kind: 'unknown' });
  });

  it('refuses to call an unreadable reply a success', () => {
    expect(readModifyOutcome(null).kind).toBe('refused');
    expect(readModifyOutcome({ response: {} }).kind).toBe('refused');
  });
});

describe('modifyMessage', () => {
  it('names the order that replaced the modified one', () => {
    expect(modifyMessage({ kind: 'resting', oid: 599951351972 })).toBe(
      'Order updated · new OID 599951351972',
    );
    expect(modifyMessage({ kind: 'filled', oid: 77 })).toContain('OID 77');
  });

  // Sans oid, aucune recherche par ressemblance : le dire.
  it('says when the reply does not give the new order', () => {
    expect(modifyMessage({ kind: 'unknown' })).toContain('no new OID given');
    expect(modifyMessage({ kind: 'filled', oid: null })).toContain('filled · no new OID given');
  });
});

describe('unknownOrderText', () => {
  it('says nothing when the exchange returns the order', () => {
    expect(unknownOrderText({ status: 'order', order: { status: 'open' } }, 1)).toBeNull();
  });

  // Le défaut du 2026-11-20 : une réponse sans ordre était ignorée, et la page restait muette.
  it('says the exchange does not know the oid, with what it answered', () => {
    const text = unknownOrderText({ status: 'unknownOid' }, 610736354584);
    expect(text).toContain('does not know OID 610736354584 yet');
    expect(text).toContain('"unknownOid"');
  });

  it('says it too for an empty or malformed reply, never nothing', () => {
    expect(unknownOrderText(null, 5)).toContain('does not know OID 5');
    expect(unknownOrderText({ status: 'order' }, 5)).toContain('"order"');
  });
});
