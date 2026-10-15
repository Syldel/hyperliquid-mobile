import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular/standalone';
import type { StrategyDocument } from '../../models/strategy-document.model';
import { StrategyLibraryService } from '../../services/strategy-library.service';
import { StrategiesPage, importSummary } from './strategies.page';

/**
 * La page est testée pour un seul point : ce qu'elle fait quand la
 * bibliothèque **refuse** d'écrire.
 *
 * `persist` levait jadis en silence (aucun wallet sélectionné) et rendait la
 * main comme si de rien n'était. Maintenant qu'elle lève, ne rien attraper
 * ferait pire que l'ancien défaut : une promesse rejetée, un geste sans effet,
 * et aucun message. Une suppression qui paraît avoir eu lieu se refait.
 */
const document: StrategyDocument = {
  id: 'st_1',
  name: 'Breakout',
  rules: {},
  createdAt: 1,
  updatedAt: 1,
  schemaVersion: 1,
};

describe('StrategiesPage when the library refuses to write', () => {
  let page: StrategiesPage;
  let toastCtrl: { messages: string[] };
  let libraryFails: boolean;
  let sheetRole: string;

  beforeEach(() => {
    libraryFails = false;
    sheetRole = 'cancel';

    TestBed.configureTestingModule({
      providers: [
        {
          provide: StrategyLibraryService,
          useValue: {
            documents: () => [],
            load: async () => [],
            create: async () => {
              if (libraryFails) throw new Error('no wallet');
              return document;
            },
            duplicate: async () => {
              if (libraryFails) throw new Error('no wallet');
              return document;
            },
            remove: async () => {
              if (libraryFails) throw new Error('no wallet');
            },
          },
        },
        {
          // Le double d'Ionic rend toujours le rôle `cancel` : on le remplace
          // pour pouvoir jouer un choix réel dans la feuille d'actions.
          provide: ActionSheetController,
          useValue: {
            create: async () => ({
              present: async () => {},
              onDidDismiss: async () => ({ role: sheetRole }),
            }),
          },
        },
      ],
    });

    toastCtrl = TestBed.inject(ToastController) as unknown as typeof toastCtrl;
    toastCtrl.messages.length = 0;

    page = TestBed.runInInjectionContext(() => new StrategiesPage());
  });

  it('says so when a strategy cannot be created', async () => {
    libraryFails = true;

    await page.create();

    expect(toastCtrl.messages.at(-1)).toMatch(/could not be written/i);
  });

  it('says so when a deletion cannot be written', async () => {
    libraryFails = true;
    sheetRole = 'destructive';

    await page.openActions(document, new Event('click'));

    expect(toastCtrl.messages.at(-1)).toMatch(/could not be written/i);
  });

  // Le chemin normal ne doit pas se mettre à crier pour autant.
  it('stays quiet when the write goes through', async () => {
    sheetRole = 'duplicate';

    await page.openActions(document, new Event('click'));

    expect(toastCtrl.messages).toEqual([]);
  });
});

/**
 * Le second point, trouvé à l'usage le 2026-10-14 : une stratégie créée dans
 * une bibliothèque **vide** n'apparaissait qu'après un tirer-pour-rafraîchir.
 *
 * La page écrivait dans son propre signal pendant que `RefreshableLayoutComponent`
 * gardait le sien, et c'est la mise en page qui décide d'afficher « No strategy
 * yet » ou le contenu projeté. La liste était donc bien construite, sous un
 * `@if` resté faux.
 *
 * D'où un test qui **monte** la page avec sa vraie mise en page : la version
 * sans DOM de ce fichier ne pouvait pas voir le défaut, puisqu'il naît de la
 * rencontre des deux copies.
 */
describe('StrategiesPage after a write', () => {
  const stored: StrategyDocument[] = [];
  let sheetRole: string;

  beforeEach(() => {
    stored.length = 0;
    sheetRole = 'cancel';

    TestBed.configureTestingModule({
      imports: [StrategiesPage],
      providers: [
        {
          provide: StrategyLibraryService,
          useValue: {
            documents: () => [...stored],
            load: async () => [...stored],
            create: async () => {
              stored.push(document);
              return document;
            },
            duplicate: async () => document,
            remove: async () => {
              stored.length = 0;
            },
          },
        },
        {
          provide: ActionSheetController,
          useValue: {
            create: async () => ({
              present: async () => {},
              onDidDismiss: async () => ({ role: sheetRole }),
            }),
          },
        },
        // La mise en page injecte le service d'authentification pour un écran
        // que celui-ci n'utilise pas (`requiresAuth` reste faux).
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
      ],
    });
  });

  async function mount(): Promise<{
    host: HTMLElement;
    page: StrategiesPage;
    settle: () => Promise<void>;
  }> {
    const fixture = TestBed.createComponent(StrategiesPage);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    return { host: fixture.nativeElement as HTMLElement, page: fixture.componentInstance, settle };
  }

  it('shows the first strategy without waiting for a pull-to-refresh', async () => {
    const { host, page, settle } = await mount();

    expect(host.textContent).toContain('No strategy yet');

    await page.create();
    await settle();

    expect(host.querySelectorAll('ion-item')).toHaveLength(1);
    expect(host.textContent).toContain('Breakout');
    expect(host.textContent).not.toContain('No strategy yet');
  });

  it('says the library is empty again once the last strategy is deleted', async () => {
    // Le même défaut en miroir : la liste vidée laissait un écran blanc, sans
    // le message d'absence, parce que la mise en page croyait avoir des données.
    const { host, page, settle } = await mount();
    await page.create();
    await settle();

    // Le double d'Ionic rend toujours `cancel` : on joue la suppression.
    sheetRole = 'destructive';
    await page.openActions(document, new Event('click'));
    await settle();

    expect(host.querySelectorAll('ion-item')).toHaveLength(0);
    expect(host.textContent).toContain('No strategy yet');
  });
});

/**
 * Le troisième point : **ce qui entre par le presse-papier ne doit ni écraser,
 * ni disparaître en silence.**
 *
 * La bibliothèque vit en stockage local et n'a pas d'autre copie. Un import
 * vient d'un texte étranger — écrit par une IA, recollé d'un autre appareil —
 * et c'est exactement le moment où un écrasement coûte le travail de
 * l'utilisateur, et où un abandon muet lui fait croire que tout est passé.
 */
describe('StrategiesPage importing from the clipboard', () => {
  let page: StrategiesPage;
  let toastCtrl: { messages: string[] };
  let written: StrategyDocument[][];
  let pasted: string | null;
  let alertRole: string;

  const stored: StrategyDocument = {
    id: 'st_1',
    name: 'Breakout',
    rules: {},
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 1,
  };

  beforeEach(() => {
    written = [];
    pasted = null;
    alertRole = 'confirm';

    TestBed.configureTestingModule({
      providers: [
        {
          provide: StrategyLibraryService,
          useValue: {
            documents: () => [stored],
            load: async () => [stored],
            importMissing: async (documents: StrategyDocument[]) => {
              written.push(documents);
              return documents;
            },
          },
        },
        {
          provide: AlertController,
          useValue: {
            create: async () => ({
              present: async () => {},
              onDidDismiss: async () => ({
                data: pasted === null ? undefined : { values: { json: pasted } },
                role: alertRole,
              }),
            }),
          },
        },
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
      ],
    });

    toastCtrl = TestBed.inject(ToastController) as unknown as typeof toastCtrl;
    toastCtrl.messages.length = 0;

    page = TestBed.runInInjectionContext(() => new StrategiesPage());
    page.documents.set([stored]);
  });

  it('writes a strategy whose id is free, and says so', async () => {
    pasted = JSON.stringify({ id: 'st_2', name: 'Fresh', rules: { long: {} } });

    await page.pasteImport();

    expect(written[0]?.map((d) => d.id)).toEqual(['st_2']);
    expect(toastCtrl.messages.at(-1)).toContain('1 imported');
  });

  it('never overwrites a stored strategy that shares an id', async () => {
    /**
     * Le cas qui coûte cher : même `id`, contenu différent. L'entrant devient
     * une copie, et le document en bibliothèque n'est pas réécrit.
     */
    pasted = JSON.stringify({ id: 'st_1', name: 'Breakout rewritten', rules: { short: {} } });

    await page.pasteImport();

    expect(written[0]).toHaveLength(1);
    expect(written[0]?.[0]?.id).not.toBe('st_1');
    expect(written[0]?.[0]?.name).toContain('(imported)');
    expect(toastCtrl.messages.at(-1)).toContain('their id was taken');
  });

  it('writes nothing when the paste is already in the library', async () => {
    pasted = JSON.stringify(stored);

    await page.pasteImport();

    expect(written).toEqual([]);
    expect(toastCtrl.messages.at(-1)).toContain('already there');
  });

  it('names what it refused instead of counting it out', async () => {
    // « 1 imported » tout court laisserait chercher ce qu'est devenue l'autre.
    pasted = JSON.stringify([{ id: 'st_3', name: 'Good', rules: {} }, { name: 'No rules' }]);

    await page.pasteImport();

    expect(toastCtrl.messages.at(-1)).toContain('1 imported');
    expect(toastCtrl.messages.at(-1)).toContain('carries no rules');
  });

  it('says the clipboard held no JSON rather than staying quiet', async () => {
    pasted = 'definitely not json';

    await page.pasteImport();

    expect(written).toEqual([]);
    expect(toastCtrl.messages.at(-1)).toContain('does not contain valid JSON');
  });

  it('does nothing at all when the alert is dismissed', async () => {
    alertRole = 'cancel';
    pasted = JSON.stringify({ id: 'st_4', name: 'Ignored', rules: {} });

    await page.pasteImport();

    expect(written).toEqual([]);
    expect(toastCtrl.messages).toEqual([]);
  });

  it('says so when the library cannot be written', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: StrategyLibraryService,
          useValue: {
            documents: () => [],
            load: async () => [],
            importMissing: async () => {
              throw new Error('no wallet');
            },
          },
        },
        {
          provide: AlertController,
          useValue: {
            create: async () => ({
              present: async () => {},
              onDidDismiss: async () => ({
                data: { values: { json: JSON.stringify({ name: 'X', rules: {} }) } },
                role: 'confirm',
              }),
            }),
          },
        },
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
      ],
    });
    const failing = TestBed.inject(ToastController) as unknown as typeof toastCtrl;
    failing.messages.length = 0;
    const brokenPage = TestBed.runInInjectionContext(() => new StrategiesPage());

    await brokenPage.pasteImport();

    expect(failing.messages.at(-1)).toContain('could not be written');
  });
});

describe('importSummary', () => {
  const decision = (outcome: 'added' | 'copied' | 'already-present') => ({
    document: { id: 'x', name: 'n', rules: {}, createdAt: 0, updatedAt: 0, schemaVersion: 1 },
    outcome,
    originalName: 'n',
  });

  it('counts each outcome apart, because they are not the same news', () => {
    const line = importSummary(
      [decision('added'), decision('copied'), decision('already-present')],
      [],
    );

    expect(line).toContain('1 imported');
    expect(line).toContain('1 kept as a copy');
    expect(line).toContain('1 already there');
  });

  it('keeps the refusals verbatim rather than summing them', () => {
    expect(importSummary([], ['Entry 2 has no name.'])).toContain('Entry 2 has no name.');
  });

  it('says plainly when nothing came in', () => {
    expect(importSummary([], [])).toBe('Nothing imported.');
  });
});
