import type { BookWalk } from './market-execution.util';

/**
 * ============================================================================
 * Le risque d'EXÉCUTION d'un ordre au marché : ce que cet ordre va payer, maintenant, pour cette
 * taille. Pas le risque de la position (le stop, la volatilité qui le toucherait) : c'est une autre
 * question, et l'y mêler faisait lire des bougies d'une minute pour juger une exécution d'une
 * seconde (retiré le 2026-11-12, avec l'utilisateur).
 *
 * **Le pire critère décide** du verdict, il n'y a pas de somme pondérée : un bon volume sur 24 h ne
 * doit pas masquer un carnet vide à l'instant. Chaque critère s'affiche avec sa valeur, pour qu'on
 * voie POURQUOI le verdict est rouge. Un critère qu'on ne peut pas mesurer est `unknown` et compte
 * comme une prudence : une donnée absente n'est jamais un « OK ».
 *
 * Le verdict n'empêche rien (décidé le 2026-11-12) : un « High » est un message rouge, pas un
 * blocage.
 *
 * Les seuils sont des points de départ, posés le 2026-11-12 sans référence externe qui les fixe :
 * ni la doc d'Hyperliquid ni celle du SDK n'en donnent. À réviser sur l'usage.
 * ============================================================================
 */

export type RiskLevel = 'ok' | 'caution' | 'high' | 'unknown';
export type RiskVerdict = 'ok' | 'caution' | 'high';

export interface RiskCriterion {
  id: 'impact' | 'fillable' | 'spread' | 'mid-mark' | 'mark-oracle' | 'volume';
  label: string;
  value: string;
  level: RiskLevel;
}

export interface RiskAssessment {
  verdict: RiskVerdict;
  criteria: RiskCriterion[];
}

/** En %. `caution` à partir de, `high` à partir de. */
export const RISK_THRESHOLDS = {
  /** Écart entre le prix moyen estimé et le mid. */
  impactPct: { caution: 0.1, high: 0.5 },
  /** (ask − bid) / mid. */
  spreadPct: { caution: 0.1, high: 0.5 },
  /**
   * |mid − mark| / mark : la perte (ou le gain) latent(e) affiché(e) dès l'exécution, puisque le PnL
   * et la liquidation se calculent au mark (`robust-price-indices.md`).
   */
  midMarkPct: { caution: 0.2, high: 1 },
  /** |mark − oracle| / oracle : Hyperliquid décroché des autres places. */
  markOraclePct: { caution: 0.5, high: 2 },
  /** Notionnel de l'ordre / volume notionnel des dernières 24 h. */
  volumeSharePct: { caution: 1, high: 5 },
} as const;

export interface RiskInput {
  sz: number;
  bid: number;
  ask: number;
  mid: number;
  walk: BookWalk;
  /** `null` quand le contexte de l'actif ne le porte pas. */
  markPx: number | null;
  oraclePx: number | null;
  dayNtlVlm: number | null;
}

/** Un pourcentage lisible même tout petit : 0,003 % ne s'écrit pas « 0,00 % ». */
export function formatPct(pct: number): string {
  const abs = Math.abs(pct);
  return `${abs < 0.1 ? pct.toFixed(3) : pct.toFixed(2)} %`;
}

function levelOf(value: number, thresholds: { caution: number; high: number }): RiskLevel {
  if (value >= thresholds.high) return 'high';
  if (value >= thresholds.caution) return 'caution';
  return 'ok';
}

function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function assessMarketRisk(input: RiskInput): RiskAssessment {
  const { walk } = input;
  const criteria: RiskCriterion[] = [];

  // 1. Ce que cette taille coûte, en parcourant le carnet.
  if (walk.avgPx === null) {
    criteria.push({
      id: 'impact',
      label: 'Est. price impact',
      value: 'nothing fillable within max slippage',
      level: 'high',
    });
  } else {
    const impact = (Math.abs(walk.avgPx - input.mid) / input.mid) * 100;
    criteria.push({
      id: 'impact',
      label: 'Est. price impact',
      // Sur la seule part visible : au-delà des 20 niveaux, l'impact réel est au moins celui-là.
      value: walk.depthExhausted ? `≥ ${formatPct(impact)} (visible book only)` : formatPct(impact),
      level: walk.depthExhausted ? 'unknown' : levelOf(impact, RISK_THRESHOLDS.impactPct),
    });
  }

  // 2. La part que le carnet remplit sans dépasser le plafond. Le reste d'un IOC est annulé.
  const fillShare = walk.requestedSz > 0 ? (walk.fillableSz / walk.requestedSz) * 100 : 0;
  criteria.push({
    id: 'fillable',
    label: 'Fillable within max slippage',
    value: walk.depthExhausted
      ? `${fillShare.toFixed(0)} % visible, size beyond the 20 book levels`
      : fillShare >= 100
        ? '100 %'
        : `${fillShare.toFixed(0)} % (the rest would be cancelled)`,
    level: walk.depthExhausted ? 'unknown' : fillShare >= 100 ? 'ok' : 'high',
  });

  // 3. Le spread.
  const spread = ((input.ask - input.bid) / input.mid) * 100;
  criteria.push({
    id: 'spread',
    label: 'Spread',
    value: formatPct(spread),
    level: levelOf(spread, RISK_THRESHOLDS.spreadPct),
  });

  // 4. Mid contre mark.
  if (positive(input.markPx)) {
    const gap = (Math.abs(input.mid - input.markPx) / input.markPx) * 100;
    criteria.push({
      id: 'mid-mark',
      label: 'Mid vs mark',
      value: formatPct(gap),
      level: levelOf(gap, RISK_THRESHOLDS.midMarkPct),
    });
  } else {
    criteria.push({ id: 'mid-mark', label: 'Mid vs mark', value: 'unknown', level: 'unknown' });
  }

  // 5. Mark contre oracle.
  if (positive(input.markPx) && positive(input.oraclePx)) {
    const gap = (Math.abs(input.markPx - input.oraclePx) / input.oraclePx) * 100;
    criteria.push({
      id: 'mark-oracle',
      label: 'Mark vs oracle',
      value: formatPct(gap),
      level: levelOf(gap, RISK_THRESHOLDS.markOraclePct),
    });
  } else {
    criteria.push({
      id: 'mark-oracle',
      label: 'Mark vs oracle',
      value: 'unknown',
      level: 'unknown',
    });
  }

  // 6. La taille rapportée au volume des dernières 24 h.
  if (input.dayNtlVlm === null || !Number.isFinite(input.dayNtlVlm) || input.dayNtlVlm < 0) {
    criteria.push({
      id: 'volume',
      label: 'Share of 24 h volume',
      value: 'unknown',
      level: 'unknown',
    });
  } else if (input.dayNtlVlm === 0) {
    criteria.push({
      id: 'volume',
      label: 'Share of 24 h volume',
      value: 'no volume in 24 h',
      level: 'high',
    });
  } else {
    const share = ((input.sz * input.mid) / input.dayNtlVlm) * 100;
    criteria.push({
      id: 'volume',
      label: 'Share of 24 h volume',
      value: formatPct(share),
      level: levelOf(share, RISK_THRESHOLDS.volumeSharePct),
    });
  }

  return { verdict: verdictOf(criteria), criteria };
}

export function verdictOf(criteria: RiskCriterion[]): RiskVerdict {
  if (criteria.some((c) => c.level === 'high')) return 'high';
  if (criteria.some((c) => c.level === 'caution' || c.level === 'unknown')) return 'caution';
  return 'ok';
}

/**
 * Le funding, pour information : il ne compte pas dans le verdict (il coûte à la détention, pas à
 * l'exécution). Le taux d'`assetCtx` est horaire ; positif, les longs paient les shorts.
 */
export function describeFunding(funding: number | null, isBuy: boolean): string | null {
  if (funding === null || !Number.isFinite(funding)) return null;
  if (funding === 0) return 'Funding 0 %/h';
  const longsPay = funding > 0;
  const youPay = longsPay === isBuy;
  return `Funding ${(funding * 100).toFixed(4)} %/h, ${youPay ? 'you would pay it' : 'you would receive it'}`;
}
