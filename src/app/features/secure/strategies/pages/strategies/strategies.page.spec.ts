import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
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
