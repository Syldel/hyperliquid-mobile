import { TestBed } from '@angular/core/testing';
import { ActionSheetController, ToastController } from '@ionic/angular/standalone';
import type { StrategyDocument } from '../../models/strategy-document.model';
import { StrategyLibraryService } from '../../services/strategy-library.service';
import { StrategiesPage } from './strategies.page';

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
