/**
 * ============================================================================
 * 🎨 STRATEGY COLOR
 * Couleur d'affichage d'une stratégie, dérivée de son `id`.
 *
 * Déterministe et sans stockage : la même stratégie garde sa couleur d'une
 * session à l'autre et d'un appareil à l'autre, sans rien persister ni migrer.
 * Le jour où l'utilisateur voudra la choisir lui-même, elle aura sa place dans
 * `StrategyRef` — et cette fonction deviendra le repli quand aucune couleur
 * n'est fixée.
 *
 * La palette évite volontairement le vert et le rouge francs : ce sont les
 * couleurs des bougies et des côtés LONG/SHORT sur ce chart, les réutiliser
 * ferait lire une identité de stratégie comme une direction de marché.
 * ============================================================================
 */
export const STRATEGY_COLORS: readonly string[] = [
  '#4dd0e1',
  '#ffb74d',
  '#ba68c8',
  '#7986cb',
  '#f06292',
  '#4db6ac',
  '#ff8a65',
  '#9575cd',
];

/**
 * Hash déterministe (djb2) : deux stratégies différentes peuvent tomber sur la
 * même couleur — c'est une gêne visuelle, jamais une erreur, et le nom reste
 * affiché à côté de la pastille.
 */
export function strategyColor(strategyId: string): string {
  let hash = 5381;
  for (let index = 0; index < strategyId.length; index++) {
    hash = (hash * 33) ^ strategyId.charCodeAt(index);
  }

  return STRATEGY_COLORS[Math.abs(hash) % STRATEGY_COLORS.length];
}
