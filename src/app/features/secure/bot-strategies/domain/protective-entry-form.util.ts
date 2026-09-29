import type {
  DistanceUnit,
  FollowMode,
  PriceAnchor,
  ProtectiveOrderEntry,
  ProtectiveOrderStrategy,
  TpslType,
} from '@syldel/trading-shared-types';
import { DEFAULT_FOLLOW_MODE } from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 🛡️ CE QUE LA MODALE ÉDITE, ET CE QU'ELLE N'A PAS LE DROIT DE PERDRE
 *
 * La modale Protective n'affiche que trois champs. Elle en reconstruisait
 * autant à l'enregistrement, et tout le reste de l'entrée disparaissait : il
 * suffisait d'ouvrir puis de cliquer Save. Ce que ça effaçait, vérifié contre
 * ce que le bot lit vraiment :
 *
 * - `condition` — le bot l'évalue avant de poser la protection
 *   (`hl-protection.service.ts`) : une protection conditionnelle devenait
 *   inconditionnelle ;
 * - `protective.enabled` — le bot le lit (`!== false`) : un bloc désactivé se
 *   réactivait tout seul ;
 * - `anchor`, `followMode`, `boundedByEntry` — tout réglage écrit à la main
 *   revenait au défaut.
 *
 * Le type ne protégeait rien parce qu'un `as ProtectiveOrderEntry[]` affirmait
 * au compilateur ce que l'objet n'avait pas : `anchor` y est **obligatoire**, et
 * le formulaire ne l'écrivait jamais.
 *
 * D'où la séparation portée ici : ce qui s'édite d'un côté, ce qui se
 * **transporte** de l'autre. Le transporté voyage dans la ligne du formulaire,
 * et non dans un tableau parallèle : ajouter ou retirer une entrée déplace les
 * deux ensemble, sans indice à resynchroniser.
 * ============================================================================
 */

/**
 * Tout ce qu'une entrée porte en plus des trois champs affichés. Dérivé de
 * `ProtectiveOrderEntry` par `Omit` et non recopié : un champ ajouté aux types
 * partagés est transporté sans que personne n'ait à y penser ici.
 */
export type CarriedProtectiveFields = Omit<
  ProtectiveOrderEntry,
  'tpsl' | 'distance' | 'sizePercent' | 'anchor' | 'followMode' | 'boundedByEntry'
>;

/** Une ligne du formulaire : trois champs éditables, et le reste en soute. */
export interface ProtectiveEntryFormValue {
  tpsl: TpslType;
  /**
   * L'unité de la distance. Servie par `/exchanges/meta` (`distanceUnits`), et
   * non déduite du paquet compilé : un mobile en retard ne doit pas proposer
   * une unité que le bot ne sait pas calculer.
   */
  distanceUnit: DistanceUnit;
  /**
   * `number | string` parce qu'un `ion-input type="number"` rend une **chaîne**
   * dès que l'utilisateur saisit, alors que la valeur initiale est un nombre.
   * Le type dit la vérité plutôt que de la masquer ; `toProtectiveEntry`
   * convertit au moment d'écrire.
   */
  distanceValue: number | string;
  sizePercent: number | string;
  /** Où le prix se calcule. Éditée par `AnchorEditorModalComponent`. */
  anchor: PriceAnchor;
  followMode: FollowMode;
  boundedByEntry: boolean;
  carried: CarriedProtectiveFields;
}

/**
 * L'ancre que le bot applique quand la configuration n'en déclare aucune —
 * `entry.anchor?.source || 'ENTRY'` dans `resolveAnchorPrice`.
 *
 * L'écrire explicitement ne change donc aucun prix : ça dit ce qui se passait
 * déjà, et ça honore un type où `anchor` est obligatoire. Même raison que dans
 * l'éditeur d'opérande, qui écrit les paramètres d'un indicateur même laissés à
 * leur valeur par défaut : une configuration doit continuer à produire le même
 * prix si les défauts du bot changent.
 */
export const IMPLICIT_ANCHOR: PriceAnchor = { source: 'ENTRY' };

/** Ce que le formulaire propose par défaut : l'unité qui existait seule. */
export const DEFAULT_DISTANCE_UNIT: DistanceUnit = 'ATR';
export const DEFAULT_ATR_MULTIPLIER = 1.5;
export const DEFAULT_SIZE_PERCENT = 100;
export const DEFAULT_TPSL: TpslType = 'tp';

/**
 * Les champs **retirés** : écrits par un build précédent, lus par personne, et
 * supprimés à la prochaine écriture.
 *
 * Ils sont nommés un par un, et surtout **pas** déduits d'une liste de champs
 * connus. C'est toute la différence avec le défaut que ce fichier répare : un
 * champ inconnu voyage, parce qu'il vient peut-être d'un build plus récent ;
 * un champ retiré est une décision datée, prise en sachant ce qu'on jette.
 *
 * - `label` (2026-09-26) — chaîne vide sur les quatre protections du compte de
 *   développement. Absent de `ProtectiveOrderEntry`, et cherché sans succès
 *   dans les cinq dépôts ainsi que dans `nest-mongo-user`, qui stocke
 *   `tradingSettings` en `Record<string, any>` sans schéma par champ. Aucun
 *   lecteur, nulle part. ⚠️ Son origine reste inconnue, et rien n'a cherché
 *   d'autres vestiges ailleurs que sur les entrées protectrices.
 */
const RETIRED_ENTRY_FIELDS: readonly string[] = ['label'];

/**
 * Le seul cast du fichier, et il porte sur un **sous-ensemble du même objet** :
 * `Object.fromEntries` perd le type de ce qu'on lui redonne. Rien à voir avec
 * l'assertion d'origine, qui affirmait une forme que l'objet n'avait pas.
 */
function withoutRetiredFields<T extends object>(value: T): T {
  const kept = Object.entries(value).filter(([key]) => !RETIRED_ENTRY_FIELDS.includes(key));
  return Object.fromEntries(kept) as T;
}

/** Éclate une entrée stockée en une ligne de formulaire. */
export function toProtectiveEntryForm(
  entry?: Partial<ProtectiveOrderEntry>,
): ProtectiveEntryFormValue {
  const { tpsl, distance, sizePercent, anchor, followMode, boundedByEntry, ...rest } = entry ?? {};

  return {
    tpsl: tpsl ?? DEFAULT_TPSL,
    distanceUnit: distance?.unit ?? DEFAULT_DISTANCE_UNIT,
    distanceValue: distance?.value ?? DEFAULT_ATR_MULTIPLIER,
    sizePercent: sizePercent ?? DEFAULT_SIZE_PERCENT,
    anchor: anchor ?? IMPLICIT_ANCHOR,
    followMode: followMode ?? DEFAULT_FOLLOW_MODE,
    boundedByEntry: boundedByEntry === true,
    carried: withoutRetiredFields({ ...rest }),
  };
}

/**
 * Reconstruit une entrée complète. Aucune assertion de type : le compilateur
 * vérifie que rien d'obligatoire ne manque, ce qui est précisément ce que le
 * `as` d'avant lui interdisait de faire.
 */
export function toProtectiveEntry(value: ProtectiveEntryFormValue): ProtectiveOrderEntry {
  // Écrits explicitement, même à leur valeur par défaut : une configuration
  // doit continuer à produire le même prix si les défauts du bot changent.
  // Même règle que les paramètres d'indicateur de l'éditeur d'opérande.
  return {
    ...value.carried,
    tpsl: value.tpsl,
    anchor: value.anchor,
    distance: {
      unit: value.distanceUnit,
      value: Number(value.distanceValue),
    },
    sizePercent: Number(value.sizePercent),
    followMode: value.followMode,
    boundedByEntry: value.boundedByEntry,
  };
}

/**
 * Reconstruit le bloc protecteur entier.
 *
 * `previous` est étalé d'abord pour que `enabled` survive : c'est un réglage du
 * bloc, pas d'une entrée, et la modale ne l'affiche pas non plus.
 */
export function toProtectiveStrategy(
  values: readonly ProtectiveEntryFormValue[],
  previous?: ProtectiveOrderStrategy,
): ProtectiveOrderStrategy {
  return { ...previous, entries: values.map(toProtectiveEntry) };
}
