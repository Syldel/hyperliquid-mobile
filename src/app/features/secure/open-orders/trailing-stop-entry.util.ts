import { formatPrice, formatSize, TickAndLotError } from '@syldel/hl-shared-types';
import { isPerpMarket, openOrdersDexOf } from '@utils/market-kind.util';

/**
 * ============================================================================
 * LA SAISIE D'UN TRAILING STOP NATIF QUI FERME UNE POSITION : CE QUI PART, OU POURQUOI RIEN NE PART
 *
 * Le formulaire (étape 3 du chantier, `docs/roadmap.md`) ne pose qu'un trailing **reduce-only**, du
 * côté qui ferme la position : une vente pour un long, un achat pour un short. Cette fonction pure
 * décide de la requête exacte vers `POST /orders/trailing-stop` du gateway, ou dit, champ par champ,
 * pourquoi elle ne part pas.
 *
 * Elle reprend les refus du gateway (`nest-hyperliquid-gateway/src/hyperliquid/utils/
 * trailing-stop-action.ts`), pour les dire **à la saisie** plutôt qu'après un aller-retour — le
 * gateway reste l'autorité, et ses 400 s'affichent tels quels (`extractErrorMessage`) :
 *
 * - **une valeur hors grille est refusée, jamais arrondie**, avec la valeur la plus proche en dessous.
 *   Un stop dont la taille ou la distance auraient été rabotées n'est plus celui qu'on a demandé ;
 * - **une activation du mauvais côté du marqué est refusée** : l'exchange l'ACCEPTE et commence à
 *   suivre tout de suite (mesuré le 2026-11-17, S4) — un ordre différent de celui qu'on croit poser ;
 * - le pourcentage a au plus quatre décimales (la précision signée, `toFixed(4)`), et reste sous
 *   100 % : 100 % a été refusé par l'exchange (« Trailing stop retracement is invalid. ») ; la borne
 *   exacte n'est pas mesurée ;
 * - seuls les perps du dex principal : le gateway refuse le spot, les outcomes et les dex HIP-3.
 *
 * Et un avertissement que le gateway ne donne pas : **le minimum de 10 $ se compte au déclenchement**,
 * pas au marqué. Une position BTC de 10,41 $ (2026-11-17) aurait déclenché un ordre au marché sous le
 * minimum après un repli. ⚠️ Qu'Hyperliquid applique ce minimum à un ordre reduce-only qui ferme toute
 * la position n'est pas mesuré : c'est un avertissement, pas un refus.
 * ============================================================================
 */

export type TrailingUnit = 'pct' | 'px';

export interface TrailingEntryInput {
  coin: string;
  /** La taille signée de la position (`szi`) : positive pour un long, négative pour un short. */
  positionSzi: string;
  markPx: string;
  szDecimals: number;
  sz: string;
  retracement: { unit: TrailingUnit; value: string };
  /** Vide ou `null` : le suivi commence à la pose. */
  activationPx: string | null;
}

/** Le corps de `POST /orders/trailing-stop`, tel que le DTO du gateway l'attend. */
export interface TrailingStopRequestBody {
  assetName: string;
  isBuy: boolean;
  sz: string;
  reduceOnly: true;
  retracement: { pct: string } | { px: string };
  activationPx?: string;
}

export type TrailingEntryField = 'position' | 'sz' | 'retracement' | 'activation';

export interface TrailingEntryIssue {
  field: TrailingEntryField;
  message: string;
}

export interface TrailingEntryPlan {
  body: TrailingStopRequestBody;
  isBuy: boolean;
  /** Le stop au moment où le suivi commence : à la pose, ou à l'activation. */
  stopAtStart: number;
  /** `null` : le suivi commence à la pose. */
  activation: { direction: 'above' | 'below'; px: string } | null;
  /** La valeur de l'ordre au marché s'il partait au stop de départ. */
  notionalAtStop: number;
}

export type TrailingEntryResult =
  | { ok: true; plan: TrailingEntryPlan; warnings: string[] }
  | { ok: false; issues: TrailingEntryIssue[] };

/** Le minimum d'un ordre chez Hyperliquid, et la marge qu'on prend au-dessus (la même que la sonde du bot). */
const MIN_NOTIONAL_WITH_MARGIN = 10.5;
const PCT_DECIMALS = 4;
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

export function planTrailingEntry(input: TrailingEntryInput): TrailingEntryResult {
  const issues: TrailingEntryIssue[] = [];
  const refuse = (field: TrailingEntryField, message: string) => issues.push({ field, message });

  if (!isPerpMarket(input.coin) || openOrdersDexOf(input.coin) !== '') {
    refuse('position', `${input.coin}: native trailing stops are placed on main-dex perps only.`);
    return { ok: false, issues };
  }

  const position = Number(input.positionSzi);
  const mark = Number(input.markPx);
  if (!Number.isFinite(position) || position === 0) {
    refuse('position', `No open position on ${input.coin} to close.`);
    return { ok: false, issues };
  }
  if (!Number.isFinite(mark) || mark <= 0) {
    // Sans marqué, ni le côté de l'activation ni le stop de départ ne se contrôlent.
    refuse(
      'position',
      `The mark price of ${input.coin} reads "${input.markPx}": nothing can be checked.`,
    );
    return { ok: false, issues };
  }
  const isBuy = position < 0;

  const sz = onSizeGrid(input.sz, input.szDecimals, refuse);
  if (sz !== null && Number(sz) > Math.abs(position)) {
    refuse('sz', `Size ${sz} is larger than the position (${Math.abs(position)}).`);
  }

  const retracement = readRetracement(input, refuse);

  const rawActivation = input.activationPx?.trim() || null;
  let activation: TrailingEntryPlan['activation'] = null;
  if (rawActivation !== null) {
    const px = onPriceGrid('Activation', rawActivation, input.szDecimals, refuse);
    if (px !== null) {
      const waits = isBuy ? Number(px) < mark : Number(px) > mark;
      if (waits) {
        activation = { direction: isBuy ? 'below' : 'above', px };
      } else {
        refuse(
          'activation',
          isBuy
            ? `A buy activates below the mark (${input.markPx}): at ${px} tracking would start at once.`
            : `A sell activates above the mark (${input.markPx}): at ${px} tracking would start at once.`,
        );
      }
    }
  }

  if (issues.length > 0 || sz === null || retracement === null) return { ok: false, issues };

  const startFrom = activation ? Number(activation.px) : mark;
  const stopAtStart = stopFrom(startFrom, retracement, isBuy);
  if (!(stopAtStart > 0)) {
    refuse(
      'retracement',
      `This retracement puts the stop at ${stopAtStart}: it must stay above zero.`,
    );
    return { ok: false, issues };
  }

  const notionalAtStop = Number(sz) * stopAtStart;
  const warnings: string[] = [];
  if (notionalAtStop < MIN_NOTIONAL_WITH_MARGIN) {
    warnings.push(
      `At the starting stop this order is worth ${notionalAtStop.toFixed(2)} $: under the 10 $ minimum, ` +
        `the market order it sends may be refused when it triggers.`,
    );
  }

  const body: TrailingStopRequestBody = {
    assetName: input.coin,
    isBuy,
    sz,
    reduceOnly: true,
    retracement:
      retracement.unit === 'pct' ? { pct: retracement.value } : { px: retracement.value },
    ...(activation ? { activationPx: activation.px } : {}),
  };

  return { ok: true, plan: { body, isBuy, stopAtStart, activation, notionalAtStop }, warnings };
}

/** Le stop de la doc : watermark × (1 ± taux), ou watermark ± distance ; le signe suit le côté. */
function stopFrom(
  watermark: number,
  retracement: { unit: TrailingUnit; value: string },
  isBuy: boolean,
): number {
  const sign = isBuy ? 1 : -1;
  return retracement.unit === 'pct'
    ? watermark * (1 + (sign * Number(retracement.value)) / 100)
    : watermark + sign * Number(retracement.value);
}

type Refuse = (field: TrailingEntryField, message: string) => void;

function readRetracement(
  input: TrailingEntryInput,
  refuse: Refuse,
): { unit: TrailingUnit; value: string } | null {
  const raw = input.retracement.value.trim();
  if (input.retracement.unit === 'px') {
    const px = onPriceGrid('Retracement', raw, input.szDecimals, refuse, 'retracement');
    return px === null ? null : { unit: 'px', value: px };
  }
  if (!isPositiveDecimal(raw)) {
    refuse('retracement', `Retracement must be a percentage above zero, got "${raw}".`);
    return null;
  }
  const decimals = raw.split('.')[1]?.length ?? 0;
  if (decimals > PCT_DECIMALS) {
    refuse('retracement', `Retracement ${raw} % has more than ${PCT_DECIMALS} decimals.`);
    return null;
  }
  if (Number(raw) >= 100) {
    refuse('retracement', `Retracement must stay under 100 % (100 % was refused by Hyperliquid).`);
    return null;
  }
  return { unit: 'pct', value: canonical(raw) };
}

function onSizeGrid(raw: string, szDecimals: number, refuse: Refuse): string | null {
  const value = raw.trim();
  if (!isPositiveDecimal(value)) {
    refuse('sz', `Size must be a number above zero, got "${value}".`);
    return null;
  }
  const onGrid = gridValue(() => formatSize(value, szDecimals));
  if (onGrid === null) {
    refuse('sz', `Size ${value} is below the smallest step (${szDecimals} decimals).`);
    return null;
  }
  if (onGrid !== canonical(value)) {
    refuse('sz', `Size ${value} is not on the size grid: the nearest size below is ${onGrid}.`);
    return null;
  }
  return onGrid;
}

function onPriceGrid(
  label: string,
  raw: string,
  szDecimals: number,
  refuse: Refuse,
  field: TrailingEntryField = 'activation',
): string | null {
  if (!isPositiveDecimal(raw)) {
    refuse(field, `${label} must be a price above zero, got "${raw}".`);
    return null;
  }
  const onGrid = gridValue(() => formatPrice(raw, szDecimals, 'perp'));
  if (onGrid === null) {
    refuse(field, `${label} ${raw} is below the smallest price step.`);
    return null;
  }
  if (onGrid !== canonical(raw)) {
    refuse(
      field,
      `${label} ${raw} is not on the price grid: the nearest price below is ${onGrid}.`,
    );
    return null;
  }
  return onGrid;
}

/** La valeur sur la grille, ou `null` quand la grille la réduit à zéro. */
function gridValue(format: () => string): string | null {
  try {
    return format();
  } catch (error) {
    if (error instanceof TickAndLotError) return null;
    throw error;
  }
}

function isPositiveDecimal(value: string): boolean {
  return PLAIN_DECIMAL.test(value) && /[1-9]/.test(value);
}

/** La décimale sans zéro de tête ni de queue : la forme que rend la grille, et celle du gateway. */
function canonical(value: string): string {
  const [int, frac = ''] = value.split('.');
  const kept = frac.replace(/0+$/, '');
  const head = int.replace(/^0+(?=\d)/, '');
  return kept ? `${head}.${kept}` : head;
}
