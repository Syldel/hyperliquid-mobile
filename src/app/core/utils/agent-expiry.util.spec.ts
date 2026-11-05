import type { ExternalUserAgent } from '@syldel/trading-shared-types';
import {
  agentExpiryStatus,
  agentExpirySummary,
  formatLikeDashboard,
  formatRemaining,
} from './agent-expiry.util';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const VALID_UNTIL = '2027-05-04T11:00:28.000Z';
const agent: ExternalUserAgent = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  name: 'bot_main',
  validUntil: VALID_UNTIL,
  keyUpdatedAt: '2026-11-05T11:05:00.000Z',
};
const expiry = Date.parse(VALID_UNTIL);
const at = (msBefore: number) => expiry - msBefore;

describe('agentExpiryStatus', () => {
  it('says nothing while the agent has not been read yet', () => {
    expect(agentExpiryStatus(undefined, false, at(DAY))).toEqual({ kind: 'loading' });
  });

  // Ne pas savoir n'est pas « tout va bien » : ça se dit, en orange.
  it('reports a failed read as unavailable, in warning', () => {
    expect(agentExpiryStatus(agent, true, at(100 * DAY))).toEqual({
      kind: 'unavailable',
      level: 'warning',
    });
  });

  // Sans expiration déclarée, le gateway refuse de signer.
  it('reports a user without agent data as missing, in danger', () => {
    expect(agentExpiryStatus(null, false, at(DAY))).toEqual({ kind: 'missing', level: 'danger' });
  });

  it('never reads an unreadable date as no expiry', () => {
    expect(agentExpiryStatus({ ...agent, validUntil: 'soon' }, false, at(DAY))).toEqual({
      kind: 'missing',
      level: 'danger',
    });
  });

  it.each([
    ['more than 14 days left', 14 * DAY + 1, 'ok'],
    ['exactly 14 days left', 14 * DAY, 'warning'],
    ['more than 3 days left', 3 * DAY + 1, 'warning'],
    ['exactly 3 days left', 3 * DAY, 'danger'],
    ['one second left', 1000, 'danger'],
  ])('is %s → %s', (_label, before, level) => {
    expect(agentExpiryStatus(agent, false, at(before))).toMatchObject({ kind: 'valid', level });
  });

  // L'instant même de l'expiration : le gateway refuse déjà (`now >= validUntil`).
  it('is expired from the expiry instant on', () => {
    expect(agentExpiryStatus(agent, false, at(0))).toMatchObject({
      kind: 'expired',
      level: 'danger',
    });
    expect(agentExpiryStatus(agent, false, at(-DAY))).toMatchObject({ kind: 'expired' });
  });

  it('carries the agent and the parsed date', () => {
    const status = agentExpiryStatus(agent, false, at(20 * DAY));
    expect(status).toMatchObject({ agent, remaining: '20 d' });
    expect(status.kind === 'valid' && status.validUntil.toISOString()).toBe(VALID_UNTIL);
  });
});

describe('formatRemaining', () => {
  // Arrondi vers le bas : « 3 d » ne veut jamais dire 2 jours et 20 heures.
  it.each([
    [180 * DAY, '180 d'],
    [3 * DAY - 1, '2 d'],
    [DAY, '1 d'],
    [DAY - 1, '23 h'],
    [HOUR, '1 h'],
    [HOUR - 1, '< 1 h'],
  ])('writes %i ms as %s', (ms, label) => {
    expect(formatRemaining(ms)).toBe(label);
  });
});

describe('formatLikeDashboard', () => {
  // Le format de la page API de Hyperliquid, en heure locale de l'appareil.
  it('writes day first, with seconds, like the API page', () => {
    expect(formatLikeDashboard(new Date(2027, 4, 4, 13, 0, 28))).toBe('04/05/2027 13:00:28');
  });
});

describe('agentExpirySummary', () => {
  it.each([
    [agentExpiryStatus(undefined, false, at(DAY)), null],
    [agentExpiryStatus(agent, true, at(DAY)), 'Agent wallet status unavailable'],
    [agentExpiryStatus(null, false, at(DAY)), 'No agent wallet expiry: run set-agent-key'],
    [agentExpiryStatus(agent, false, at(0)), 'Agent wallet expired: orders cannot be signed'],
    [agentExpiryStatus(agent, false, at(5 * DAY)), 'Agent wallet expires in 5 d'],
  ])('summarises status %# in one line', (status, line) => {
    expect(agentExpirySummary(status)).toBe(line);
  });
});
