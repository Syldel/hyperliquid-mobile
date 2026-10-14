import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { ToastController } from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { UserService } from '@services/user.service';
import type { ExternalUser, IExchange } from '@syldel/trading-shared-types';
import { of, throwError } from 'rxjs';
import { BotStrategiesPage } from './bot-strategies.page';

/**
 * Ce que ce fichier garde : **une sauvegarde refusée ne doit pas emporter les
 * suivantes.**
 *
 * Le tuyau d'écriture était `save$.pipe(debounceTime, switchMap(patch))` sans
 * aucun `catchError`. Une erreur de l'observable interne remonte à l'abonné, et
 * un abonné sans gestionnaire d'erreur **termine** : après un seul `PATCH` en
 * échec, tout changement ultérieur partait dans le vide, sans le moindre
 * signe — l'interrupteur allumé à l'écran, le compte inchangé. Et
 * `ion-router-outlet` gardant la page vivante, quitter l'écran et revenir ne
 * la ressuscitait pas.
 *
 * C'est l'écran qui arme les paires du bot : la défaillance muette y coûte une
 * position prise sur une configuration que l'utilisateur croit enregistrée.
 */
const SETTINGS = {
  hyperliquid: { name: 'hyperliquid', enabled: false, pairs: [] },
} as unknown as Record<string, IExchange>;

describe('BotStrategiesPage when the account refuses a save', () => {
  let page: BotStrategiesPage;
  let toastCtrl: { messages: string[] };
  let sent: Record<string, IExchange>[];
  let failWith: HttpErrorResponse | null;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    failWith = null;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: UserService,
          useValue: {
            getMe: () => of({ tradingSettings: SETTINGS }),
            updateStrategy: (tradingSettings: Record<string, IExchange>) => {
              sent.push(tradingSettings);
              // Le double rend ce que le vrai rend : un observable qui échoue,
              // et non une exception levée à l'appel.
              return failWith ? throwError(() => failWith) : of({});
            },
          },
        },
        {
          provide: BotService,
          useValue: {
            exitBehaviorLabels: () => ({}),
            strategiesByExchange: () => null,
            getExchangeFormMetadata: () => of({}),
          },
        },
        {
          provide: HyperliquidMarketService,
          useValue: { getPerpDexs: () => of([]), getPerpMeta: () => of({ universe: [] }) },
        },
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
      ],
    });

    toastCtrl = TestBed.inject(ToastController) as unknown as typeof toastCtrl;
    toastCtrl.messages.length = 0;

    page = TestBed.runInInjectionContext(() => new BotStrategiesPage());
    page.user.set({ tradingSettings: SETTINGS } as ExternalUser);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Le vrai geste : basculer l'interrupteur d'un exchange, debounce compris. */
  function toggle(enabled: boolean): void {
    page.onExchangeToggle('hyperliquid', enabled);
    vi.advanceTimersByTime(1000);
  }

  const refusal = (status: number) => new HttpErrorResponse({ status, statusText: 'Error' });

  it('keeps saving after the account has refused once', () => {
    failWith = refusal(500);
    toggle(true);
    expect(sent).toHaveLength(1);

    failWith = null;
    toggle(false);

    // Le cœur de la régression : sans `catchError` **dans** le `switchMap`, la
    // souscription était terminée et ce second envoi n'atteignait jamais le
    // service.
    expect(sent).toHaveLength(2);
  });

  it('says that the change did not reach the account', () => {
    failWith = refusal(500);

    toggle(true);

    expect(toastCtrl.messages.at(-1)).toMatch(/not saved/i);
    // Le motif, et ce que le compte tient encore : un « ça a échoué » sans
    // conséquence laisse croire que l'écran, lui, est à jour.
    expect(toastCtrl.messages.at(-1)).toMatch(/server error \(500\)/i);
    expect(toastCtrl.messages.at(-1)).toMatch(/previous settings/i);
  });

  it('names an unreachable service rather than accusing the request', () => {
    // Statut 0 : on n'a pas pu lui parler. Le motif vient d'`extractErrorMessage`,
    // partagé avec les écrans d'ordres, pour qu'un même échec s'énonce pareil.
    failWith = refusal(0);

    toggle(true);

    expect(toastCtrl.messages.at(-1)).toMatch(/network error/i);
  });

  it('announces each refusal, and not only the first', () => {
    // Se taire au deuxième échec ferait lire un succès là où il n'y en a pas.
    // C'est l'inverse du dédoublonnage des refus d'intervalle du chart, qui,
    // lui, se répétait sans qu'aucun geste de l'utilisateur ne le provoque.
    failWith = refusal(500);
    toggle(true);
    toggle(false);

    expect(toastCtrl.messages).toHaveLength(2);
  });

  it('stays quiet when the save goes through', () => {
    toggle(true);

    expect(sent).toHaveLength(1);
    expect(toastCtrl.messages).toEqual([]);
  });

  it('sends nothing before the debounce has elapsed', () => {
    // Le debounce est ce qui évite un PATCH par cran d'interrupteur ; un test
    // qui avancerait toujours l'horloge ne dirait pas qu'il existe.
    page.onExchangeToggle('hyperliquid', true);
    vi.advanceTimersByTime(999);
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
  });
});
