import type { StrategyRules } from '@syldel/trading-shared-types';
import {
  STRATEGY_DOCUMENT_SCHEMA_VERSION,
  type StrategyDocument,
} from '../models/strategy-document.model';

/**
 * ============================================================================
 * 📤 STRATEGY TRANSFER
 * Sortir une stratégie du téléphone et en faire rentrer une, par le
 * presse-papier.
 *
 * La bibliothèque vit en stockage local et ne survit pas à une réinstallation
 * (voir `docs/roadmap.md`). Mais la sauvegarde n'est pas le vrai gain : le
 * chemin visé est **une IA qui écrit du JSON, qu'on colle ici, qu'on backteste
 * dans `watchlist-detail`, puis qu'on confie au bot**. C'est aujourd'hui le
 * trajet le plus court entre une idée de stratégie et son évaluation.
 *
 * D'où le presse-papier plutôt qu'un fichier : il marche à l'identique en web
 * et dans une WebView, sans greffon Capacitor — et il n'y en a aucun ici
 * (`@capacitor/filesystem` et `@capacitor/share` sont absents, et aucun dossier
 * `android/` n'existe encore). Coller ce qu'une IA vient de produire est aussi
 * plus direct que l'enregistrer puis le repêcher dans un sélecteur.
 *
 * **Strict en écriture, tolérant en lecture**, et chaque tolérance est une
 * décision écrite plutôt qu'un hasard :
 *
 * - on **écrit** toujours l'enveloppe complète, qui porte son format et sa
 *   version : un tableau nu ne dit pas qui l'a produit ni sous quelle forme,
 *   et « savoir quelle version a écrit ce document » est une exigence du dépôt ;
 * - on **lit** l'enveloppe, un tableau nu, ou un document seul — parce qu'une
 *   IA à qui on demande « une stratégie » rend naturellement un objet, et que
 *   refuser cette forme-là ne protégerait de rien : elle est sans ambiguïté.
 *
 * Ce que ce fichier ne fait **pas** : juger les règles. La forme d'un arbre de
 * règles est validée par le bot (`POST /exchanges/strategies/validate`), jamais
 * ici — le verdict du serveur fait autorité, et un mobile en retard n'a pas à
 * refuser un nœud qu'un bot plus récent sait exécuter.
 * ============================================================================
 */

export const STRATEGY_TRANSFER_FORMAT = 'hyperliquid-mobile/strategy-library';
export const STRATEGY_TRANSFER_VERSION = 1;

/** L'enveloppe écrite à l'export. */
export interface StrategyTransfer {
  format: typeof STRATEGY_TRANSFER_FORMAT;
  version: number;
  exportedAt: number;
  strategies: StrategyDocument[];
}

export interface TransferParseResult {
  /** Les documents exploitables, dans l'ordre du texte collé. */
  documents: StrategyDocument[];
  /**
   * Ce qui a été refusé, nommé. Jamais agrégé en « some entries were invalid » :
   * un import qui laisse tomber une stratégie sans dire laquelle est la
   * défaillance muette que ce dépôt met en premier.
   */
  problems: string[];
}

/** Ce qu'il est advenu d'un document entrant. */
export type ImportOutcome =
  /** Son `id` était libre : il entre tel quel. */
  | 'added'
  /** Même `id`, même contenu : il est déjà là, rien n'est dupliqué. */
  | 'already-present'
  /** Même `id`, contenu différent : il entre sous un nouvel `id`, sans rien écraser. */
  | 'copied';

export interface ImportDecision {
  document: StrategyDocument;
  outcome: ImportOutcome;
  /** Le nom tel qu'il était avant un éventuel suffixe, pour pouvoir le dire. */
  originalName: string;
}

/**
 * Le texte à mettre dans le presse-papier.
 *
 * Indenté : ce JSON est fait pour être lu et recollé par un humain ou une IA,
 * pas transporté sur un réseau.
 */
export function exportStrategies(
  documents: readonly StrategyDocument[],
  now: number = Date.now(),
): string {
  const transfer: StrategyTransfer = {
    format: STRATEGY_TRANSFER_FORMAT,
    version: STRATEGY_TRANSFER_VERSION,
    exportedAt: now,
    strategies: [...documents],
  };

  return JSON.stringify(transfer, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Les trois formes acceptées, ramenées à une liste d'entrées brutes. */
function entriesOf(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;

  const record = asRecord(parsed);
  if (!record) return null;

  if (Array.isArray(record['strategies'])) return record['strategies'];

  // Un document seul : accepté parce qu'il est sans ambiguïté, et parce que
  // c'est ce qu'une IA rend quand on lui demande « une stratégie ».
  return [record];
}

/**
 * Lit un texte collé.
 *
 * `rules` et `name` sont **exigés** : sans règles il n'y a pas de stratégie, et
 * une stratégie sans nom est introuvable dans une liste. Le reste est complété,
 * et les valeurs retenues sont celles qui ne changent le sens de rien — un `id`
 * absent en fait un document neuf, des dates absentes valent maintenant.
 */
export function parseStrategyTransfer(
  text: string,
  newId: () => string,
  now: number = Date.now(),
): TransferParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { documents: [], problems: ['The clipboard does not contain valid JSON.'] };
  }

  const entries = entriesOf(parsed);
  if (entries === null) {
    return { documents: [], problems: ['No strategy found in what was pasted.'] };
  }

  const documents: StrategyDocument[] = [];
  const problems: string[] = [];

  entries.forEach((entry, index) => {
    const record = asRecord(entry);
    const position = `Entry ${index + 1}`;

    if (!record) {
      problems.push(`${position} is not an object.`);
      return;
    }

    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    if (!name) {
      problems.push(`${position} has no name.`);
      return;
    }

    if (!asRecord(record['rules'])) {
      problems.push(`${position} ("${name}") carries no rules.`);
      return;
    }

    const id = typeof record['id'] === 'string' && record['id'] ? record['id'] : newId();
    const createdAt = typeof record['createdAt'] === 'number' ? record['createdAt'] : now;
    const schemaVersion =
      typeof record['schemaVersion'] === 'number'
        ? record['schemaVersion']
        : STRATEGY_DOCUMENT_SCHEMA_VERSION;

    documents.push({
      id,
      name,
      ...(typeof record['description'] === 'string' ? { description: record['description'] } : {}),
      rules: record['rules'] as StrategyRules,
      createdAt,
      updatedAt: typeof record['updatedAt'] === 'number' ? record['updatedAt'] : now,
      schemaVersion,
    });
  });

  return { documents, problems };
}

/**
 * Ce que deviendrait chaque document entrant, sans rien écrire.
 *
 * ⚠️ **Jamais d'écrasement, et jamais d'abandon silencieux.** `importMissing`
 * saute un `id` déjà connu sans un mot : c'est juste pour une reprise de
 * données, où l'on ne veut pas remplacer ce que l'utilisateur a édité. Sur un
 * texte **étranger**, coller trois stratégies et n'en voir apparaître que deux
 * sans explication serait exactement le défaut que ce dépôt refuse. Un `id`
 * déjà pris donne donc soit « déjà là » quand le contenu est le même, soit une
 * copie sous un nouvel `id` — et l'appelant le dit.
 */
export function planImport(
  incoming: readonly StrategyDocument[],
  existing: readonly StrategyDocument[],
  newId: () => string,
  now: number = Date.now(),
): ImportDecision[] {
  const byId = new Map(existing.map((document) => [document.id, document]));
  const decisions: ImportDecision[] = [];

  for (const document of incoming) {
    const clash = byId.get(document.id);

    if (!clash) {
      decisions.push({ document, outcome: 'added', originalName: document.name });
      byId.set(document.id, document);
      continue;
    }

    // Comparé sur ce qui fait la stratégie, et non sur les dates : réexporter
    // puis recoller le même document ne doit pas le dupliquer parce qu'une
    // horloge a tourné.
    const identical =
      clash.name === document.name &&
      JSON.stringify(clash.rules) === JSON.stringify(document.rules);

    if (identical) {
      decisions.push({ document: clash, outcome: 'already-present', originalName: document.name });
      continue;
    }

    const copy: StrategyDocument = {
      ...document,
      id: newId(),
      name: `${document.name} (imported)`,
      createdAt: now,
      updatedAt: now,
    };
    decisions.push({ document: copy, outcome: 'copied', originalName: document.name });
    byId.set(copy.id, copy);
  }

  return decisions;
}

/** Les documents qu'il faut réellement écrire — « déjà là » n'en est pas un. */
export function documentsToWrite(decisions: readonly ImportDecision[]): StrategyDocument[] {
  return decisions
    .filter((decision) => decision.outcome !== 'already-present')
    .map((decision) => decision.document);
}
