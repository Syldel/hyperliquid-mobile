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
 *
 * ⚠️ **Refaite le 2026-10-15, sur mesures.** La précédente tenait huit couleurs
 * choisies à l'œil, et trois défauts s'y cachaient — trouvés en attachant deux
 * stratégies à un même chart pour la première fois :
 *
 * - **deux couleurs pouvaient être presque identiques.** `#ba68c8` et `#9575cd`
 *   sont à **ΔE2000 9,0** l'une de l'autre, et trois paires sur vingt-huit
 *   étaient sous 20. Sur le chart la couleur est le **seul** identifiant — les
 *   marqueurs ne portent aucun libellé, délibérément —, donc deux teintes
 *   voisines ne sont pas une gêne : elles défont la seule chose qui distingue
 *   deux stratégies ;
 * - **la moitié ne se voyait pas en thème clair.** Le fond du chart vaut
 *   `#1d1d1d` en sombre et `#feffff` en clair (mesuré dans le navigateur) :
 *   `#4dd0e1`, `#ffb74d`, `#4db6ac` et `#ff8a65` tombaient entre **1,73 et
 *   2,44:1** sur le clair, sous le seuil de 3:1 des objets graphiques. La
 *   palette avait été choisie pour un seul des deux thèmes ;
 * - **quatre frôlaient une couleur qui porte déjà un sens.** `#ffb74d` était à
 *   ΔE2000 **8,8** de l'ambre du chevauchement, `#f06292` à **12,4** du rouge
 *   baissier. Éviter le vert et le rouge « francs » ne suffisait pas : c'est la
 *   distance qui compte, pas la vivacité.
 *
 * La nouvelle est le résultat d'une recherche sous quatre contraintes, toutes
 * épinglées par `strategy-color.util.spec.ts` : contraste ≥ 3:1 sur les **deux**
 * fonds, ΔE2000 ≥ 25 des trois couleurs sémantiques du chart, teintes vertes et
 * rouges écartées, et l'écart minimal entre deux couleurs maximisé. Résultat :
 * **12 couleurs** au lieu de 8, écart minimal **15,8** au lieu de 9,0, et plus
 * aucun échec de contraste.
 *
 * ⚠️ Elles sont donc toutes de luminance moyenne — c'est ce qu'impose un
 * contraste tenu contre un fond presque noir **et** un fond presque blanc. Des
 * teintes plus vives ne tiendraient que sur l'un des deux.
 * ============================================================================
 */
export const STRATEGY_COLORS: readonly string[] = [
  '#0397d9',
  '#aa4d01',
  '#6841fd',
  '#5b7009',
  '#be0f9f',
  '#7b84ef',
  '#886100',
  '#b37ab8',
  '#0b69be',
  '#bd8150',
  '#775b9c',
  '#f917ef',
];

/**
 * Hash déterministe (djb2) : deux stratégies différentes peuvent tomber sur la
 * même couleur — c'est une gêne visuelle, jamais une erreur, et le nom reste
 * affiché à côté de la pastille. Douze couleurs au lieu de huit rendent le cas
 * plus rare, sans l'écarter.
 */
export function strategyColor(strategyId: string): string {
  let hash = 5381;
  for (let index = 0; index < strategyId.length; index++) {
    hash = (hash * 33) ^ strategyId.charCodeAt(index);
  }

  return STRATEGY_COLORS[Math.abs(hash) % STRATEGY_COLORS.length];
}
