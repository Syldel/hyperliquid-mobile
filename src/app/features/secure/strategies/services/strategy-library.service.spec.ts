import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { StorageService } from '@storage/storage.service';
import type { LogicalGroup, StrategyRules } from '@syldel/trading-shared-types';
import { StrategyLibraryService } from './strategy-library.service';

/** Preferences en mémoire — le comportement testé est celui du service, pas du plugin. */
class StorageStub {
  readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
}

const WALLET_A = '0xaaa';
const WALLET_B = '0xbbb';

const filledGroup: LogicalGroup = {
  type: 'logical',
  operator: 'AND',
  conditions: [
    {
      type: 'comparison',
      left: { type: 'price', field: 'close' },
      operator: 'GT',
      right: { type: 'number', value: 1 },
    },
  ],
};

const emptyGroup: LogicalGroup = { type: 'logical', operator: 'AND', conditions: [] };

describe('StrategyLibraryService', () => {
  let service: StrategyLibraryService;
  let storage: StorageStub;
  let address: string | null;

  beforeEach(() => {
    storage = new StorageStub();
    address = WALLET_A;

    TestBed.configureTestingModule({
      providers: [
        StrategyLibraryService,
        { provide: StorageService, useValue: storage },
        { provide: AuthService, useValue: { currentAddress: () => address } },
      ],
    });

    service = TestBed.inject(StrategyLibraryService);
  });

  it('creates, exposes and reloads a document', async () => {
    const created = await service.create('Breakout');

    expect(created.id).toMatch(/^st_/);
    expect(created.schemaVersion).toBe(1);
    expect(service.documents()).toEqual([created]);

    const reloaded = await service.load();
    expect(reloaded).toEqual([created]);
  });

  it('scopes the library by wallet address', async () => {
    await service.create('For A');

    address = WALLET_B;
    expect(await service.load()).toEqual([]);

    await service.create('For B');
    expect(service.documents().map((d) => d.name)).toEqual(['For B']);

    address = WALLET_A;
    expect((await service.load()).map((d) => d.name)).toEqual(['For A']);
  });

  it('persists nothing when no wallet is selected', async () => {
    address = null;
    await service.create('Orphan');

    expect(storage.store.size).toBe(0);
  });

  it('updates an existing document in place and bumps updatedAt', async () => {
    const created = await service.create('Draft');
    const rules: StrategyRules = { long: { entry: filledGroup } };

    const saved = await service.save({ ...created, name: '  Renamed  ', rules });

    expect(service.documents()).toHaveLength(1);
    expect(saved.name).toBe('Renamed');
    expect(saved.rules).toEqual(rules);
    expect(saved.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    expect(saved.createdAt).toBe(created.createdAt);
  });

  // Décision « brouillon autorisé » : enregistrer n'échoue jamais, mais une
  // branche restée vide n'est pas écrite.
  it('saves an incomplete strategy, pruning the branches left empty', async () => {
    const created = await service.create('Draft');

    const saved = await service.save({
      ...created,
      rules: { long: { entry: filledGroup, exit: emptyGroup }, short: { entry: emptyGroup } },
    });

    expect(saved.rules.short).toBeUndefined();
    expect(saved.rules.long!.entry).toBe(filledGroup);
    expect('exit' in saved.rules.long!).toBe(false);
  });

  it('never lowers a schemaVersion written by a newer build', async () => {
    const created = await service.create('From the future');

    const saved = await service.save({ ...created, schemaVersion: 7 });
    expect(saved.schemaVersion).toBe(7);
  });

  it('duplicates under a fresh id without touching the source', async () => {
    const source = await service.save({
      ...(await service.create('Original')),
      rules: { long: { entry: filledGroup } },
    });

    const copy = await service.duplicate(source.id);

    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(source.id);
    expect(copy!.name).toBe('Original (copy)');
    expect(copy!.rules).toEqual(source.rules);
    expect(service.getById(source.id)!.name).toBe('Original');
  });

  it('returns null when duplicating an unknown id', async () => {
    expect(await service.duplicate('nope')).toBeNull();
  });

  it('renames and removes', async () => {
    const created = await service.create('Old name');

    await service.rename(created.id, 'New name');
    expect(service.getById(created.id)!.name).toBe('New name');

    await service.remove(created.id);
    expect(service.documents()).toEqual([]);
    expect(await service.load()).toEqual([]);
  });

  it('leaves other wallets untouched when persisting', async () => {
    await service.create('For A');

    address = WALLET_B;
    await service.load();
    await service.create('For B');

    const all = storage.store.get('strategy_library') as Record<string, unknown[]>;
    expect(all[WALLET_A]).toHaveLength(1);
    expect(all[WALLET_B]).toHaveLength(1);
  });
});

describe('StrategyLibraryService.importMissing', () => {
  let service: StrategyLibraryService;
  let storage: StorageStub;

  beforeEach(() => {
    storage = new StorageStub();

    TestBed.configureTestingModule({
      providers: [
        StrategyLibraryService,
        { provide: StorageService, useValue: storage },
        { provide: AuthService, useValue: { currentAddress: () => WALLET_A } },
      ],
    });

    service = TestBed.inject(StrategyLibraryService);
  });

  const imported = {
    id: 's1',
    name: 'Recovered',
    rules: { long: { entry: filledGroup } },
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 1,
  };

  it('adds documents that are not there yet', async () => {
    expect(await service.importMissing([imported])).toHaveLength(1);
    expect(service.getById('s1')!.name).toBe('Recovered');
  });

  // Rejouer la migration ne doit pas écraser une stratégie éditée entre-temps.
  it('never overwrites an existing id, and writes nothing when all are known', async () => {
    await service.importMissing([imported]);
    await service.rename('s1', 'Edited since');

    expect(await service.importMissing([imported])).toEqual([]);
    expect(service.getById('s1')!.name).toBe('Edited since');
    expect(service.documents()).toHaveLength(1);
  });
});
