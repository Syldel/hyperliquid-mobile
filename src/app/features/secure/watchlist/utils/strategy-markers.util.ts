import type { TimelineSignal } from '@syldel/trading-shared-types';
import type { SeriesMarker, Time } from 'lightweight-charts';

/** Les signaux d'une stratégie, avec la couleur qui l'identifie sur le chart. */
export interface StrategySignalLayer {
  strategyId: string;
  name: string;
  color: string;
  signals: readonly TimelineSignal[];
}

/**
 * ============================================================================
 * 📍 STRATEGY MARKERS
 * Fusionne les signaux de plusieurs stratégies en un seul jeu de marqueurs.
 *
 * `lightweight-charts` n'accepte qu'un jeu par série, et **exige qu'il soit
 * trié par temps croissant** — deux stratégies entrelacées produisent
 * mécaniquement des temps désordonnés, d'où le tri final. C'est la raison
 * d'être de cette fonction, et la raison pour laquelle elle est pure et testée
 * plutôt que fondue dans le service qui parle au chart.
 *
 * Un marqueur ne porte plus que **deux** informations, et le fait deux fois
 * plutôt qu'une :
 *
 * - **couleur** : la stratégie (la légende, ce sont les chips et le bandeau) ;
 * - **position et forme** : entrée sous la bougie avec une flèche haute, sortie
 *   au-dessus avec une flèche basse.
 *
 * Cette redondance est voulue. Le côté long/short a quitté les marqueurs pour
 * la bande de positions (`StrategyPositionsOverlayService`), qui le montre sur
 * toute la durée et non au seul instant du signal ; les deux canaux restants
 * peuvent donc se renforcer au lieu de coder deux choses différentes. Une
 * version précédente mettait le côté sur la forme, et une flèche haute au-dessus
 * d'une bougie — sortie de short — se lisait de travers.
 *
 * Aucun libellé, délibérément. Une première version écrivait « EMA/SMA cross
 * EXIT LONG » sur chaque marqueur : sur un écran de téléphone, deux stratégies
 * et une trentaine de signaux suffisaient à rendre le chart illisible.
 * ============================================================================
 */
export function buildStrategyMarkers(layers: readonly StrategySignalLayer[]): SeriesMarker<Time>[] {
  const markers = layers.flatMap((layer) =>
    layer.signals.map((signal) => {
      const isEntry = signal.signal === 'ENTER';

      return {
        time: Math.floor(signal.time / 1000) as Time,
        position: isEntry ? ('belowBar' as const) : ('aboveBar' as const),
        color: layer.color,
        shape: isEntry ? ('arrowUp' as const) : ('arrowDown' as const),
      };
    }),
  );

  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}
