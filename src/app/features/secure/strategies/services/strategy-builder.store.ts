import { computed, Injectable, signal } from '@angular/core';
import type {
  LogicalGroup,
  PublicStrategyValidationIssue,
  RuleNode,
  StrategyRules,
} from '@syldel/trading-shared-types';
import { collectEditorIssues, locateIssue } from '../domain/strategy-issues.util';
import { createLogicalGroup } from '../domain/strategy-node.factory';
import {
  childPath,
  isPathInside,
  parentPath,
  toLocalIssuePath,
} from '../domain/strategy-path.util';
import {
  appendCondition,
  getAtPath,
  isLogicalGroup,
  pruneEmptyRuleBranches,
  removeAtPath,
  replaceAtPath,
} from '../domain/strategy-tree.ops';
import type { StrategyDocument } from '../models/strategy-document.model';

/**
 * ============================================================================
 * 🗃️ STRATEGY BUILDER STORE
 * État d'une session d'édition : le brouillon, ce qui y a été touché, et le
 * verdict local qui en découle.
 *
 * Fourni **par modale** (`providers: [StrategyBuilderStore]`), pas en racine :
 * deux éditions simultanées ne doivent pas partager un brouillon.
 *
 * Toute modification passe par les opérations d'arbre immuables — le store
 * n'écrit jamais dans un nœud en place. C'est ce qui lui permet de garder un
 * historique en empilant simplement les états précédents, et c'est aussi ce
 * qui préserve les sous-arbres non touchés (réécriture verbatim).
 * ============================================================================
 */
@Injectable()
export class StrategyBuilderStore {
  private readonly _document = signal<StrategyDocument | null>(null);
  private readonly _name = signal('');
  private readonly _rules = signal<StrategyRules>({});
  /** Sous-arbres modifiés pendant CETTE session — voir `partitionStrategyIssues`. */
  private readonly _editedPaths = signal<string[]>([]);
  private readonly _history = signal<{ rules: StrategyRules; editedPaths: string[] }[]>([]);

  /**
   * Sous-arbre affiché seul, quand l'utilisateur descend au-delà des deux
   * niveaux rendus en ligne (`null` = vue d'ensemble des branches).
   *
   * C'est de l'état de **vue**, pas du document — il est ici et non dans la
   * modale parce que l'arbre est récursif : le poser dans le store évite une
   * chaîne d'`output()` remontant niveau par niveau. Une modale dédiée aurait
   * été l'autre option, mais elle recevrait un injecteur distinct, donc un
   * autre store, donc un autre brouillon.
   */
  private readonly _focusedPath = signal<string | null>(null);
  private readonly _serverIssues = signal<PublicStrategyValidationIssue[]>([]);

  readonly document = this._document.asReadonly();
  readonly name = this._name.asReadonly();
  readonly rules = this._rules.asReadonly();
  readonly editedPaths = this._editedPaths.asReadonly();
  readonly focusedPath = this._focusedPath.asReadonly();
  readonly canUndo = computed(() => this._history().length > 0);

  focus(path: string | null): void {
    this._focusedPath.set(path);
  }

  readonly issues = computed(() => collectEditorIssues(this._rules(), this._editedPaths()));

  /**
   * Anomalies renvoyées par le dernier verdict du bot.
   *
   * Elles vivent ici et non dans la modale parce que deux vues en ont besoin :
   * la liste qui les énumère, et l'arbre qui doit signaler les lignes visées.
   */
  readonly serverIssues = this._serverIssues.asReadonly();

  /**
   * Lignes de l'arbre visées par une anomalie serveur.
   *
   * Recalculé depuis l'arbre courant : un chemin que l'édition a rendu caduc
   * cesse de désigner quoi que ce soit, sans qu'on ait à le nettoyer.
   */
  readonly serverIssuePaths = computed(() => {
    const rules = this._rules();

    return new Set(
      this._serverIssues()
        .map((issue) => locateIssue(rules, issue.path)?.nodePath)
        .filter((path) => path !== undefined),
    );
  });

  /** Anomalies dont ce build est certain — elles seules empêchent la mise en service. */
  readonly blockingIssues = computed(() => this.issues().blocking);

  /** Nœuds hérités que ce build ne sait pas interpréter : affichés en lecture seule. */
  readonly deferredIssues = computed(() => this.issues().deferred);

  /** `true` si le nom est renseigné : seule condition pour enregistrer un brouillon. */
  readonly canSave = computed(() => this._name().trim().length > 0);

  /**
   * `true` si la stratégie peut être backtestée ou envoyée au bot : aucune
   * anomalie bloquante, et au moins un côté à évaluer. Le verdict serveur
   * (`BotService.validateStrategy`) reste requis par-dessus.
   */
  readonly canAttach = computed(() => {
    const rules = pruneEmptyRuleBranches(this._rules());
    return this.blockingIssues().length === 0 && (!!rules.long || !!rules.short);
  });

  open(document: StrategyDocument): void {
    this._document.set(document);
    this._name.set(document.name);
    this._rules.set(document.rules);
    this._editedPaths.set([]);
    this._history.set([]);
    this._focusedPath.set(null);
    this._serverIssues.set([]);
  }

  /** Enregistre le verdict du bot. Un tableau vide efface le précédent. */
  setServerIssues(issues: readonly PublicStrategyValidationIssue[]): void {
    this._serverIssues.set([...issues]);
  }

  setName(name: string): void {
    this._name.set(name);
  }

  /** Crée ou remplace une branche entière (`rules.long.entry`, `rules.short.exit`...). */
  setBranch(branchPath: string, group: LogicalGroup | undefined): void {
    const [, side, branch] = branchPath.split('.');
    const rules = this._rules();

    if (group === undefined) {
      this.commit(removeAtPath(rules, branchPath), branchPath);
      return;
    }

    if (rules[side as 'long' | 'short'] !== undefined) {
      this.commit(replaceAtPath(rules, branchPath, group), branchPath);
      return;
    }

    // Côté encore inexistant : `entry` étant obligatoire dans `SideRules`,
    // ouvrir `exit` en premier impose de créer les deux d'un coup — l'`entry`
    // vide reste un `LogicalGroup` valide, seule la validation le signalera.
    const side_ = {
      entry: branch === 'entry' ? group : createLogicalGroup(),
      ...(branch === 'exit' ? { exit: group } : {}),
    };
    this.commit(replaceAtPath(rules, `rules.${side}`, side_), branchPath);
  }

  addCondition(groupPath: string, node: RuleNode): void {
    const rules = this._rules();
    const next = appendCondition(rules, groupPath, node);
    if (next === rules) return;

    const group = getAtPath(next, groupPath);
    const index = isLogicalGroup(group) ? group.conditions.length - 1 : 0;
    this.commit(next, childPath(`${groupPath}.conditions`, index));
  }

  replaceNode(path: string, node: RuleNode): void {
    this.commit(replaceAtPath(this._rules(), path, node), path);
  }

  /**
   * Supprime un nœud, puis **oublie** les chemins édités situés sous le même
   * parent.
   *
   * Une suppression dans un tableau décale les index suivants : un chemin
   * mémorisé comme « édité ici » désignerait alors un autre nœud, et pourrait
   * faire bloquer à tort un nœud hérité qui vient d'y glisser. Les oublier
   * fait perdre un peu de précision, mais dans le sens sûr — au pire une
   * anomalie part au verdict du serveur au lieu d'être tranchée ici.
   */
  removeNode(path: string): void {
    const rules = this._rules();
    const next = removeAtPath(rules, path);
    if (next === rules) return;

    const parent = parentPath(path);
    const kept = parent
      ? this._editedPaths().filter((edited) => !isPathInside(edited, parent))
      : [];

    this.pushHistory();
    this._rules.set(next);
    this._editedPaths.set(kept);
  }

  undo(): void {
    const history = this._history();
    const previous = history.at(-1);
    if (!previous) return;

    this._history.set(history.slice(0, -1));
    this._rules.set(previous.rules);
    this._editedPaths.set(previous.editedPaths);
  }

  /** Document prêt à être enregistré : nom courant, règles élaguées. */
  toDocument(): StrategyDocument | null {
    const document = this._document();
    if (!document) return null;

    return {
      ...document,
      name: this._name().trim(),
      rules: pruneEmptyRuleBranches(this._rules()),
    };
  }

  private commit(next: StrategyRules, editedPath: string): void {
    if (next === this._rules()) return;

    this.pushHistory();
    this._rules.set(next);
    this._editedPaths.update((paths) =>
      paths.includes(editedPath) ? paths : [...paths, editedPath],
    );
    this.dropServerIssuesUnder(editedPath);
  }

  /**
   * Oublie les anomalies portant sur le sous-arbre qu'on vient de modifier.
   *
   * Le verdict du bot décrivait un arbre qui n'existe plus à cet endroit :
   * continuer à signaler la ligne laisserait croire que la correction n'a pas
   * pris. Les anomalies des autres branches, elles, restent valables et restent
   * affichées — c'est ce qui permet de les corriger une par une.
   */
  private dropServerIssuesUnder(editedPath: string): void {
    const issues = this._serverIssues();
    if (issues.length === 0) return;

    const kept = issues.filter((issue) => {
      const local = toLocalIssuePath(issue.path);
      return !local || !isPathInside(local, editedPath);
    });

    if (kept.length !== issues.length) this._serverIssues.set(kept);
  }

  private pushHistory(): void {
    this._history.update((history) => [
      ...history.slice(-19),
      { rules: this._rules(), editedPaths: this._editedPaths() },
    ]);
  }
}
