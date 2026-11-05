import type { ExternalUserAgent } from '@syldel/trading-shared-types';

/**
 * L'état de l'agent (API wallet Hyperliquid) qui signe les ordres, tel qu'on
 * l'affiche : sur la page Profile, dans le pied du menu, et en ligne
 * d'avertissement dans les vues qui signent (ordre, Bot Strategies).
 *
 * Les seuils ont été choisis par l'utilisateur le 2026-11-05 : orange à
 * 14 jours, rouge à 3 jours. Un agent expiré ou **inconnu** est rouge : le
 * gateway refuse alors de signer (`agentRefusal`), et rien ne doit le laisser
 * découvrir au moment d'un ordre.
 *
 * L'expiration est celle **déclarée** dans `set-agent-key` (recopiée de la page
 * API de Hyperliquid), pas lue chez Hyperliquid.
 */

export const AGENT_WARNING_DAYS = 14;
export const AGENT_DANGER_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type AgentExpiryLevel = 'ok' | 'warning' | 'danger';

export type AgentExpiryStatus =
  /** Pas encore lu (connexion en cours) : rien à afficher, rien à affirmer. */
  | { kind: 'loading' }
  /** `/auth/me` n'a pas répondu : on ne sait pas, et on le dit. */
  | { kind: 'unavailable'; level: 'warning' }
  /** Aucune donnée d'agent en base : le gateway refuse de signer. */
  | { kind: 'missing'; level: 'danger' }
  | { kind: 'expired'; level: 'danger'; agent: ExternalUserAgent; validUntil: Date }
  | {
      kind: 'valid';
      level: AgentExpiryLevel;
      agent: ExternalUserAgent;
      validUntil: Date;
      /** Durée restante, déjà écrite : `42 d`, `5 h`, `< 1 h`. */
      remaining: string;
    };

/**
 * Ce que vaut l'agent à l'instant `now`.
 *
 * - `agent` `undefined` : pas encore lu ; `null` : lu, et absent ;
 * - une `validUntil` illisible est traitée comme une donnée absente, jamais
 *   comme « pas d'expiration ».
 */
export function agentExpiryStatus(
  agent: ExternalUserAgent | null | undefined,
  failed: boolean,
  now: number,
): AgentExpiryStatus {
  if (failed) return { kind: 'unavailable', level: 'warning' };
  if (agent === undefined) return { kind: 'loading' };
  if (agent === null) return { kind: 'missing', level: 'danger' };

  const validUntil = new Date(agent.validUntil);
  if (Number.isNaN(validUntil.getTime())) return { kind: 'missing', level: 'danger' };

  const left = validUntil.getTime() - now;
  if (left <= 0) return { kind: 'expired', level: 'danger', agent, validUntil };

  const level: AgentExpiryLevel =
    left <= AGENT_DANGER_DAYS * DAY_MS
      ? 'danger'
      : left <= AGENT_WARNING_DAYS * DAY_MS
        ? 'warning'
        : 'ok';
  return { kind: 'valid', level, agent, validUntil, remaining: formatRemaining(left) };
}

/**
 * Jours entiers **révolus** (arrondi vers le bas : « 3 d » ne veut jamais dire
 * 2 j 20 h), puis heures sous un jour.
 */
export function formatRemaining(ms: number): string {
  if (ms >= DAY_MS) return `${Math.floor(ms / DAY_MS)} d`;
  if (ms >= HOUR_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  return '< 1 h';
}

/**
 * La date comme la page API de Hyperliquid l'écrit (`04/05/2027 13:00:28`,
 * heure locale), pour qu'une comparaison avec elle se fasse d'un coup d'œil.
 * Le fuseau est celui de l'appareil, comme celui du navigateur pour la page.
 */
export function formatLikeDashboard(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Une ligne courte, pour le pied du menu et la ligne d'avertissement. */
export function agentExpirySummary(status: AgentExpiryStatus): string | null {
  switch (status.kind) {
    case 'loading':
      return null;
    case 'unavailable':
      return 'Agent wallet status unavailable';
    case 'missing':
      return 'No agent wallet expiry: run set-agent-key';
    case 'expired':
      return 'Agent wallet expired: orders cannot be signed';
    case 'valid':
      return `Agent wallet expires in ${status.remaining}`;
  }
}
