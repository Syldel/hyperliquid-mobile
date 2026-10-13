import type {
  BacktestCurrentDrawdown,
  BacktestDrawdown,
  BacktestReport,
  BacktestStats,
  PositionSide,
  StrategyRules,
} from '@syldel/trading-shared-types';
import { formatRatePercent } from '@utils/fee-rate.utils';

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
 *
 * ⚠️ C'est le seul endroit qui dise **de quoi** un chiffre est net : cette liste
 * doit suivre `buildBacktestReport`, sinon elle dément l'écran qui la porte.
 * Vérifié dans le navigateur le 2026-10-11, après que le rapport soit passé net
 * de frais (types partagés 0.27.0) : le résumé affichait la puce « net of fees »
 * à deux lignes d'une note qui disait encore « with no fees », les deux dans le
 * même bloc. Aucun test ne l'avait vu — il y en a un maintenant.
 *
 * La ligne sur les drawdowns annonçait un écart que l'écran ne pouvait pas
 * montrer : TradingView publie un « max drawdown (close-to-close) » **et** un
 * « (intrabar) », nous n'avions que le premier. Depuis les types partagés
 * 0.31.0 le rapport porte les deux, et la note ne prévient plus d'un manque —
 * elle dit comment lire deux chiffres présents. Mesuré le 2026-10-13 sur nos
 * cinq jeux, en achat-conservation, l'intrabar était plus profond de **0,76 à
 * 2,79 points** (l'écart grandit sur les séries courtes : `xyz:BRENTOIL` en 1 j
 * est le pire), toujours dans le même sens.
 *
 * ⚠️ « even it is a lower bound » n'est pas une précaution de style : le sommet
 * de la mesure intra-bougie est lu sur les **clôtures**, jamais sur l'extrême
 * favorable d'une bougie, parce qu'apparier un plus haut et un plus bas à
 * l'intérieur d'une bougie supposerait un ordre que l'OHLC ne donne pas. Un vrai
 * sommet intra-bougie creuserait donc davantage.
 *
 * C'est aussi pourquoi ce n'est plus une constante : depuis la version 0.28.0
 * le rapport porte le palier qu'il a appliqué, et la liste le **lit** au lieu
 * de le taire. Une liste figée ne peut pas suivre une donnée qui vient du
 * serveur.
 */
export function backtestLimits(fees: readonly number[]): readonly string[] {
  return [
    'Simplified simulation — not what the bot would have earned.',
    fillLine(fees),
    "Drawdowns are given twice: on candle closes, and at each candle's worst point — " +
      'the second is the deeper, and even it is a lower bound.',
    "Take-profit / stop-loss, latent orders and the pair's exit behaviour are not simulated yet.",
    'Each trade counts at the same size; returns are added, not compounded.',
  ];
}

/**
 * La ligne qui dit **de quoi** les chiffres sont nets, et sous quelle hypothèse.
 *
 * Le palier vient du rapport (`BacktestReport.feePerSide`, types partagés
 * 0.28.0) et jamais d'ici : le reproduire côté app en ferait une seconde source
 * de vérité, qui divergerait en silence le jour où le bot passerait au palier
 * réel de l'utilisateur. D'où une fonction plutôt qu'une constante.
 */
function fillLine(fees: readonly number[]): string {
  const FILL = "Trades fill at the signal candle's close";
  const REST = 'funding and slippage are not counted';
  const distinct = [...new Set(fees.filter(isUsableFee))].sort((a, b) => a - b);

  // Aucun palier lisible : on ne nomme rien plutôt que de nommer au hasard. Le
  // cas ne devrait pas se produire — `buildBacktestReport` refuse un palier non
  // fini ou négatif — mais l'écran ne doit pas inventer pour autant.
  if (distinct.length === 0) {
    return `${FILL}, net of the trading fees the server applies; ${REST}.`;
  }

  // Un palier nul est un palier **choisi** : celui qui isole ce que les frais
  // coûtent. Annoncer « net de 0 % » ferait lire un net là où il y a un brut.
  if (distinct.length === 1 && distinct[0] === 0) {
    return `${FILL}, with no fees charged; ${REST} either.`;
  }

  if (distinct.length === 1) {
    return `${FILL}, net of ${percentPerSide(distinct[0]!)} per side; ${REST}.`;
  }

  // Deux stratégies au même écran peuvent porter deux paliers : une note qui
  // n'en nommerait qu'un serait fausse pour l'autre.
  return (
    `${FILL}, net of fees charged at different tiers per strategy ` +
    `(${distinct.map(percentPerSide).join(', ')}); ${REST}.`
  );
}

function isUsableFee(fee: number): boolean {
  return Number.isFinite(fee) && fee >= 0;
}

/**
 * `0.00035` → `0.035%`.
 *
 * Délègue à `@utils/fee-rate.utils`, qui porte la même règle pour l'écran des
 * frais : deux copies d'un même arrondi finissent par diverger. Et celle-ci
 * avait déjà son piège — tous les paliers ne tombent pas juste (`0.00035 * 100`
 * rend `0.034999999999999996`), mais le palier de base (`0.00045`) si, de sorte
 * qu'une mutation retirant l'arrondi y a survécu jusqu'au 2026-10-11.
 */
function percentPerSide(fee: number): string {
  return formatRatePercent(fee);
}

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

/**
 * Les bornes de la pire baisse, prêtes à l'affichage.
 *
 * `BacktestDrawdown` porte `peakTime` et `troughTime` depuis les types partagés
 * 0.26.0 et aucun écran ne les lisait — alors que la profondeur seule ne dit pas
 * si une chute de 12 % s'est jouée en trois heures ou en trois mois. Les deux
 * références publient cette durée à côté du chiffre : Freqtrade sort
 * « Drawdown start / end / duration », TradingView une « max drawdown duration ».
 *
 * ⚠️ `peakTime: null` ne veut **pas** dire « pas de sommet ». Depuis les types
 * partagés 0.30.0, le sommet est planché au capital intact, et ce `null` désigne
 * un sommet qui est le **début de la fenêtre** : aucune bougie ne l'a touché,
 * parce que la courbe n'est jamais remontée au capital de départ. C'est le cas
 * courant d'une position ouverte sur la première bougie, dont le frais d'entrée
 * fait plonger la courbe sous 1 avant tout autre point. D'où `rangeStart` en
 * second argument — rendre ce `null` à un `DatePipe` afficherait le 1er janvier
 * 1970.
 *
 * Le discriminant est `troughTime` et non `depthPercent` : le rapport ne pose un
 * creux que lorsqu'il a mesuré une baisse, donc un creux implique une profondeur
 * non nulle, quand l'inverse se déduit moins sûrement d'un flottant.
 */
export interface DrawdownWindow {
  /** Bougie du sommet, ou `rangeStart` quand le sommet est le début de la fenêtre. */
  fromTime: number;
  toTime: number;
  /** `0` quand le sommet et le creux tombent au même instant. */
  durationMs: number;
  /** `true` quand `fromTime` est le début de la fenêtre et non une bougie observée. */
  fromRangeStart: boolean;
}

export function drawdownWindow(
  drawdown: BacktestDrawdown,
  rangeStart: number,
): DrawdownWindow | null {
  if (drawdown.troughTime === null) return null;

  const fromTime = drawdown.peakTime ?? rangeStart;
  return {
    fromTime,
    toTime: drawdown.troughTime,
    durationMs: drawdown.troughTime - fromTime,
    fromRangeStart: drawdown.peakTime === null,
  };
}

/**
 * Depuis quand la courbe est sous son sommet, quand elle y est **encore**.
 *
 * `currentDrawdown` (types partagés 0.31.0) ne porte pas de creux : son point de
 * mesure est la dernière bougie. On la lui donne donc, et la fenêtre qui en sort
 * se lit « depuis ce sommet, et depuis ce temps-là » — la question qu'un
 * maximum, refermé ou non, ne distingue pas.
 *
 * Passe par `drawdownWindow` plutôt que de refaire la substitution du sommet
 * nul : c'est la même règle, et deux copies finiraient par en appliquer deux.
 */
export function underwaterWindow(
  current: BacktestCurrentDrawdown,
  rangeStart: number,
  lastCandleTime: number | null,
): DrawdownWindow | null {
  // Jugé sur la valeur **affichée**, comme `percentTone` : un recul de 0,004 %
  // s'écrit `0.00%`, et annoncer un compte sous son sommet pour ça alarmerait là
  // où le chiffre montre zéro.
  if (lastCandleTime === null || percentTone(-current.depthPercent) !== 'down') return null;

  return drawdownWindow(
    { depthPercent: current.depthPercent, peakTime: current.peakTime, troughTime: lastCandleTime },
    rangeStart,
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `2 d 12 h`, `4 h 30 min`, `45 min`.
 *
 * Deux unités au plus : la troisième n'a jamais changé une lecture, et la place
 * manque sur un téléphone. Une durée négative ou non finie rend `?` plutôt qu'un
 * chiffre inventé — elle ne peut venir que d'un rapport incohérent, et un
 * rapport incohérent doit se voir (voir CLAUDE.md, « aucune défaillance muette »).
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  // Aucune bougie ne dure moins d'une minute, donc ce cas vient d'un intervalle
  // qu'Hyperliquid ne sert pas encore : afficher « 0 min » le nierait.
  if (ms < MINUTE) return '< 1 min';

  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);

  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
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
