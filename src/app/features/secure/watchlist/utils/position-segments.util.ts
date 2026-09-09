import type { TimelineSignal } from '@syldel/trading-shared-types';

/** Une période pendant laquelle une position est ouverte. `to === null` = encore ouverte à la fin. */
export interface PositionSegment {
  side: 'LONG' | 'SHORT';
  from: number;
  to: number | null;
}

/**
 * ============================================================================
 * 📊 POSITION SEGMENTS
 * Convertit une suite d'évènements (`ENTER` / `EXIT`) en périodes de position.
 *
 * Les marqueurs du chart montrent des **instants** ; cette fonction produit ce
 * qu'ils ne peuvent pas montrer : des **durées**. « Je suis long ici, à plat
 * là, short ensuite » est la question qu'on se pose vraiment en jugeant une
 * stratégie, et aucune flèche ne peut y répondre seule.
 *
 * Les deux côtés sont suivis indépendamment : les branches `long` et `short`
 * d'une stratégie sont indépendantes, elles peuvent donc être ouvertes en même
 * temps, et une stratégie peut parfaitement n'en exploiter qu'une.
 *
 * Tolérant par conception, parce que la donnée vient d'un moteur : un `EXIT`
 * sans `ENTER` correspondant est ignoré plutôt que de produire un segment qui
 * commencerait nulle part, et un `ENTER` jamais refermé donne un segment
 * ouvert (`to: null`) — c'est le `openPositionAtEnd` du bilan, rendu visible.
 * ============================================================================
 */
export function buildPositionSegments(signals: readonly TimelineSignal[]): PositionSegment[] {
  const ordered = [...signals].sort((a, b) => a.time - b.time);
  const openBySide = new Map<'LONG' | 'SHORT', number>();
  const segments: PositionSegment[] = [];

  for (const signal of ordered) {
    const side = sideOf(signal);

    if (signal.signal === 'ENTER') {
      // Un second ENTER sans sortie ne rouvre rien : la position est déjà
      // ouverte, et la renouveler tronquerait le segment en cours.
      if (!openBySide.has(side)) openBySide.set(side, signal.time);
      continue;
    }

    const from = openBySide.get(side);
    if (from === undefined) continue;

    segments.push({ side, from, to: signal.time });
    openBySide.delete(side);
  }

  for (const [side, from] of openBySide) {
    segments.push({ side, from, to: null });
  }

  return segments.sort((a, b) => a.from - b.from);
}

/** Un côté absent vaut LONG — le défaut du moteur, cohérent avec les marqueurs. */
function sideOf(signal: TimelineSignal): 'LONG' | 'SHORT' {
  return signal.metadata?.['side'] === 'SHORT' ? 'SHORT' : 'LONG';
}

/** Un point de la bande de positions, au format attendu par un histogramme. */
export interface PositionBar {
  /** En SECONDES, comme tout ce que reçoit lightweight-charts. */
  time: number;
  value: number;
  color: string;
}

/** Hauteur d'une barre dans sa ligne : laisse un filet vide entre deux stratégies. */
const BAR_HEIGHT = 0.8;

/**
 * Étale les segments sur les bougies, pour que la bande soit continue plutôt
 * qu'un point à chaque évènement.
 *
 * `row` est l'indice de la stratégie : la barre occupe `[row, row + 0.8]`, ce
 * qui empile les stratégies en lignes distinctes sur une même échelle.
 *
 * La bougie de sortie est exclue (`time < to`) : à cet instant la position est
 * refermée, la colorer laisserait croire qu'elle court encore.
 */
export function buildPositionBars(
  segments: readonly PositionSegment[],
  candleTimesMs: readonly number[],
  row: number,
  colors: { long: string; short: string },
): PositionBar[] {
  const bars: PositionBar[] = [];

  for (const time of [...candleTimesMs].sort((a, b) => a - b)) {
    const segment = segments.find(
      (candidate) => candidate.from <= time && (candidate.to === null || time < candidate.to),
    );
    if (!segment) continue;

    bars.push({
      time: Math.floor(time / 1000),
      value: row + BAR_HEIGHT,
      color: segment.side === 'SHORT' ? colors.short : colors.long,
    });
  }

  return bars;
}
