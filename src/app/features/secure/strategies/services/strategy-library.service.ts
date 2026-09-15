import { inject, Injectable, signal } from '@angular/core';
import { AuthService } from '@auth/auth.service';
import { StorageService } from '@storage/storage.service';
import { filter, firstValueFrom } from 'rxjs';
import type { StrategyRules } from '@syldel/trading-shared-types';
import { pruneEmptyRuleBranches } from '../domain/strategy-tree.ops';
import {
  STRATEGY_DOCUMENT_SCHEMA_VERSION,
  type StrategyDocument,
} from '../models/strategy-document.model';

/**
 * ============================================================================
 * 📚 STRATEGY LIBRARY
 * Bibliothèque unique des stratégies construites dans l'app.
 *
 * Scopée par adresse de wallet, même patron de stockage que `WatchlistService`
 * (`Record<address, T[]>` dans un seul enregistrement Preferences) : les
 * stratégies finissent sur des paires du bot, elles-mêmes rattachées à un
 * compte.
 *
 * Point structurant : une stratégie vit **ici et nulle part ailleurs**. Un
 * chart de la watchlist n'en garde qu'une référence (`strategyId`), jamais une
 * copie — modifier une stratégie la met à jour partout où elle est attachée,
 * plutôt que de laisser des copies diverger en silence.
 * ============================================================================
 */

type StrategyLibraryStorage = Record<string, StrategyDocument[]>;

@Injectable({ providedIn: 'root' })
export class StrategyLibraryService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);

  private readonly _documents = signal<StrategyDocument[]>([]);
  readonly documents = this._documents.asReadonly();

  private readonly STORAGE_KEY = 'strategy_library';

  /**
   * Adresse du wallet une fois la session restaurée.
   *
   * `currentAddress()` vaut `null` dans deux situations qui n'ont rien à voir :
   * la restauration n'a pas encore eu lieu (`AuthService.restoreSession` lit le
   * stockage de façon asynchrone), ou personne n'est connecté. Les confondre
   * faisait répondre « aucune stratégie » pendant le battement qui suit une
   * reprise de session — un mensonge qui ressemble à une réponse, et qu'aucun
   * écran ne pouvait distinguer d'une bibliothèque réellement vide.
   *
   * Même distinction que `pair-strategy-status.util.ts` fait entre « pas de
   * shortname » et « catalogue pas encore arrivé » : tant que la source n'a pas
   * répondu, on ne conclut pas.
   */
  private async walletAddress(): Promise<string | null> {
    await firstValueFrom(this.auth.ready$.pipe(filter(Boolean)));
    return this.auth.currentAddress();
  }

  async load(): Promise<StrategyDocument[]> {
    const address = await this.walletAddress();
    const all = (await this.storage.get<StrategyLibraryStorage>(this.STORAGE_KEY)) ?? {};

    // Pas de wallet : il n'y a pas de bibliothèque à montrer, et surtout pas
    // celle du wallet précédent — sortir sans toucher à `_documents` la
    // laissait affichée, et `getById` continuait de la servir à la watchlist.
    const documents = address ? (all[address] ?? []) : [];
    this._documents.set(documents);
    return documents;
  }

  getById(id: string): StrategyDocument | undefined {
    return this._documents().find((document) => document.id === id);
  }

  /**
   * Ajoute les documents dont l'`id` est encore absent, sans jamais écraser un
   * document existant.
   *
   * Destinée à la reprise de données (`migrateLegacyWatchlistStrategies`) :
   * relancer la migration ne doit pas remplacer une stratégie que
   * l'utilisateur aurait éditée entre-temps. Ne réécrit rien si tout est déjà
   * présent.
   */
  async importMissing(documents: readonly StrategyDocument[]): Promise<StrategyDocument[]> {
    const known = new Set(this._documents().map((document) => document.id));
    const added = documents.filter((document) => !known.has(document.id));
    if (added.length === 0) return [];

    await this.persist([...this._documents(), ...added]);
    return added;
  }

  /** Crée et persiste une stratégie neuve, éventuellement pré-remplie. */
  async create(name: string, rules: StrategyRules = {}): Promise<StrategyDocument> {
    const now = Date.now();
    const document: StrategyDocument = {
      id: generateStrategyId(),
      name: name.trim(),
      rules,
      createdAt: now,
      updatedAt: now,
      schemaVersion: STRATEGY_DOCUMENT_SCHEMA_VERSION,
    };

    await this.persist([...this._documents(), document]);
    return document;
  }

  /**
   * Enregistre une stratégie éditée. N'échoue jamais sur une stratégie
   * incomplète : un brouillon est sauvegardable, seule sa mise en service
   * (attacher à un chart, envoyer au bot) exige une validation.
   *
   * `schemaVersion` n'est jamais rabaissé : un document ouvert depuis un build
   * plus récent conserve le sien, pour continuer à se déclarer honnêtement
   * comme potentiellement au-delà de ce que ce build sait interpréter.
   */
  async save(document: StrategyDocument): Promise<StrategyDocument> {
    const updated: StrategyDocument = {
      ...document,
      name: document.name.trim(),
      rules: pruneEmptyRuleBranches(document.rules),
      updatedAt: Date.now(),
      schemaVersion: Math.max(document.schemaVersion, STRATEGY_DOCUMENT_SCHEMA_VERSION),
    };

    const documents = this._documents();
    const index = documents.findIndex((candidate) => candidate.id === updated.id);
    const next =
      index === -1
        ? [...documents, updated]
        : documents.map((candidate) => (candidate.id === updated.id ? updated : candidate));

    await this.persist(next);
    return updated;
  }

  async rename(id: string, name: string): Promise<void> {
    const document = this.getById(id);
    if (!document) return;
    await this.save({ ...document, name });
  }

  /**
   * Copie une stratégie sous un nouvel `id`. Les règles sont partagées par
   * référence : elles ne sont jamais mutées en place (voir strategy-tree.ops.ts),
   * donc éditer la copie ne touchera pas l'originale.
   */
  async duplicate(id: string, name?: string): Promise<StrategyDocument | null> {
    const source = this.getById(id);
    if (!source) return null;

    const now = Date.now();
    const copy: StrategyDocument = {
      ...source,
      id: generateStrategyId(),
      name: (name ?? `${source.name} (copy)`).trim(),
      createdAt: now,
      updatedAt: now,
    };

    await this.persist([...this._documents(), copy]);
    return copy;
  }

  async remove(id: string): Promise<void> {
    await this.persist(this._documents().filter((document) => document.id !== id));
  }

  /**
   * Écrit la bibliothèque du wallet courant, ou **lève**.
   *
   * Sortir en silence faute de wallet laissait `save` rendre un document que
   * l'appelant annonçait comme enregistré, et qui n'existait nulle part. Dans
   * une app qui finit par confier ces règles à un bot, une écriture qui
   * n'arrive pas doit se voir tout de suite — au moment où l'utilisateur peut
   * encore réessayer, pas quand la stratégie a disparu.
   *
   * `_documents` n'est mis à jour qu'**après** l'écriture : annoncer en mémoire
   * un changement que le stockage n'a pas pris serait le même mensonge, en
   * plus discret. `getById` sert la watchlist depuis cette liste.
   */
  private async persist(documents: StrategyDocument[]): Promise<void> {
    const address = await this.walletAddress();
    if (!address) {
      throw new Error('No wallet selected: the strategy library has nowhere to write.');
    }

    const all = (await this.storage.get<StrategyLibraryStorage>(this.STORAGE_KEY)) ?? {};
    all[address] = documents;

    await this.storage.set(this.STORAGE_KEY, all);
    this._documents.set(documents);
  }
}

let idSequence = 0;

/**
 * Identifiant stable d'une stratégie. `crypto.randomUUID` quand il est
 * disponible ; sinon horodatage + compteur, comme `generateHlineId`
 * (indicator-hline-defaults.util.ts). Le repli suffit ici : cet id n'a
 * besoin d'être unique que dans une bibliothèque locale.
 */
export function generateStrategyId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `st_${crypto.randomUUID()}`;
  }

  idSequence += 1;
  return `st_${Date.now().toString(36)}_${idSequence}`;
}
