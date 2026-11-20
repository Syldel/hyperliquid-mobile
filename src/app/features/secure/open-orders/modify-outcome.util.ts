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
 * Ce que la page de détail dit d'une modification acceptée, avant de **revenir à la liste**.
 *
 * Depuis le 2026-11-20, la page ne passe plus au nouvel oid : elle le relisait par `orderStatus`, qui ne le
 * connaît pas toujours juste après l'écriture — l'utilisateur voyait un statut vide, sous les champs de
 * l'ancien ordre, jusqu'à plusieurs rafraîchissements. Même retard qu'après une annulation (S8,
 * `nest-trading-bot/docs/hyperliquid/live-check.md`). La liste lit `frontendOpenOrders`, qui suit
 * l'écriture (point 18 de `docs/roadmap.md`) : on y revient, comme après une annulation ou le
 * remplacement d'un trailing. Le message donne le nouvel oid quand la réponse le dit ; sans lui, on ne
 * le cherche pas en comparant prix et taille, deux ordres identiques rendraient le choix arbitraire.
 */
export function modifyMessage(outcome: Exclude<ModifyOutcome, { kind: 'refused' }>): string {
  switch (outcome.kind) {
    case 'resting':
      return `Order updated · new OID ${outcome.oid}`;
    case 'filled':
      return outcome.oid === null
        ? 'Order updated and filled · no new OID given'
        : `Order updated and filled at once · OID ${outcome.oid}`;
    case 'unknown':
      return 'Order updated · no new OID given';
  }
}

/**
 * Ce que la page de détail dit quand `orderStatus` ne rend pas d'ordre (`unknownOid`, ou une réponse sans
 * `order`), ou `null` s'il y en a un. Avant, la page ignorait la réponse en silence : statut vide, et les
 * champs de l'ordre précédent restaient affichés (2026-11-20). Un oid inconnu peut être un ordre tout juste
 * posé ou modifié, que `orderStatus` n'a pas encore : on le dit, sans relire de soi-même.
 */
export function unknownOrderText(
  response: { status?: string; order?: unknown } | null | undefined,
  oid: number,
): string | null {
  if (response?.status === 'order' && response.order) return null;
  const said = response?.status ? ` (it answered "${response.status}")` : '';
  return `The exchange does not know OID ${oid} yet${said}. If it was just placed or modified, refresh in a moment; otherwise check Open Orders.`;
}
