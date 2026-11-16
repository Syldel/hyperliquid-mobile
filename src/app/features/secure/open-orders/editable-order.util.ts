import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * Les seuls ordres que l'écran « Edit Order » sait modifier — par leur `orderType` exact.
 *
 * Le formulaire lit un ordre existant par morceaux de son nom (`triggerStateOf` : « stop » donne
 * un Stop Loss, « market » un ordre au marché) puis envoie un `modify` ordinaire. Le trailing stop
 * natif d'Hyperliquid, ajouté le 2026-09-21, se lit `"Trailing Stop Market"` avec `isTrigger: true`
 * (mesuré le 2026-11-16 sur ETH : `nest-trading-bot/docs/hyperliquid/live-check.md`, « Le trailing
 * stop natif »). L'écran l'aurait donc pris pour un Stop Market, aurait pré-rempli son déclencheur
 * avec un `triggerPx` qui bouge à chaque nouveau sommet (ou vaut `"0.0"` en attente d'activation),
 * et envoyé un `modify` qui le transforme en stop ordinaire. Or un `modify` refusé a déjà **annulé**
 * l'ordre d'origine (mesuré le 2026-10-27 et le 2026-11-09).
 *
 * La doc de l'API ne décrit aucune modification d'un trailing stop, et l'interface officielle ne la
 * propose pas : le lien « Modify order » y est masqué pour ce type (paquet lu le 2026-11-16).
 *
 * Un type absent de cette liste n'est donc **jamais** modifiable ici, et l'écran dit pourquoi au
 * lieu de griser un bouton sans explication.
 * ============================================================================
 */
const EDITABLE_ORDER_TYPES: ReadonlySet<string> = new Set([
  'Limit',
  'Stop Market',
  'Stop Limit',
  'Take Profit Market',
  'Take Profit Limit',
]);

export const TRAILING_STOP_ORDER_TYPE = 'Trailing Stop Market';

/**
 * Pourquoi cet ordre ne peut pas être modifié ici, ou `null` s'il peut l'être. La phrase s'affiche
 * telle quelle : elle dit quoi faire à la place.
 */
export function editRefusal(order: Pick<HLFrontendOpenOrder, 'orderType'>): string | null {
  if (EDITABLE_ORDER_TYPES.has(order.orderType)) return null;

  if (order.orderType === TRAILING_STOP_ORDER_TYPE) {
    // Remplacer un trailing stop perd son watermark : le nouveau suit depuis le prix marqué du moment.
    return 'A trailing stop cannot be edited here. Cancel it and place a new one: its tracking starts over from the current mark price.';
  }

  return `A "${order.orderType}" order cannot be edited here. Cancel it and place a new one if needed.`;
}
