import { HL_ORDER_TYPE, type HLFrontendOpenOrder, type HLOid } from '@syldel/hl-shared-types';
import type { IExchange } from '@syldel/trading-shared-types';
import { isStuckTriggeredOrder } from '../open-orders/stuck-triggered-order.util';
import { trailingStopView } from '../open-orders/trailing-stop-view.util';

/**
 * ============================================================================
 * CE QUI FERMERAIT CETTE POSITION : SON STOP-LOSS ET SON TAKE-PROFIT, LUS DANS LE CARNET
 *
 * La carte d'une position ne disait rien de sa protection : il fallait ouvrir Open Orders et
 * retrouver soi-même les ordres de la paire. Le bot calcule bien un verdict par paire
 * (`nest-trading-bot/src/hyperliquid/domain/protection-outcome.ts`), mais il ne le garde que dans
 * ses journaux et ses alertes : **aucune route ne l'expose** (relu le 2026-11-17). Et il ne
 * couvre que ses paires, pas une position ouverte à la main.
 *
 * La couverture se lit donc ici, dans `frontendOpenOrders`, pour **toute** position, en deux
 * mesures séparées : le **stop-loss** (ce qui la ferme si le prix part contre elle) et le
 * **take-profit** (ce qui la ferme s'il part pour elle). Le stop du bot est un `Stop Market`
 * ordinaire qu'il déplace à chaque passage : il est lu comme les autres. C'est la règle de
 * couverture du bot (`stop-coverage.ts`), recopiée — les deux dépôts ne partagent pas de code :
 *
 * - la couverture se compte en **taille cumulée**, en décimal exact : deux stops de moitié couvrent,
 *   un stop plus petit que la position laisse le reste exposé (`partial`) ;
 * - un ordre compte s'il est armé, reduce-only, du côté qui ferme, et par son nom **et** par le sens
 *   de son seuil : pour fermer un long, un stop est `Price below`, un take-profit `Price above` ; pour
 *   un short, l'inverse. Un désaccord entre les deux ne se devine pas : l'ordre ne compte pas, et
 *   ça se dit ;
 * - un ordre déclenché resté au carnet ne compte pas : la position est nue tant qu'il y repose
 *   (mesuré le 2026-10-18, 826 s). Son nom dit s'il était un stop ou un take-profit ;
 * - tout ce qui est d'une forme inconnue ne compte pas : se tromper dans ce sens fait voir une
 *   position moins couverte qu'elle ne l'est, jamais l'inverse.
 *
 * Deux écarts avec le bot, voulus :
 *
 * - **le trailing stop natif compte comme stop-loss**, mais seulement **en suivi** : son stop est
 *   alors le `triggerPx` de cette liste, celui que l'exchange applique (mesuré le 2026-11-17, S6).
 *   En attente d'activation il ne protège encore rien. Le bot, lui, ne le compte pas : ce n'est
 *   pas son ordre. Il ne compte jamais comme take-profit ;
 * - **un TP/SL de position** (`isPositionTpsl`, taille écrite `0.0`) compte pour **toute** la
 *   position : un stop de position a fermé en réel une position agrandie depuis sa pose
 *   (2026-10-26, `stop-coverage.ts`). Le bot ne le compte pas encore, parce que compter un ordre
 *   comme couverture est chez lui une décision de protection ; ici c'est une lecture, et la
 *   mesure la soutient. ⚠️ Une seule mesure, sur un stop ; le take-profit de position est lu de même.
 *
 * ⚠️ La position et les ordres sont deux lectures, à deux instants : un ordre posé ou rempli entre
 * les deux peut fausser la couverture jusqu'au prochain rafraîchissement.
 * ============================================================================
 */

export type CoverKind = 'SL' | 'TS' | 'TP' | 'Position SL' | 'Position TP';

export interface ProtectionCover {
  kind: CoverKind;
  /** Le prix qui déclenche, tel que l'exchange l'écrit. */
  px: string;
  oid: HLOid;
}

/** La couverture d'un côté : rien, une part, ou toute la position. */
export type Coverage =
  | { state: 'none' }
  | {
      state: 'partial';
      /** La part couverte, arrondie vers le bas : 99,9 % ne s'affiche jamais 100 %. */
      pct: number;
      /** L'ordre le plus proche du prix : celui qui partirait le premier. */
      nearest: ProtectionCover;
      covers: ProtectionCover[];
    }
  | { state: 'full'; nearest: ProtectionCover; covers: ProtectionCover[] };

/**
 * Ce qui explique la couverture, en quelques mots. ⚠️ Plus affichées depuis le 2026-11-18 (la bulle ⓘ a
 * été retirée de la carte, à la demande de l'utilisateur) : gardées pour la bulle qui pourra revenir, et
 * parce qu'un rond rouge sans sa raison reste au moins visible.
 * `alters` : la note change ce qu'il faut comprendre (un stop déclenché qui ne protège plus), et
 * pas seulement ce qu'on voit (un trailing qui attend).
 */
export interface ProtectionNote {
  text: string;
  alters: boolean;
}

/**
 * Qui a posé les ordres d'un rond, pour l'icône posée dessus (2026-11-18) :
 *
 * - `bot` : un SL ou un TP ordinaire sur une paire que le bot gère — il les tient tous
 *   (`botManagedPairs`), y compris un TP/SL de position ;
 * - `trailing` : le trailing stop natif, jamais au bot ;
 * - `manual` : un ordre ordinaire sur une paire que le bot ne gère pas.
 *
 * Quand deux sources couvrent le même côté, chacune a **son** rond et sa propre part : le stop du bot et un
 * trailing qui cohabitent se lisent l'un à côté de l'autre, au lieu d'une somme qui cacherait lequel
 * couvre quoi.
 */
export type CoverSource = 'bot' | 'manual' | 'trailing';

export interface SourceCoverage {
  source: CoverSource;
  coverage: Coverage;
}

export type PositionProtection =
  | { verdict: 'read'; sl: SourceCoverage[]; tp: SourceCoverage[]; notes: ProtectionNote[] }
  | { verdict: 'unknown'; reason: string };

/** Les sources dans l'ordre d'affichage : celui qui gère la paire d'abord, le trailing en dernier. */
const SOURCE_ORDER: CoverSource[] = ['bot', 'manual', 'trailing'];

type PositionFields = { coin: string; szi: string };

/**
 * @param orders les ordres ouverts du dex de la position, ou `null` si la liste n'a pas pu être lue —
 *   la couverture est alors `unknown`, jamais « aucune » ni « complète ».
 */
export function positionProtection(
  position: PositionFields,
  orders: readonly HLFrontendOpenOrder[] | null,
  /** La paire est au bot : ses SL et TP ordinaires sont les siens. */
  botManaged = false,
): PositionProtection {
  if (orders === null) {
    return { verdict: 'unknown', reason: 'Open orders unreadable' };
  }
  const size = unsignedDecimal(position.szi);
  if (size === null || isZero(size)) {
    return { verdict: 'unknown', reason: `Position size reads "${position.szi}"` };
  }
  const isLong = !NEGATIVE.test(position.szi);
  const closingSide = isLong ? 'A' : 'B';

  const tallies = new Map<string, Tally>();
  const tally = (role: 'SL' | 'TP', source: CoverSource): Tally => {
    const key = `${role}:${source}`;
    if (!tallies.has(key)) tallies.set(key, new Tally(role));
    return tallies.get(key)!;
  };
  const ordinary: CoverSource = botManaged ? 'bot' : 'manual';
  const notes: ProtectionNote[] = [];

  for (const order of orders) {
    if (order.coin !== position.coin) continue;
    if (order.reduceOnly !== true || order.side !== closingSide) continue;

    const role = roleOf(order.orderType);
    if (role === null) continue; // un ordre limite, un type inconnu : ni l'un ni l'autre ne ferme à un seuil

    if (isStuckTriggeredOrder(order)) {
      notes.push({ text: `${role} triggered, still resting`, alters: true });
      continue;
    }

    if (order.orderType === HL_ORDER_TYPE.trailingStopMarket) {
      const view = trailingStopView(order);
      if (view?.state === 'tracking') {
        tally('SL', 'trailing').add(
          { kind: 'TS', px: view.stopPx, oid: order.oid },
          order.sz,
          notes,
        );
      } else if (view?.state === 'waiting') {
        const sign = view.activation.direction === 'above' ? '>' : '<';
        notes.push({ text: `Trailing waits ${sign} ${view.activation.px}`, alters: false });
      } else {
        notes.push({ text: 'Trailing state unreadable', alters: false });
      }
      continue;
    }

    if (order.isTrigger !== true) continue;

    // Fermer un long : stop sous le prix, take-profit au-dessus ; un short, l'inverse.
    const below = (role === 'SL') === isLong;
    const expected = below ? 'Price below ' : 'Price above ';
    if (!order.triggerCondition.startsWith(expected)) {
      notes.push({ text: `${role} "${order.triggerCondition}" not counted`, alters: false });
      continue;
    }

    const target = tally(role, ordinary);
    if (order.isPositionTpsl) {
      target.addWhole({ kind: `Position ${role}`, px: order.triggerPx, oid: order.oid });
    } else {
      target.add({ kind: role, px: order.triggerPx, oid: order.oid }, order.sz, notes);
    }
  }

  /**
   * Un rond par source qui a au moins un ordre compté. Aucune : un seul rond vide, à la source qui
   * aurait dû le poser — sur une paire du bot, le robot sur un SL vide dit que **le bot** ne la
   * protège pas.
   */
  const side = (role: 'SL' | 'TP', nearestIs: 'highest' | 'lowest'): SourceCoverage[] => {
    const found = SOURCE_ORDER.flatMap((source) => {
      const t = tallies.get(`${role}:${source}`);
      const coverage = t?.coverage(size, nearestIs);
      return coverage && coverage.state !== 'none' ? [{ source, coverage }] : [];
    });
    return found.length > 0 ? found : [{ source: ordinary, coverage: { state: 'none' } }];
  };

  return {
    verdict: 'read',
    // Le stop le plus proche est le plus haut pour un long ; le take-profit le plus proche, le plus bas.
    sl: side('SL', isLong ? 'highest' : 'lowest'),
    tp: side('TP', isLong ? 'lowest' : 'highest'),
    notes,
  };
}

/** Comparés à l'exact : un libellé voisin n'est pas un stop (voir `HL_ORDER_TYPE`). */
function roleOf(orderType: string): 'SL' | 'TP' | null {
  switch (orderType) {
    case HL_ORDER_TYPE.stopMarket:
    case HL_ORDER_TYPE.stopLimit:
    case HL_ORDER_TYPE.trailingStopMarket:
      return 'SL';
    case HL_ORDER_TYPE.takeProfitMarket:
    case HL_ORDER_TYPE.takeProfitLimit:
      return 'TP';
    default:
      return null;
  }
}

class Tally {
  private readonly covers: ProtectionCover[] = [];
  private covered = '0';
  private whole = false;

  constructor(private readonly label: 'SL' | 'TP') {}

  /** Un ordre d'une taille lisible et positive ; sinon il ne compte pas, et ça se dit. */
  add(cover: ProtectionCover, sz: string, notes: ProtectionNote[]): void {
    const value = unsignedDecimal(sz);
    if (value === null || NEGATIVE.test(sz) || isZero(value)) {
      notes.push({ text: `${this.label} size "${sz}" not counted`, alters: false });
      return;
    }
    this.covers.push(cover);
    this.covered = addUnits(this.covered, value);
  }

  /** Un TP/SL de position : toute la position, lue au déclenchement. */
  addWhole(cover: ProtectionCover): void {
    this.covers.push(cover);
    this.whole = true;
  }

  coverage(size: string, nearestIs: 'highest' | 'lowest'): Coverage {
    if (this.covers.length === 0) return { state: 'none' };
    const nearest = this.covers.reduce((best, cover) => {
      const closer =
        nearestIs === 'highest'
          ? Number(cover.px) > Number(best.px)
          : Number(cover.px) < Number(best.px);
      return closer ? cover : best;
    });
    if (this.whole || compareUnits(this.covered, size) >= 0) {
      return { state: 'full', nearest, covers: this.covers };
    }
    const pct = Math.floor((Number(this.covered) / Number(size)) * 100);
    return { state: 'partial', pct, nearest, covers: this.covers };
  }
}

/**
 * ============================================================================
 * LES PAIRES QUE LE BOT GÈRE
 *
 * Les ordres du bot ne portent aucun `cloid` (relu le 2026-11-17) : sur l'exchange, rien ne les
 * distingue d'un ordre posé à la main. Mais sur une paire qu'il gère, le bot prend **tous** les
 * stops et take-profits de la paire pour les siens (`pair-orders.ts`, `classifyPairOrders`) : il les
 * déplace, et annule ceux de trop. Dire « cette paire est au bot » dit donc qui tient ses SL/TP —
 * sauf le trailing natif, qu'il laisse dans `unmanaged`.
 *
 * La règle est celle du moteur (`hl-trading-engine.service.ts`, `startProcessus`, et
 * `app.controller.ts`) : l'exchange `hyperliquid` **et** la paire à `enabled === true`, strictement.
 * ⚠️ Elle dit ce que la configuration demande, pas que le bot tourne : un bot arrêté, ou en mode
 * développement (qui s'arrête avant tout appel à l'exchange), ne tient rien.
 * ============================================================================
 */
export function botManagedPairs(
  tradingSettings: Record<string, IExchange> | undefined,
): Set<string> {
  const hyperliquid = tradingSettings?.['hyperliquid'];
  if (hyperliquid?.enabled !== true) return new Set();
  return new Set(hyperliquid.pairs.filter((p) => p.enabled === true).map((p) => p.name));
}

// --- Décimaux exacts, sans flottant : une somme de tailles se compare à la position au dernier chiffre.

const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;
/** Le signe d'une taille (le `szi` d'un short) : pas une règle de nommage de marché. */
const NEGATIVE = /^\s*-/;

function unsignedDecimal(value: string): string | null {
  const v = value.trim().replace(/^-/, '');
  return PLAIN_DECIMAL.test(v) ? v : null;
}

function isZero(value: string): boolean {
  return /^0(?:\.0+)?$/.test(value);
}

function addUnits(total: string, value: string): string {
  const decimals = Math.max(decimalsOf(total), decimalsOf(value));
  return fromUnits(toUnits(total, decimals) + toUnits(value, decimals), decimals);
}

function compareUnits(a: string, b: string): number {
  const decimals = Math.max(decimalsOf(a), decimalsOf(b));
  const diff = toUnits(a, decimals) - toUnits(b, decimals);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}

function decimalsOf(value: string): number {
  return value.split('.')[1]?.length ?? 0;
}

function toUnits(value: string, decimals: number): bigint {
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer + fraction.padEnd(decimals, '0'));
}

function fromUnits(units: bigint, decimals: number): string {
  if (decimals === 0) return units.toString();
  const digits = units.toString().padStart(decimals + 1, '0');
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
