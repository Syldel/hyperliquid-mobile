import type { StrategyDocument } from '../models/strategy-document.model';
import { STRATEGY_DOCUMENT_SCHEMA_VERSION } from '../models/strategy-document.model';
import {
  STRATEGY_TRANSFER_FORMAT,
  documentsToWrite,
  exportStrategies,
  parseStrategyTransfer,
  planImport,
} from './strategy-transfer.util';

/**
 * Les deux règles que ce fichier garde :
 *
 * - **rien n'est écrasé**, parce qu'un import est un texte étranger et que la
 *   bibliothèque est la seule copie des stratégies de l'utilisateur ;
 * - **rien n'est abandonné en silence** : une entrée refusée est nommée, un
 *   `id` déjà pris donne une copie annoncée. Importer trois stratégies et n'en
 *   voir apparaître que deux sans un mot est la défaillance muette que ce dépôt
 *   met en premier.
 */
const RULES = {
  long: {
    entry: { type: 'comparison', left: { type: 'price', field: 'close' }, operator: 'GT' },
  },
} as unknown as StrategyDocument['rules'];

const DOCUMENT: StrategyDocument = {
  id: 'st_1',
  name: 'Breakout',
  rules: RULES,
  createdAt: 1_000,
  updatedAt: 2_000,
  schemaVersion: STRATEGY_DOCUMENT_SCHEMA_VERSION,
};

/** Générateur déterministe : un test ne doit pas dépendre de `crypto`. */
function ids(): () => string {
  let n = 0;
  return () => `st_new_${++n}`;
}

describe('exportStrategies', () => {
  it('writes an envelope that says what it is and when', () => {
    // Un tableau nu ne dit ni qui l'a produit ni sous quelle forme, et savoir
    // quelle version a écrit un document est une exigence du dépôt.
    const parsed = JSON.parse(exportStrategies([DOCUMENT], 1_700));

    expect(parsed.format).toBe(STRATEGY_TRANSFER_FORMAT);
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe(1_700);
    expect(parsed.strategies).toEqual([DOCUMENT]);
  });

  it('indents, because a human or an AI reads this', () => {
    expect(exportStrategies([DOCUMENT], 1_700)).toContain('\n  ');
  });

  it('survives a round trip without losing a field', () => {
    const { documents, problems } = parseStrategyTransfer(
      exportStrategies([DOCUMENT], 1_700),
      ids(),
      9_999,
    );

    expect(problems).toEqual([]);
    expect(documents).toEqual([DOCUMENT]);
  });
});

describe('parseStrategyTransfer', () => {
  it('reads the envelope, a bare array and a single document', () => {
    /**
     * Les deux tolérances sont des décisions : une IA à qui on demande « une
     * stratégie » rend un objet, et un tableau nu reste sans ambiguïté. Les
     * refuser ne protégerait de rien.
     */
    const envelope = exportStrategies([DOCUMENT], 1_700);
    const bare = JSON.stringify([DOCUMENT]);
    const alone = JSON.stringify(DOCUMENT);

    for (const text of [envelope, bare, alone]) {
      expect(parseStrategyTransfer(text, ids(), 9_999).documents).toEqual([DOCUMENT]);
    }
  });

  it('says the clipboard is not JSON rather than failing mute', () => {
    const result = parseStrategyTransfer('not json at all', ids(), 9_999);

    expect(result.documents).toEqual([]);
    expect(result.problems).toEqual(['The clipboard does not contain valid JSON.']);
  });

  it('names the entry it refuses, and why', () => {
    // « some entries were invalid » laisserait chercher laquelle.
    const text = JSON.stringify([
      { name: 'No rules here' },
      { rules: RULES },
      'not an object',
      DOCUMENT,
    ]);

    const { documents, problems } = parseStrategyTransfer(text, ids(), 9_999);

    expect(documents).toEqual([DOCUMENT]);
    expect(problems).toEqual([
      'Entry 1 ("No rules here") carries no rules.',
      'Entry 2 has no name.',
      'Entry 3 is not an object.',
    ]);
  });

  it('keeps the good entries when one is refused', () => {
    // Le contraire ferait perdre un lot entier pour une virgule.
    const text = JSON.stringify([DOCUMENT, { name: 'Broken' }]);

    const { documents, problems } = parseStrategyTransfer(text, ids(), 9_999);

    expect(documents).toHaveLength(1);
    expect(problems).toHaveLength(1);
  });

  it('fills what is missing with values that change no meaning', () => {
    // Un `id` absent fait un document neuf, des dates absentes valent
    // maintenant. Rien là-dedans ne touche aux règles.
    const [document] = parseStrategyTransfer(
      JSON.stringify({ name: 'From an AI', rules: RULES }),
      ids(),
      9_999,
    ).documents;

    expect(document).toEqual({
      id: 'st_new_1',
      name: 'From an AI',
      rules: RULES,
      createdAt: 9_999,
      updatedAt: 9_999,
      schemaVersion: STRATEGY_DOCUMENT_SCHEMA_VERSION,
    });
  });

  it('keeps an id it was given, rather than minting a new one', () => {
    // Même raison que la migration des anciens charts : garder l'`id` rend
    // l'import idempotent et laisse un sens aux références.
    const [document] = parseStrategyTransfer(JSON.stringify(DOCUMENT), ids(), 9_999).documents;

    expect(document.id).toBe('st_1');
  });

  it('keeps a schema version from a newer build instead of lowering it', () => {
    /**
     * Un document écrit par un build plus récent doit continuer à se déclarer
     * comme tel : `isFromNewerSchema` s'en sert pour avertir qu'il peut porter
     * des nœuds que ce build ne sait pas interpréter. Le rabaisser le ferait
     * passer pour compris.
     */
    const text = JSON.stringify({ ...DOCUMENT, schemaVersion: 99 });

    expect(parseStrategyTransfer(text, ids(), 9_999).documents[0]?.schemaVersion).toBe(99);
  });

  it('trims a name but refuses one made only of spaces', () => {
    const padded = parseStrategyTransfer(
      JSON.stringify({ name: '  Spaced  ', rules: RULES }),
      ids(),
      9_999,
    );
    const blank = parseStrategyTransfer(
      JSON.stringify({ name: '   ', rules: RULES }),
      ids(),
      9_999,
    );

    expect(padded.documents[0]?.name).toBe('Spaced');
    expect(blank.documents).toEqual([]);
  });

  it('refuses rules that are not an object, a list included', () => {
    // `rules` est un arbre nommé par côté, jamais une liste : accepter un
    // tableau ferait entrer un document que le bot refusera plus tard.
    const text = JSON.stringify({ name: 'Listy', rules: [] });

    expect(parseStrategyTransfer(text, ids(), 9_999).documents).toEqual([]);
  });
});

describe('planImport', () => {
  it('lets a document whose id is free in, untouched', () => {
    const [decision] = planImport([DOCUMENT], [], ids(), 5_000);

    expect(decision).toEqual({ document: DOCUMENT, outcome: 'added', originalName: 'Breakout' });
  });

  it('does not duplicate a document that is already there', () => {
    // Réexporter puis recoller le même texte ne doit rien créer.
    const decisions = planImport([DOCUMENT], [DOCUMENT], ids(), 5_000);

    expect(decisions[0]?.outcome).toBe('already-present');
    expect(documentsToWrite(decisions)).toEqual([]);
  });

  it('ignores the dates when deciding whether it is the same strategy', () => {
    // Sans ça, une horloge qui a tourné suffirait à dupliquer.
    const sameButLater = { ...DOCUMENT, createdAt: 7_000, updatedAt: 8_000 };

    expect(planImport([sameButLater], [DOCUMENT], ids(), 5_000)[0]?.outcome).toBe(
      'already-present',
    );
  });

  it('copies under a new id rather than overwriting a different strategy', () => {
    /**
     * Le cas qui compte : deux stratégies différentes portant le même `id`.
     * Écraser perdrait le travail de l'utilisateur ; sauter en silence lui
     * ferait croire que l'import a tout pris.
     */
    const incoming = { ...DOCUMENT, name: 'Breakout v2', rules: {} as StrategyDocument['rules'] };

    const [decision] = planImport([incoming], [DOCUMENT], ids(), 5_000);

    expect(decision?.outcome).toBe('copied');
    expect(decision?.originalName).toBe('Breakout v2');
    expect(decision?.document.id).toBe('st_new_1');
    expect(decision?.document.name).toBe('Breakout v2 (imported)');
    expect(decision?.document.createdAt).toBe(5_000);
  });

  it('never returns the id of an existing document for a copy', () => {
    const incoming = { ...DOCUMENT, name: 'Other' };

    const [decision] = planImport([incoming], [DOCUMENT], ids(), 5_000);

    expect(decision?.document.id).not.toBe(DOCUMENT.id);
  });

  it('sees a clash between two entries of the same paste', () => {
    // Le deuxième entrant doit se heurter au premier, pas seulement à la
    // bibliothèque : une liste construite au fil de l'eau le permet.
    const twin = { ...DOCUMENT, name: 'Twin' };

    const decisions = planImport([DOCUMENT, twin], [], ids(), 5_000);

    expect(decisions.map((d) => d.outcome)).toEqual(['added', 'copied']);
    expect(decisions[1]?.document.id).not.toBe(decisions[0]?.document.id);
  });
});
