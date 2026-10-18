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
