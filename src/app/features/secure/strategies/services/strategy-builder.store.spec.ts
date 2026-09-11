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
});
