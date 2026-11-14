import type { PublicStrategyValidationIssue } from '@syldel/trading-shared-types';
import {
  pairValidationStatus,
  refusalConcernsProtections,
  refusalSummary,
} from './pair-validation-status.util';

/**
 * Les réponses ne sont pas inventées : elles sont celles que rend `toStrategyValidationResult(collectStrategyIssues(…))`
 * des types partagés 0.34.0 — la fonction derrière `POST /exchanges/strategies/validate` — pour les deux stratégies de
 * `rabby_01` relevées le 2026-11-14. La première est à l'ancien format (12 anomalies, les trois premières recopiées) ;
 * la seconde, sans protections, est acceptée.
 */
const MISSING_ANCHOR: PublicStrategyValidationIssue = {
  code: 'MISSING_ANCHOR',
  path: 'strategy.protective.entries[0].anchor',
  message:
    'Missing anchor at strategy.protective.entries[0].anchor. An order has to say where it sits: MARKET, ENTRY, EXPRESSION.',
  allowed: ['MARKET', 'ENTRY', 'EXPRESSION'],
};

const MISSING_DISTANCE: PublicStrategyValidationIssue = {
  code: 'MISSING_DISTANCE',
  path: 'strategy.protective.entries[0].distance',
  message:
    'Missing distance at strategy.protective.entries[0].distance. An order has to say how far from its anchor it sits: ATR, PERCENT.',
  allowed: ['ATR', 'PERCENT'],
};

const RETIRED_ATR: PublicStrategyValidationIssue = {
  code: 'RETIRED_ATR_MULTIPLIER',
  path: 'strategy.protective.entries[0].atrMultiplier',
  message:
    '"atrMultiplier" was replaced by "distance" at strategy.protective.entries[0]. It was the only unit there was, which left no way to express a percentage stop. Translate it explicitly: atrMultiplier 1.5 becomes distance { unit: "ATR", value: 1.5 }.',
  allowed: ['ATR', 'PERCENT'],
};

const LEGACY = { valid: false, issues: [MISSING_ANCHOR, MISSING_DISTANCE, RETIRED_ATR] };

describe('pairValidationStatus', () => {
  it('says the bot accepts a strategy it calls valid', () => {
    expect(pairValidationStatus({ valid: true, issues: [] })).toEqual({ kind: 'accepted' });
  });

  it('says the bot refuses a strategy it calls invalid, with what it said', () => {
    expect(pairValidationStatus(LEGACY)).toEqual({ kind: 'refused', issues: LEGACY.issues });
  });

  // Le bot fait foi sur `valid` : un refus sans détail reste un refus.
  it('keeps a refusal that carries no issue list', () => {
    expect(pairValidationStatus({ valid: false })).toEqual({ kind: 'refused', issues: [] });
  });

  // Ne pas savoir n'est pas un défaut de la paire : rien ne s'allume sur une absence de réponse.
  it.each([
    ['no reply yet, or a failed call', null],
    ['an undefined reply', undefined],
    ['a reply without a verdict', { issues: [] }],
    ['a verdict that is not a boolean', { valid: 'false', issues: [] }],
    ['a reply that is not an object', 'ok'],
  ])('claims nothing on %s', (_label, reply) => {
    expect(pairValidationStatus(reply)).toEqual({ kind: 'unverified' });
  });
});

describe('refusalSummary', () => {
  it('gives the first issue as the bot wrote it, and how many more', () => {
    expect(refusalSummary(LEGACY.issues)).toBe(`${MISSING_ANCHOR.message} (and 2 more issues)`);
  });

  it('says "issue" for a single other one', () => {
    expect(refusalSummary([MISSING_ANCHOR, MISSING_DISTANCE])).toBe(
      `${MISSING_ANCHOR.message} (and 1 more issue)`,
    );
  });

  it('gives a lone issue alone', () => {
    expect(refusalSummary([RETIRED_ATR])).toBe(RETIRED_ATR.message);
  });

  it('still says something when the bot gave no reason', () => {
    expect(refusalSummary([])).toBe('The bot refuses it without saying why.');
    expect(refusalSummary([{ ...MISSING_ANCHOR, message: '  ' }])).toBe(
      'The bot refuses it without saying why.',
    );
  });
});

describe('refusalConcernsProtections', () => {
  it('sends a refusal of the protective entries to the protections', () => {
    expect(refusalConcernsProtections(LEGACY.issues)).toBe(true);
  });

  it('leaves a refusal of the rules to the pair form', () => {
    expect(
      refusalConcernsProtections([
        { ...MISSING_ANCHOR, path: 'strategy.rules.long.entry.children[0]' },
      ]),
    ).toBe(false);
  });

  // Un mot qui contient « protective » sans en être le segment ne compte pas.
  it('reads the path segment, not any substring', () => {
    expect(
      refusalConcernsProtections([{ ...MISSING_ANCHOR, path: 'strategy.notprotective.x' }]),
    ).toBe(false);
    expect(refusalConcernsProtections([{ ...MISSING_ANCHOR, path: 'strategy.protective' }])).toBe(
      true,
    );
  });
});
