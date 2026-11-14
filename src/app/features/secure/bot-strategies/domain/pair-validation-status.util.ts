import type {
  PublicStrategyValidationIssue,
  StrategyValidationResult,
} from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 🛑 LA STRATÉGIE D'UNE PAIRE, TELLE QUE LE BOT LA JUGE
 *
 * Le moteur du bot écarte du trading toute paire dont la stratégie porte une
 * anomalie (`collectPairIssues`, « Strategy rejected, no signal will be
 * generated »). La liste des paires ne signalait qu'une stratégie **inconnue**
 * du catalogue (`pairStrategyStatus`) : une stratégie que le bot propose
 * toujours, mais dont le contenu est refusé — des protections à l'ancien format
 * (`atrMultiplier`, sans ancre ni distance), une règle mal formée —, s'y
 * affichait comme une paire saine : rien ne l'accusait, puisque le catalogue la
 * sert. Le 2026-11-14, contre le vrai bot, « Oracle Flow Reversion » portant
 * les protections à l'ancien format de `rabby_01` (en mémoire dans la page,
 * rien d'enregistré) a reçu le bandeau avec ce correctif. L'absence de bandeau
 * sans lui se déduit du code, elle n'a pas été affichée.
 *
 * ⚠️ Le cas qui a fait poser la question n'était pas celui-là : une paire SOL
 * activée de `trader_zero`, sans bandeau, l'était parce que **le bot était
 * arrêté** — sa stratégie, retirée du catalogue, est signalée dès qu'il répond.
 * Bot arrêté, cette vérification-ci se tait aussi (voir plus bas).
 *
 * Le verdict vient du bot (`POST /exchanges/strategies/validate`, la même
 * fonction que son moteur), jamais d'une validation locale : celle-ci s'appuie
 * sur une copie compilée des catalogues, qu'un bot plus récent peut avoir
 * dépassée — elle accuserait une paire que le bot accepte (ecosystem.md).
 *
 * Trois issues, et la troisième compte autant que les deux autres : un bot
 * injoignable, ou une réponse qui n'a pas la forme attendue, ne dit **rien**
 * de la paire. On ne la signale pas sur une absence de réponse, comme
 * `pairStrategyStatus` ne le fait pas sur un catalogue absent.
 * ============================================================================
 */
export type PairValidationStatus =
  /** Le bot accepte la stratégie telle qu'elle est enregistrée. */
  | { kind: 'accepted' }
  /** Le bot la refuse : il n'exécutera pas la paire. `issues` peut être vide si le bot n'a rien dit de plus. */
  | { kind: 'refused'; issues: readonly PublicStrategyValidationIssue[] }
  /** Pas de verdict : bot injoignable, pas encore répondu, ou réponse illisible. */
  | { kind: 'unverified' };

/**
 * @param reply La réponse de `POST /exchanges/strategies/validate`, ou `null`
 * quand il n'y en a pas (pas encore chargée, ou appel en échec).
 */
export function pairValidationStatus(reply: unknown): PairValidationStatus {
  const result = reply as Partial<StrategyValidationResult> | null | undefined;
  // `valid` fait foi, pas la longueur de `issues` : c'est le champ que le bot pose, et un booléen qui manque n'est pas
  // un « oui ».
  if (result?.valid === true) return { kind: 'accepted' };
  if (result?.valid === false) {
    return { kind: 'refused', issues: Array.isArray(result.issues) ? result.issues : [] };
  }
  return { kind: 'unverified' };
}

/**
 * La phrase à afficher sous la paire : la première anomalie, et combien d'autres.
 *
 * Le message du bot est rendu tel quel : c'est lui qui dit quoi corriger (« Translate it explicitly: atrMultiplier 1.5
 * becomes distance { unit: "ATR", value: 1.5 } »), et le reformuler ici le ferait diverger du journal du bot.
 */
export function refusalSummary(issues: readonly PublicStrategyValidationIssue[]): string {
  const first = issues[0]?.message?.trim();
  if (!first) return 'The bot refuses it without saying why.';
  const others = issues.length - 1;
  return others > 0 ? `${first} (and ${others} more issue${others > 1 ? 's' : ''})` : first;
}

/**
 * `true` si au moins une anomalie porte sur les protections : la correction se fait alors dans la modale des
 * protections, pas dans celle de la paire. Lu sur le chemin que rend le bot (`….protective.entries[0].anchor`).
 */
export function refusalConcernsProtections(
  issues: readonly PublicStrategyValidationIssue[],
): boolean {
  return issues.some((issue) => /(^|\.)protective(\.|\[|$)/.test(issue.path ?? ''));
}
