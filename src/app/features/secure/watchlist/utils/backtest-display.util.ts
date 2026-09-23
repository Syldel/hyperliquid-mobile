import type {
  BacktestReport,
  BacktestStats,
  PositionSide,
  StrategyRules,
} from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 📈 BACKTEST DISPLAY
 * Ce que l'écran tire du `BacktestReport` servi par le bot — sans jamais le
 * recalculer.
 *
 * Le rapport vient de `buildBacktestReport` (trading-shared-types), exécuté par
 * le bot : c'est lui qui fait autorité. Ici on ne fait que choisir quoi montrer
 * et comment l'arrondir. Un chiffre recalculé côté app pourrait diverger du
 * bot en silence ; un chiffre arrondi pour l'affichage ne le peut pas.
 * ============================================================================
 */

/**
 * Les écarts connus entre la simulation et le bot. Affichés **avec** les
 * chiffres, jamais seuls : ils se lisent sinon comme « ce que la stratégie
 * aurait rapporté ». Voir docs/watchlist/chart-overlays.md.
 */
export const BACKTEST_LIMITS: readonly string[] = [
  'Simplified simulation — not what the bot would have earned.',
  "Trades fill at the signal candle's close, with no fees, funding or slippage.",
  "Take-profit / stop-loss, latent orders and the pair's exit behaviour are not simulated yet.",
  'Each trade counts at the same size; returns are added, not compounded.',
];

/** `+1.23%`, `-0.40%` : le signe toujours écrit, pour qu'un gain ne se lise pas comme une perte. */
export function formatPercent(value: number, digits = 2): string {
  const rounded = value.toFixed(digits);
  // `-0.00` après arrondi n'est pas une perte : l'afficher ainsi alarmerait pour rien.
  if (Number(rounded) === 0) return `${(0).toFixed(digits)}%`;
  return `${value > 0 ? '+' : ''}${rounded}%`;
}

/**
 * La teinte d'un pourcentage, jugée sur la valeur **affichée** et non sur la
 * valeur brute : un +0,004 % s'affiche `0.00%`, et le colorer en vert dirait un
 * gain que le texte ne montre pas. Constaté sur un rapport réel.
 */
export function percentTone(value: number, digits = 2): 'up' | 'down' | null {
  const rounded = Number(value.toFixed(digits));
  return rounded > 0 ? 'up' : rounded < 0 ? 'down' : null;
}

const PRICE_FORMAT = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 });

/**
 * Un prix lisible quelle que soit son échelle : `76,438.5` pour BTC comme
 * `0.0000123456` pour un token à huit décimales. Un nombre fixe de décimales
 * écraserait l'un ou noierait l'autre.
 *
 * ⚠️ **À ne pas confondre avec `formatPrice` de `@syldel/hl-shared-types`**,
 * qui est un tout autre métier : celui-là pose un prix sur la grille de tick
 * d'Hyperliquid pour qu'un ordre soit accepté, et rendrait `76438.5` — sans
 * séparateur de milliers, puisqu'une virgule ferait refuser l'ordre. D'où le
 * suffixe ici : le nom dit pour qui la valeur est écrite. Un import de travers
 * ne compile de toute façon pas, le partagé exigeant un `szDecimals`.
 */
export function formatPriceForDisplay(value: number): string {
  return PRICE_FORMAT.format(value);
}

/**
 * Les côtés qu'une stratégie évalue. Un côté sans règles n'a rien à dire, et
 * afficher « Short 0 trade » pour une stratégie purement longue laisserait
 * croire à un côté short qui ne produit rien.
 */
export function definedSides(rules: StrategyRules | undefined | null): PositionSide[] {
  const sides: PositionSide[] = [];
  if (rules?.long) sides.push('LONG');
  if (rules?.short) sides.push('SHORT');
  return sides;
}

export function statsOf(report: BacktestReport, side: PositionSide): BacktestStats {
  return side === 'LONG' ? report.long : report.short;
}

export interface EquityLine {
  id: 'total' | PositionSide;
  points: { time: number; value: number }[];
}

/**
 * Les courbes à tracer.
 *
 * Le total quand il existe ; un côté en plus seulement quand les deux ont
 * travaillé, pour voir d'où vient le total sans doubler une courbe identique.
 * Sans total (long et short se chevauchent), chaque côté a sa courbe — et aucune
 * somme n'est dessinée, puisque le bot ne pourrait pas la réaliser.
 */
export function equityLines(report: BacktestReport, sides: readonly PositionSide[]): EquityLine[] {
  const active = sides.filter((side) => isActive(report, side));
  const sideLine = (side: PositionSide): EquityLine => ({
    id: side,
    points: report.equity.map((p) => ({ time: p.time, value: side === 'LONG' ? p.long : p.short })),
  });

  if (report.total === null) {
    return (active.length > 0 ? active : sides).map(sideLine);
  }

  const total: EquityLine = {
    id: 'total',
    points: report.equity.map((p) => ({ time: p.time, value: p.total ?? 0 })),
  };
  return active.length > 1 ? [total, ...active.map(sideLine)] : [total];
}

function isActive(report: BacktestReport, side: PositionSide): boolean {
  return (
    statsOf(report, side).trades > 0 ||
    report.openPositions.some((p) => p.side === side) ||
    report.carriedIn.some((p) => p.side === side)
  );
}

/**
 * La plage à montrer sur le chart principal pour un trade touché dans la liste.
 *
 * Marge de chaque côté : la moitié de la durée du trade, au moins dix bougies —
 * le contexte d'entrée et de sortie compte autant que le trade lui-même. Une
 * position encore ouverte court jusqu'à la dernière bougie.
 */
export function tradeFocusRange(
  trade: { entryTime: number; exitTime: number | null },
  intervalMs: number,
  lastCandleTime: number,
): { from: number; to: number } {
  const end = trade.exitTime ?? lastCandleTime;
  const margin = Math.max((end - trade.entryTime) / 2, 10 * intervalMs);
  return { from: trade.entryTime - margin, to: Math.min(end + margin, lastCandleTime) };
}
