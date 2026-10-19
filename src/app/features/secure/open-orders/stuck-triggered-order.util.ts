import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';

/**
 * Un stop (ou un take-profit) DÉCLENCHÉ dont l'ordre est resté au carnet.
 *
 * Quand un déclencheur est franchi, Hyperliquid pose un ordre limite reduce-only. Si le prix a déjà
 * dépassé son limite, il est exécuté tout de suite ; sinon il **reste au carnet**, et la position
 * reste ouverte, sans protection effective. Mesuré le 2026-10-18 sur deux Stop Limit ETH au limite
 * égal au déclencheur : 826 s, puis 163,5 s (voir `docs/roadmap.md`, « À éprouver en réel »).
 *
 * Rien dans la liste ne le disait : le badge « Trigger » ne s'affiche que si `isTrigger` est vrai,
 * et il vaut **faux** pour cet ordre. Il apparaissait donc comme un ordre limite de vente ordinaire,
 * `Stop Limit` `Gtc` `Reduce`. Sa forme, lue dans `frontendOpenOrders` 70 secondes après le
 * déclenchement :
 *
 *   orderType         "Stop Limit"   — le nom ne change pas
 *   isTrigger         false
 *   triggerPx         "0.0"
 *   triggerCondition  "Triggered"
 *   tif               "Gtc"
 *   reduceOnly        true
 *
 * Le même prédicat que celui du bot (`nest-trading-bot/src/hyperliquid/domain/pair-orders.ts`),
 * écrit à nouveau ici : les deux dépôts ne partagent pas de code. Strict à dessein : un `isTrigger`
 * absent n'est pas lu comme `false`.
 */
export function isStuckTriggeredOrder(
  order: Partial<Pick<HLFrontendOpenOrder, 'isTrigger' | 'triggerCondition' | 'reduceOnly'>>,
): boolean {
  return (
    order.reduceOnly === true && order.isTrigger === false && order.triggerCondition === 'Triggered'
  );
}

/** Ce qu'un ordre resté a déjà exécuté : `filled` sur `orig`, et `left` encore au carnet. */
export interface StuckTriggeredFill {
  orig: string;
  filled: string;
  left: string;
}

const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

/** `a − b` sur deux décimaux positifs écrits en chaîne, exact (aucun flottant). `null` si l'un est illisible. */
function subtractExact(a: string, b: string): string | null {
  if (!PLAIN_DECIMAL.test(a) || !PLAIN_DECIMAL.test(b)) return null;

  const decimals = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const units = (value: string): bigint => {
    const [integer, fraction = ''] = value.split('.');
    return BigInt(integer + fraction.padEnd(decimals, '0'));
  };

  const diff = units(a) - units(b);
  if (diff < 0n) return null;

  const digits = diff.toString().padStart(decimals + 1, '0');
  const integer = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');

  return fraction ? `${integer}.${fraction}` : integer;
}

/**
 * Ce qu'un ordre resté a déjà exécuté, ou `null` s'il est entier — ou si ses tailles ne se lisent
 * pas, ou se contredisent (`sz` plus grand que `origSz`) : on ne devine pas une exécution.
 *
 * `sz` est la part **restante** et `origSz` la taille posée (le détail les affiche ainsi). Un ordre
 * limite peut être exécuté en partie dans bien des situations : « still resting unfilled » serait
 * alors faux. ⚠️ La forme d'un ordre resté *partiellement* exécuté n'est pas mesurée : tous ceux
 * relevés (2026-10-18) étaient entiers. `sz` et `origSz` sont lus du type.
 */
export function stuckTriggeredFill(
  order: Pick<HLFrontendOpenOrder, 'sz' | 'origSz'>,
): StuckTriggeredFill | null {
  const filled = subtractExact(order.origSz, order.sz);
  if (filled === null || /^0(?:\.0+)?$/.test(filled)) return null;

  return { orig: order.origSz, filled, left: order.sz };
}

/**
 * La phrase qui dit qu'un ordre déclenché est resté au carnet. Entier : « still resting
 * unfilled ». Exécuté en partie : ce qui est parti et ce qui reste.
 *
 * `withLimit` : le détail ajoute le prix auquel l'ordre repose, et qu'il ne se remplit que si le prix
 * y revient — la liste, plus étroite, s'en tient à l'essentiel.
 */
export function describeStuckTriggered(
  order: Pick<HLFrontendOpenOrder, 'sz' | 'origSz' | 'limitPx'>,
  withLimit = false,
): string {
  const fill = stuckTriggeredFill(order);
  const at = withLimit ? ` at ${order.limitPx}` : '';
  const comeBack = withLimit
    ? ` ${fill ? 'The rest' : 'It'} fills only if the price comes back to that limit.`
    : '';

  const state = fill
    ? `Triggered, ${fill.filled} of ${fill.orig} already filled, but ${fill.left} is still resting${at}`
    : `Triggered, but this order is still resting unfilled${at}`;

  return `${state}: the position is not protected by it.${comeBack}`;
}
