import type {
  DistanceUnit,
  FollowMode,
  PriceAnchor,
  PriceDistance,
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
 * - `atrMultiplier` (2026-10-14) — **traduit avant d'être jeté**, et c'est la
 *   seule entrée de cette liste dans ce cas : `migratedAtrMultiplier` en tire
 *   la distance, et il ne part qu'une fois sa valeur recueillie. Les types
 *   partagés refusent le champ nommément (`RETIRED_ATR_MULTIPLIER`) en donnant
 *   la traduction exacte, et le bot ne le lit plus nulle part.
 */
const RETIRED_ENTRY_FIELDS: readonly string[] = ['label', 'atrMultiplier'];

/**
 * Une entrée **telle qu'elle dort en base**, par opposition au type que le
 * paquet partagé décrit aujourd'hui : elle peut porter `atrMultiplier` et
 * aucun `distance`, alors que `ProtectiveOrderEntry` déclare `distance`
 * obligatoire. Le type décrivait ce que ce mobile **écrit**, pas ce qui a été
 * écrit avant lui — même divergence que `StoredPairStrategy`, et c'est elle
 * qui avait laissé le cas sans traitement : rien à la compilation ne suggérait
 * qu'il existait.
 */
export type StoredProtectiveEntry = Partial<ProtectiveOrderEntry> & {
  /** Le champ retiré. Voir `RETIRED_ENTRY_FIELDS` et `migratedAtrMultiplier`. */
  atrMultiplier?: number;
};

/**
 * La distance d'une entrée écrite avant le renommage, ou `null` quand il n'y a
 * rien à traduire.
 *
 * ⚠️ **Pourquoi traduire plutôt que refuser.** La règle du dépôt est qu'un
 * champ abandonné « se refuse bruyamment, il ne se lit pas au cas où » — et
 * elle vise la lecture *silencieuse*, celle qui ferait vivre l'ancien format
 * indéfiniment. Les deux autres branches que le CLAUDE.md autorise ont été
 * pesées : refuser d'ouvrir la modale laisserait l'utilisateur sans aucun
 * chemin pour réparer depuis l'app, et remplir avec le défaut (ce que faisait
 * `?? DEFAULT_ATR_MULTIPLIER`) écrasait silencieusement ses valeurs — mesuré
 * le 2026-10-14, les quatre protections du compte portent 1.5 · 2 · 1.5 · 1 et
 * le formulaire affichait 1.5 quatre fois.
 *
 * Reste la migration explicite : la valeur est lue, la modale **annonce** d'où
 * elle vient, et l'ancien champ disparaît à l'enregistrement. La traduction
 * n'est pas devinée, elle est celle que les types partagés dictent dans leur
 * propre message de refus (`atrMultiplier 1.5` ⇒ `{ unit: 'ATR', value: 1.5 }`).
 *
 * `distance` l'emporte toujours : une entrée qui porte les deux a déjà été
 * réécrite par un build récent, et c'est le champ courant qui fait foi.
 */
export function migratedAtrMultiplier(entry?: StoredProtectiveEntry): PriceDistance | null {
  if (entry?.distance) return null;

  const legacy = entry?.atrMultiplier;
  if (typeof legacy !== 'number' || !Number.isFinite(legacy)) return null;

  return { unit: 'ATR', value: legacy };
}

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
export function toProtectiveEntryForm(entry?: StoredProtectiveEntry): ProtectiveEntryFormValue {
  const { tpsl, distance, sizePercent, anchor, followMode, boundedByEntry, ...rest } = entry ?? {};

  // La distance courante, ou celle de l'ancien champ traduite. Les défauts ne
  // servent plus qu'à une entrée **neuve** : s'en servir pour une entrée
  // existante écrasait des valeurs que l'utilisateur avait réglées.
  const effective = distance ?? migratedAtrMultiplier(entry);

  return {
    tpsl: tpsl ?? DEFAULT_TPSL,
    distanceUnit: effective?.unit ?? DEFAULT_DISTANCE_UNIT,
    distanceValue: effective?.value ?? DEFAULT_ATR_MULTIPLIER,
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
