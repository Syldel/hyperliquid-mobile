// Seul point d'entrée autorisé pour `buildIndicatorKeyFromOperand` côté mobile
// (voir no-catalog-imports.spec.ts) : la clé produite ici ne sert QUE de clé
// de cache local (IndicatorColorService → Preferences) et de libellé d'affichage
// (indicator-label.util.ts), jamais à indexer une réponse serveur — une dérive
// entre ce calcul et le registre exécuté par le bot ne peut donc, au pire,
// qu'égarer une couleur sauvegardée, jamais afficher une donnée erronée.
import { buildIndicatorKeyFromOperand, IndicatorRequest } from '@syldel/trading-shared-types';

/** Clé stable par type+params (ex: "ema_9", "hma_9", "macd_12_26_9"), utilisée
 *  pour partager une couleur/un style entre tous les charts d'un même indicateur.
 *  Délègue au registre partagé (`INDICATOR_DEFAULTS`) pour toute valeur omise. */
export function buildIndicatorKey(req: IndicatorRequest): string {
  return buildIndicatorKeyFromOperand(req);
}
