import type {
  HLL2BookResponse,
  HLPerpMarginTableEntry,
  HLPerpMetaAndCtx,
} from '@syldel/hl-shared-types';
import { readBookTop } from './market-execution.util';

/**
 * ============================================================================
 * La photographie du marché sur laquelle un ordre au marché est confirmé : le carnet (`l2Book`,
 * poids 2) et le contexte de l'actif (`metaAndAssetCtxs` de son dex, poids 20), lus ensemble, une
 * fois, à l'ouverture de la confirmation. Le prix plafond, le parcours du carnet, le verdict et le
 * prix de liquidation viennent tous d'ELLE.
 *
 * Elle vieillit : au-delà de `MARKET_SNAPSHOT_MAX_AGE_MS`, Confirm la relit avant d'envoyer, et
 * n'envoie que si les chiffres tiennent (`market-recheck.util.ts`). Un plafond
 * calculé sur un mid d'il y a une minute ne protège plus rien.
 * ============================================================================
 */
export const MARKET_SNAPSHOT_MAX_AGE_MS = 10_000;

export interface MarketSnapshot {
  coin: string;
  /** Horloge locale, au retour des deux lectures. */
  readAt: number;
  book: HLL2BookResponse;
  bid: number;
  ask: number;
  mid: number;
  /** `null` quand le contexte de l'actif ne le porte pas : le critère concerné devient inconnu. */
  markPx: number | null;
  oraclePx: number | null;
  dayNtlVlm: number | null;
  funding: number | null;
  marginTableId: number | null;
  marginTables: HLPerpMarginTableEntry[] | null;
}

export type SnapshotReading =
  | { status: 'ok'; snapshot: MarketSnapshot }
  | { status: 'unavailable'; reason: string };

/** Un nombre lu, ou `null` : jamais `0` pour une chaîne absente (`Number(null)` vaut 0). */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function readMarketSnapshot(
  coin: string,
  book: HLL2BookResponse,
  metaAndCtx: HLPerpMetaAndCtx | null | undefined,
  readAt: number,
): SnapshotReading {
  const top = readBookTop(book);
  if (top.status !== 'ok') return { status: 'unavailable', reason: top.reason };

  // Par égalité exacte, comme `readPerpMarketMeta` : une sous-chaîne a déjà fait lire à 38 perps la
  // grille d'un autre. Le contexte d'indice i est celui du marché d'indice i de `universe`.
  const meta = Array.isArray(metaAndCtx) ? metaAndCtx[0] : undefined;
  const ctxs = Array.isArray(metaAndCtx) ? metaAndCtx[1] : undefined;
  const index = meta?.universe?.findIndex((m) => m.name === coin) ?? -1;
  const market = index >= 0 ? meta?.universe[index] : undefined;
  const ctx = index >= 0 && Array.isArray(ctxs) ? ctxs[index] : undefined;

  const markPx = numberOrNull(ctx?.markPx);
  const oraclePx = numberOrNull(ctx?.oraclePx);
  return {
    status: 'ok',
    snapshot: {
      coin,
      readAt,
      book,
      bid: top.bid,
      ask: top.ask,
      mid: top.mid,
      markPx: markPx !== null && markPx > 0 ? markPx : null,
      oraclePx: oraclePx !== null && oraclePx > 0 ? oraclePx : null,
      dayNtlVlm: numberOrNull(ctx?.dayNtlVlm),
      funding: numberOrNull(ctx?.funding),
      marginTableId: typeof market?.marginTableId === 'number' ? market.marginTableId : null,
      marginTables: Array.isArray(meta?.marginTables) ? meta.marginTables : null,
    },
  };
}
