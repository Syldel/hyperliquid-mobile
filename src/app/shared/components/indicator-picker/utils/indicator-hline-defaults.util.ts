import { HlineStyle, HlineZoneStyle, IndicatorHlineStyles, LineStyleType } from '../models/indicator.model';

/** Liste figée (volontairement non dérivée d'un registre partagé) des indicateurs
 *  qui affichent l'onglet "Style" avec Levels/Zones dans le picker. */
export type HlineIndicatorName = 'rsi' | 'stochrsi' | 'chop';

export function isHlineIndicatorName(name: string): name is HlineIndicatorName {
  return name === 'rsi' || name === 'stochrsi' || name === 'chop';
}

let idSeq = 0;

/** Identifiant stable pour une ligne/zone, généré une fois puis persisté avec elle.
 *  Pas de dépendance à crypto.randomUUID pour rester compatible avec tous les webviews. */
export function generateHlineId(): string {
  idSeq += 1;
  return `hl_${Date.now().toString(36)}_${idSeq}`;
}

function line(value: number, visible: boolean, color: string, lineStyle: LineStyleType): HlineStyle {
  return { id: generateHlineId(), visible, value, color, lineStyle };
}

function zone(
  upperValue: number,
  lowerValue: number,
  color: string,
  opacity: number,
  visible = true,
): HlineZoneStyle {
  return { id: generateHlineId(), visible, upperValue, lowerValue, color, opacity };
}

/** Construit un jeu de Levels/Zones "de départ" pour un indicateur.
 *  Appelé UNIQUEMENT si rien n'est encore persisté pour la clé d'indicateur donnée —
 *  purement des suggestions, entièrement modifiables/supprimables par l'utilisateur.
 *  Doit renvoyer un objet frais à chaque appel (jamais une référence partagée). */
export function buildDefaultHlineStyles(name: HlineIndicatorName): IndicatorHlineStyles {
  switch (name) {
    case 'rsi':
      return {
        lines: [
          line(70, true, '#787b86', 'dashed'),
          line(50, false, '#787b86', 'dotted'),
          line(30, true, '#787b86', 'dashed'),
        ],
        zones: [zone(70, 30, '#7e57c2', 10)],
      };
    case 'stochrsi':
      return {
        lines: [line(80, true, '#787b86', 'dashed'), line(20, true, '#787b86', 'dashed')],
        zones: [zone(80, 20, '#2196f3', 10)],
      };
    case 'chop':
      return {
        lines: [line(61.8, true, '#787b86', 'dashed'), line(38.2, true, '#787b86', 'dashed')],
        zones: [zone(61.8, 38.2, '#ff9800', 10)],
      };
  }
}
