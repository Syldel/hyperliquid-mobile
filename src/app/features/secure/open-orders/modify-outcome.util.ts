import { modifyRefusal } from '@utils/hl-error.utils';

/**
 * Ce qu'est devenu un ordre modifié, lu dans la réponse d'un `batchModify` à **une** entrée.
 *
 * Une modification **remplace** l'ordre : l'ancien oid passe `canceled`, un nouvel oid naît à la même
 * milliseconde (mesuré, `nest-trading-bot/docs/hyperliquid/live-check.md`). Un `modify` seul répond
 * `{"type":"default"}`, sans ce nouvel oid : la page de détail relisait donc l'ancien et affichait
 * « canceled » après une modification réussie. Un `batchModify` le rend, par entrée :
 * `{"resting":{"oid":599951351972}}` (W4, 2026-11-09, par la route `/hyperliquid/order/batch-modify`).
 *
 * - `refused` : rien n'a été modifié — et l'original a pu être **annulé** (mesuré, W2 et W6) ;
 * - `resting` : le nouvel ordre est au carnet, sous `oid` ;
 * - `filled` : il s'est exécuté aussitôt. ⚠️ **Jamais mesuré** pour une modification : la forme est celle
 *   d'un `order` (`HLPlaceOrderStatus.filled`), supposée identique ;
 * - `unknown` : accepté, mais la réponse ne dit pas où est l'ordre. On ne devine pas un oid.
 */
export type ModifyOutcome =
  | { kind: 'refused'; message: string }
  | { kind: 'resting'; oid: number }
  | { kind: 'filled'; oid: number | null }
  | { kind: 'unknown' };

export function readModifyOutcome(reply: unknown): ModifyOutcome {
  const refusal = modifyRefusal(reply);
  if (refusal !== null) return { kind: 'refused', message: refusal };

  const envelope = reply as {
    status?: unknown;
    response?: { data?: { statuses?: unknown } };
  } | null;
  if (envelope?.status !== 'ok') {
    return { kind: 'refused', message: 'Failed to update order: unexpected reply.' };
  }

  const statuses = envelope.response?.data?.statuses;
  const first = Array.isArray(statuses) ? (statuses[0] as Record<string, unknown> | null) : null;
  const resting = first?.['resting'] as { oid?: unknown } | undefined;
  if (typeof resting?.oid === 'number') return { kind: 'resting', oid: resting.oid };

  const filled = first?.['filled'] as { oid?: unknown } | undefined;
  if (filled !== undefined && filled !== null) {
    return { kind: 'filled', oid: typeof filled.oid === 'number' ? filled.oid : null };
  }

  return { kind: 'unknown' };
}

/**
 * Ce que montre la page de détail après une modification acceptée, et ce qu'elle en dit.
 *
 * La règle : après une écriture, l'écran montre l'ordre qui **en résulte**, jamais celui qui n'existe
 * plus. `show` est l'oid à afficher ; `null` renvoie à la liste des ordres ouverts — quand la réponse
 * ne dit pas où est passé l'ordre, on ne le cherche pas en comparant prix et taille : deux ordres
 * identiques rendraient le choix arbitraire.
 */
export function afterModify(outcome: Exclude<ModifyOutcome, { kind: 'refused' }>): {
  show: number | null;
  message: string;
} {
  switch (outcome.kind) {
    case 'resting':
      return {
        show: outcome.oid,
        message: `Order updated · OID ${outcome.oid}`,
      };
    case 'filled':
      return outcome.oid === null
        ? {
            show: null,
            message: 'Order updated and filled · no new OID given',
          }
        : { show: outcome.oid, message: 'Order updated and filled at once' };
    case 'unknown':
      return {
        show: null,
        message: 'Order updated · no new OID given',
      };
  }
}
