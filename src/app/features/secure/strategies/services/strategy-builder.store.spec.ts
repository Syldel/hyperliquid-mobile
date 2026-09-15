import { TestBed } from '@angular/core/testing';
import type { LogicalGroup, RuleNode, StrategyRules } from '@syldel/trading-shared-types';
import {
  createComparison,
  createConstant,
  createLogicalGroup,
} from '../domain/strategy-node.factory';
import { getAtPath } from '../domain/strategy-tree.ops';
import {
  STRATEGY_DOCUMENT_SCHEMA_VERSION,
  type StrategyDocument,
} from '../models/strategy-document.model';
import { StrategyBuilderStore } from './strategy-builder.store';

function document(rules: StrategyRules = {}): StrategyDocument {
  return {
    id: 'st_1',
    name: 'Draft',
    rules,
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: STRATEGY_DOCUMENT_SCHEMA_VERSION,
  };
}

const filledEntry: LogicalGroup = {
  type: 'logical',
  operator: 'AND',
  conditions: [createConstant(true)],
};

describe('StrategyBuilderStore', () => {
  let store: StrategyBuilderStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [StrategyBuilderStore] });
    store = TestBed.inject(StrategyBuilderStore);
  });

  it('opens a document and exposes its name and rules', () => {
    const doc = document({ long: { entry: filledEntry } });
    store.open(doc);

    expect(store.name()).toBe('Draft');
    expect(store.rules()).toBe(doc.rules);
    expect(store.editedPaths()).toEqual([]);
    expect(store.canUndo()).toBe(false);
  });

  describe('setBranch', () => {
    it('creates a side that does not exist yet', () => {
      store.open(document());
      store.setBranch('rules.long.entry', filledEntry);

      expect(store.rules().long!.entry).toBe(filledEntry);
      expect(store.editedPaths()).toEqual(['rules.long.entry']);
    });

    // `entry` est obligatoire dans SideRules : ouvrir `exit` d'abord doit
    // fabriquer les deux, sans quoi l'objet ne serait pas du bon type.
    it('creates a valid empty entry when the exit branch is opened first', () => {
      store.open(document());
      store.setBranch('rules.short.exit', filledEntry);

      expect(store.rules().short!.exit).toBe(filledEntry);
      expect(store.rules().short!.entry).toEqual(createLogicalGroup());
    });

    it('removes a branch when given undefined', () => {
      store.open(document({ long: { entry: filledEntry, exit: filledEntry } }));
      store.setBranch('rules.long.exit', undefined);

      expect(store.rules().long!.exit).toBeUndefined();
      expect(store.rules().long!.entry).toBe(filledEntry);
    });
  });

  describe('addCondition', () => {
    it('appends and records the new child as edited', () => {
      store.open(document({ long: { entry: createLogicalGroup() } }));
      store.addCondition('rules.long.entry', createConstant(true));

      expect(store.editedPaths()).toEqual(['rules.long.entry.conditions[0]']);
      expect(getAtPath(store.rules(), 'rules.long.entry.conditions[0]')).toEqual(
        createConstant(true),
      );
    });

    it('is a no-op on a path that is not a logical group', () => {
      store.open(document({ long: { entry: filledEntry } }));
      const before = store.rules();

      store.addCondition('rules.long.entry.conditions[0]', createConstant(true));

      expect(store.rules()).toBe(before);
      expect(store.canUndo()).toBe(false);
    });
  });

  describe('removeNode', () => {
    it('removes the node and forgets edited paths under the same parent', () => {
      store.open(
        document({
          long: {
            entry: {
              type: 'logical',
              operator: 'AND',
              conditions: [createConstant(true), createConstant(false)],
            },
          },
        }),
      );

      store.replaceNode('rules.long.entry.conditions[1]', createComparison());
      expect(store.editedPaths()).toEqual(['rules.long.entry.conditions[1]']);

      store.removeNode('rules.long.entry.conditions[0]');

      // Les index ont glissé : le chemin mémorisé désignerait un autre nœud.
      expect(store.editedPaths()).toEqual([]);
      expect((store.rules().long!.entry.conditions as RuleNode[]).length).toBe(1);
    });
  });

  describe('undo', () => {
    it('restores the previous rules and edited paths', () => {
      const doc = document({ long: { entry: createLogicalGroup() } });
      store.open(doc);

      store.addCondition('rules.long.entry', createConstant(true));
      expect(store.canUndo()).toBe(true);

      store.undo();

      expect(store.rules()).toBe(doc.rules);
      expect(store.editedPaths()).toEqual([]);
      expect(store.canUndo()).toBe(false);
    });

    it('does nothing when there is no history', () => {
      const doc = document({ long: { entry: filledEntry } });
      store.open(doc);
      store.undo();

      expect(store.rules()).toBe(doc.rules);
    });
  });

  describe('verdicts', () => {
    it('allows saving a draft as soon as it has a name, even with blocking issues', () => {
      store.open(document({ long: { entry: createLogicalGroup() } }));

      expect(store.blockingIssues().map((i) => i.code)).toEqual(['EMPTY_LOGICAL_CONDITIONS']);
      expect(store.canSave()).toBe(true);
      expect(store.canAttach()).toBe(false);
    });

    it('refuses to save without a name', () => {
      store.open({ ...document({ long: { entry: filledEntry } }), name: '   ' });
      expect(store.canSave()).toBe(false);
    });

    it('allows attaching once a side is complete', () => {
      store.open(document({ long: { entry: filledEntry } }));

      expect(store.blockingIssues()).toEqual([]);
      expect(store.canAttach()).toBe(true);
    });

    it('refuses to attach an empty strategy, with nothing to evaluate', () => {
      store.open(document());
      expect(store.canAttach()).toBe(false);
    });

    // Un nœud hérité d'un build plus récent ne doit rien bloquer tant qu'on n'y touche pas.
    it('defers an unknown inherited node instead of blocking on it', () => {
      const alien = { type: 'quantum' } as unknown as RuleNode;
      store.open(
        document({
          long: { entry: { type: 'logical', operator: 'AND', conditions: [alien] } },
        }),
      );

      expect(store.blockingIssues()).toEqual([]);
      expect(store.deferredIssues().map((i) => i.code)).toEqual(['UNKNOWN_NODE_TYPE']);
      expect(store.canAttach()).toBe(true);
    });
  });

  describe('toDocument', () => {
    it('returns the document with the trimmed name and pruned rules', () => {
      store.open(document({ long: { entry: filledEntry } }));
      store.setName('  Renamed  ');
      store.setBranch('rules.short.entry', createLogicalGroup());

      const result = store.toDocument()!;

      expect(result.name).toBe('Renamed');
      expect(result.rules.short).toBeUndefined();
      expect(result.id).toBe('st_1');
      expect(result.createdAt).toBe(1);
    });

    it('returns null when no document is open', () => {
      expect(store.toDocument()).toBeNull();
    });
  });
});

describe('StrategyBuilderStore - server issues', () => {
  let store: StrategyBuilderStore;

  const rules = (): StrategyRules => ({
    long: { entry: { type: 'logical', operator: 'AND', conditions: [createComparison()] } },
    short: { entry: { type: 'logical', operator: 'AND', conditions: [createComparison()] } },
  });

  const issue = (path: string) => ({ path, code: 'UNKNOWN_INDICATOR' as const, message: 'nope' });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [StrategyBuilderStore] });
    store = TestBed.inject(StrategyBuilderStore);
    store.open(document(rules()));
  });

  it('points at the condition that contains the offending operand', () => {
    store.setServerIssues([issue('strategy.rules.long.entry.conditions[0].left')]);

    expect([...store.serverIssuePaths()]).toEqual(['rules.long.entry.conditions[0]']);
  });

  it('ignores an issue that addresses nothing in the tree', () => {
    store.setServerIssues([issue('strategy.settings.atrPeriod')]);

    expect(store.serverIssuePaths().size).toBe(0);
  });

  // Le verdict decrivait un arbre qui n'existe plus a cet endroit : le garder
  // laisserait croire que la correction n'a pas pris.
  it('forgets the issues of a subtree once it is edited', () => {
    store.setServerIssues([
      issue('strategy.rules.long.entry.conditions[0].left'),
      issue('strategy.rules.short.entry.conditions[0].left'),
    ]);

    store.replaceNode('rules.long.entry.conditions[0]', createConstant(true));

    expect(store.serverIssues().map((i) => i.path)).toEqual([
      'strategy.rules.short.entry.conditions[0].left',
    ]);
  });

  it('keeps them when an unrelated branch is edited', () => {
    store.setServerIssues([issue('strategy.rules.long.entry.conditions[0].left')]);

    store.replaceNode('rules.short.entry.conditions[0]', createConstant(true));

    expect(store.serverIssues()).toHaveLength(1);
  });

  // Une ecriture sans effet ne commit pas, donc n'efface rien.
  it('keeps them when an edit changes nothing', () => {
    store.setServerIssues([issue('strategy.rules.long.entry.conditions[0].left')]);
    const untouched = store.rules();

    store.removeNode('rules.long.entry.conditions[9]');

    expect(store.rules()).toBe(untouched);
    expect(store.serverIssues()).toHaveLength(1);
  });

  it('drops the previous verdict when another document is opened', () => {
    store.setServerIssues([issue('strategy.rules.long.entry.conditions[0].left')]);
    store.open(document(rules()));

    expect(store.serverIssues()).toEqual([]);
  });

  /**
   * Une suppression décale les index suivants du tableau. Un verdict mémorisé
   * sur `conditions[2]` désigne alors le nœud qui était en `conditions[3]` —
   * et l'éditeur accuse une condition parfaitement saine, avec le message
   * d'une autre. C'est le pire des cas du dépôt : non pas un silence, mais une
   * affirmation fausse sur des règles de trading.
   *
   * `commit` s'en protégeait déjà pour les éditions ; `removeNode` le
   * court-circuite et n'en bénéficiait pas.
   */
  describe('after a removal shifts the indexes that follow', () => {
    /** Quatre conditions reconnaissables : les valeurs 1 à 4. */
    const four = (): StrategyRules => ({
      long: {
        entry: {
          type: 'logical',
          operator: 'AND',
          conditions: [1, 2, 3, 4].map((value) => ({
            type: 'comparison' as const,
            left: { type: 'price' as const, field: 'close' as const },
            operator: 'GT' as const,
            right: { type: 'number' as const, value },
          })),
        },
      },
    });

    function valueAt(index: number): number {
      const group = getAtPath(store.rules(), 'rules.long.entry') as {
        conditions: { right: { value: number } }[];
      };
      return group.conditions[index].right.value;
    }

    beforeEach(() => {
      store.open(document(four()));
    });

    it('never leaves a verdict pointing at the node that slid into its place', () => {
      store.setServerIssues([issue('strategy.rules.long.entry.conditions[2].right')]);
      expect([...store.serverIssuePaths()]).toEqual(['rules.long.entry.conditions[2]']);

      store.removeNode('rules.long.entry.conditions[0]');

      // La condition en [2] est désormais celle qui valait 4 : l'innocente.
      expect(valueAt(2)).toBe(4);
      expect(store.serverIssuePaths().size).toBe(0);
      expect(store.serverIssues()).toEqual([]);
    });

    // Les index d'un AUTRE groupe n'ont pas bougé : leur verdict tient encore.
    it('keeps the verdict of a group the removal did not touch', () => {
      store.open(
        document({
          ...four(),
          short: {
            entry: { type: 'logical', operator: 'AND', conditions: [createConstant(true)] },
          },
        }),
      );
      store.setServerIssues([
        issue('strategy.rules.long.entry.conditions[2].right'),
        issue('strategy.rules.short.entry.conditions[0]'),
      ]);

      store.removeNode('rules.long.entry.conditions[0]');

      expect(store.serverIssues().map((i) => i.path)).toEqual([
        'strategy.rules.short.entry.conditions[0]',
      ]);
    });
  });

  /**
   * Retirer une clé d'objet ne décale rien : seul le sous-arbre supprimé
   * devient introuvable. Le verdict qui le visait décrivait un nœud qui
   * n'existe plus, et le laisser dans la liste ferait chercher une condition
   * absente — mais les autres branches restent parfaitement valables.
   */
  it('drops only the verdict of a removed branch, not that of its sibling', () => {
    store.open(
      document({
        long: {
          entry: { type: 'logical', operator: 'AND', conditions: [createConstant(true)] },
          exit: { type: 'logical', operator: 'AND', conditions: [createConstant(false)] },
        },
      }),
    );
    store.setServerIssues([
      issue('strategy.rules.long.exit.conditions[0]'),
      issue('strategy.rules.long.entry.conditions[0]'),
    ]);

    store.removeNode('rules.long.exit');

    expect(store.serverIssues().map((i) => i.path)).toEqual([
      'strategy.rules.long.entry.conditions[0]',
    ]);
  });
});

/**
 * Le verdict local existait déjà (`blockingIssues`) mais n'était affiché nulle
 * part : une stratégie incomplète s'enregistrait en silence, et cessait
 * simplement d'être attachable sans qu'un écran le dise.
 *
 * Ce que ces tests fixent, c'est le **moment** où ce verdict devient un
 * reproche. Pas pendant la construction — un groupe vide est l'état de départ
 * normal d'une branche — mais quand l'utilisateur déclare avoir fini, en
 * enregistrant.
 */
describe('StrategyBuilderStore - local verdict', () => {
  let store: StrategyBuilderStore;

  /** Un côté long complet, et un short dont l'entrée est restée vide. */
  const halfBuilt = (): StrategyRules => ({
    long: { entry: filledEntry },
    short: { entry: createLogicalGroup() },
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [StrategyBuilderStore] });
    store = TestBed.inject(StrategyBuilderStore);
  });

  it('says nothing while the draft is still being built', () => {
    store.open(document({ long: { entry: createLogicalGroup(), exit: filledEntry } }));

    // L'anomalie est bien connue...
    expect(store.blockingIssues().length).toBeGreaterThan(0);
    // ...mais elle n'est pas encore un reproche.
    expect(store.localIssues()).toEqual([]);
    expect(store.localIssuePaths().size).toBe(0);
  });

  it('reports the verdict once the user asks to save', () => {
    store.open(document({ long: { entry: createLogicalGroup(), exit: filledEntry } }));

    store.noteSaveAttempt();

    expect(store.localIssues().map((issue) => issue.code)).toEqual(['EMPTY_LOGICAL_CONDITIONS']);
  });

  /**
   * Le rapport doit décrire **ce qui a été enregistré**, pas le brouillon à
   * l'écran. `pruneEmptyRuleBranches` retire les branches restées vides : les
   * accuser reviendrait à exiger la correction d'un nœud que le document ne
   * porte pas.
   */
  it('judges the rules as they are saved, not as they are drawn', () => {
    store.open(document(halfBuilt()));
    store.noteSaveAttempt();

    expect(store.localIssues()).toEqual([]);
  });

  // Corollaire du test précédent, côté verdict d'attachement : un long complet
  // reste exécutable, qu'un short vide traîne à l'écran ou non.
  it('allows attaching a complete side despite an empty one that will be pruned', () => {
    store.open(document(halfBuilt()));

    expect(store.canAttach()).toBe(true);
  });

  // Même besoin que pour le verdict serveur : « Empty group » ne dit rien tant
  // qu'on ne sait pas laquelle des douze conditions il désigne.
  it('points at the line each reported issue targets', () => {
    store.open(
      document({
        long: {
          entry: {
            type: 'logical',
            operator: 'AND',
            conditions: [createConstant(true), createLogicalGroup()],
          },
        },
      }),
    );
    store.noteSaveAttempt();

    expect([...store.localIssuePaths()]).toEqual(['rules.long.entry.conditions[1]']);
  });

  it('stops reporting once the issue is fixed, without being asked again', () => {
    store.open(document({ long: { entry: createLogicalGroup(), exit: filledEntry } }));
    store.noteSaveAttempt();
    expect(store.localIssues().length).toBe(1);

    store.setBranch('rules.long.entry', filledEntry);

    expect(store.localIssues()).toEqual([]);
  });

  // Un autre document rouvre sur un brouillon propre : le reproche ne se
  // transporte pas d'une édition à l'autre.
  it('forgets the save attempt when another document is opened', () => {
    store.open(document({ long: { entry: createLogicalGroup(), exit: filledEntry } }));
    store.noteSaveAttempt();

    store.open(document({ long: { entry: createLogicalGroup(), exit: filledEntry } }));

    expect(store.localIssues()).toEqual([]);
  });
});
