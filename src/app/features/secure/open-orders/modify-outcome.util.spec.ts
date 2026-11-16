import { afterModify, readModifyOutcome } from './modify-outcome.util';

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

describe('afterModify', () => {
  // Le défaut d'origine : la page relisait l'ancien oid et affichait « canceled » après un succès.
  it('shows the order that replaced the modified one', () => {
    const after = afterModify({ kind: 'resting', oid: 599951351972 });

    expect(after.show).toBe(599951351972);
    expect(after.message).toContain('599951351972');
  });

  it('shows an order that filled at once, when its oid is known', () => {
    expect(afterModify({ kind: 'filled', oid: 77 }).show).toBe(77);
  });

  // Sans oid, aucune recherche par ressemblance : la liste, et le dire.
  it('sends to the open orders when the reply does not say where the order went', () => {
    const unknown = afterModify({ kind: 'unknown' });
    const filled = afterModify({ kind: 'filled', oid: null });

    expect(unknown.show).toBeNull();
    expect(unknown.message).toContain('did not give its new id');
    expect(filled.show).toBeNull();
    expect(filled.message).toContain('filled at once');
  });
});
