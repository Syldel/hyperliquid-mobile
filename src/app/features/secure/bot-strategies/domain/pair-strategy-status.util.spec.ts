import type { StrategyMeta } from '@syldel/trading-shared-types';
import {
  isKnownUnexecutable,
  pairStrategyStatus,
  type StoredPairStrategy,
} from './pair-strategy-status.util';

/**
 * Le contrat tient en une phrase : dire qu'une paire est inexécutable quand on
 * en est certain, et se taire quand on ne peut pas savoir.
 *
 * Les fixtures reprennent le catalogue réellement servi par le bot et les deux
 * paires réellement trouvées sur le compte de développement — une stratégie
 * codée en dur sans le moindre paramètre, et un vestige qui ne porte qu'un nom.
 */
const TOL_LANGIT: StrategyMeta = {
  name: 'Tol Langit ATR v7 Pro',
  shortname: 'tol-langit-atr-v7-pro',
};

const ADVANCED_RULES: StrategyMeta = {
  name: 'Advanced Logical Rules',
  shortname: 'advanced-rules',
  parameters: [
    { id: 'long.entry', label: 'Long Entry Rules', type: 'rule-builder', defaultValue: null },
  ],
};

const CATALOGUE: readonly StrategyMeta[] = [TOL_LANGIT, ADVANCED_RULES];

/** Le vestige trouvé sur BTC et XRP : un nom, et rien d'autre. */
const LEGACY: StoredPairStrategy = { name: 'Neural Momentum Strategy' };

describe('pairStrategyStatus', () => {
  it('reports a missing shortname without waiting for the catalogue', () => {
    // Le bot aiguille sur `shortname` : sans lui il n'y a rien à chercher,
    // donc rien à demander au serveur. C'est le seul verdict qu'un client
    // puisse rendre seul.
    expect(pairStrategyStatus(LEGACY, null)).toBe('missing-shortname');
  });

  it('reports a pair carrying no strategy at all as missing', () => {
    expect(pairStrategyStatus(undefined, CATALOGUE)).toBe('missing-shortname');
  });

  it('treats a blank shortname as missing, exactly as the engine does', () => {
    // `'   '.toLowerCase().trim()` vaut `''` côté moteur : aucune branche ne
    // matche. Le signaler « inconnu » laisserait croire à un catalogue en
    // retard alors que la valeur n'en est pas une.
    expect(pairStrategyStatus({ ...LEGACY, shortname: '   ' }, CATALOGUE)).toBe(
      'missing-shortname',
    );
  });

  it('never accuses a present shortname while the catalogue is unknown', () => {
    // Bot injoignable ou métadonnées pas encore arrivées : ne pas savoir n'est
    // pas un défaut de la paire.
    expect(pairStrategyStatus({ name: 'Whatever', shortname: 'regime-engine' }, null)).toBe(
      'unverified',
    );
  });

  it('reports a shortname the served catalogue no longer offers', () => {
    expect(pairStrategyStatus({ name: 'Gone', shortname: 'neural-momentum' }, CATALOGUE)).toBe(
      'unknown-shortname',
    );
  });

  it('accepts a shortname the catalogue offers', () => {
    expect(pairStrategyStatus({ name: 'SOL setup', shortname: 'advanced-rules' }, CATALOGUE)).toBe(
      'ok',
    );
  });

  it('matches the shortname the way the engine routes on it, not stricter', () => {
    // Le moteur compare `shortname?.toLowerCase().trim()`. Une paire qu'il
    // exécute malgré une casse ou des espaces ne doit pas être affichée ici
    // comme inexécutable — ce serait un faux diagnostic, pire qu'un silence.
    expect(
      pairStrategyStatus({ name: 'SOL setup', shortname: '  Advanced-Rules ' }, CATALOGUE),
    ).toBe('ok');
  });

  it('does not treat a rule-less strategy as a defect', () => {
    // Sept des huit stratégies du catalogue sont codées en dur et n'ont ni
    // `rules` ni `settings`. Confondre « pas de règles » et « cassée » ferait
    // clignoter une paire parfaitement saine.
    expect(
      pairStrategyStatus({ name: TOL_LANGIT.name, shortname: TOL_LANGIT.shortname }, CATALOGUE),
    ).toBe('ok');
  });

  it('leaves every shortname unknown on an exchange the bot serves nothing for', () => {
    // `[]` est une réponse du serveur — « je ne propose rien ici » — et se
    // distingue de `null`, qui est une absence de réponse.
    expect(pairStrategyStatus({ name: 'X', shortname: 'advanced-rules' }, [])).toBe(
      'unknown-shortname',
    );
  });
});

describe('isKnownUnexecutable', () => {
  it('covers exactly the two verdicts this build is certain of', () => {
    expect(isKnownUnexecutable('missing-shortname')).toBe(true);
    expect(isKnownUnexecutable('unknown-shortname')).toBe(true);
  });

  it('never fires on a status this build could not verify', () => {
    // Sans quoi une coupure du bot allumerait toute la liste en rouge.
    expect(isKnownUnexecutable('unverified')).toBe(false);
    expect(isKnownUnexecutable('ok')).toBe(false);
  });
});
