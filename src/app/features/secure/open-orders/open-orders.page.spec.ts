import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { AuthService } from '@auth/auth.service';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { firstValueFrom, Observable, of } from 'rxjs';
import { OpenOrdersPage } from './open-orders.page';

/**
 * Combien de fois la page lit les ordres ouverts — `frontendOpenOrders`, 20 de poids sur l'IP que le
 * gateway partage avec le bot de trading.
 *
 * `RefreshableLayoutComponent` recharge à chaque nouvelle `fetchFn` : c'est donc elle qu'on compte. Le
 * premier passage la reconstruisait deux fois — à la sélection des dex, puis dans `ionViewWillEnter` —
 * et la requête partait deux fois (mesuré le 2026-11-15, 4 ms d'écart).
 */
describe('OpenOrdersPage — reading the open orders', () => {
  let page: OpenOrdersPage;
  let reads: number;
  let lastFetchFn: unknown;

  /** Le nombre de chargements que le layout aurait lancés depuis le dernier appel. */
  const reloadsSinceLastCheck = () => {
    const current = page.fetchFn();
    const changed = current !== lastFetchFn ? 1 : 0;
    lastFetchFn = current;
    return changed;
  };

  /** Ce que fait le layout : appeler la fonction de chargement en cours. */
  const runLoad = async () => {
    const result = page.fetchFn()();
    await firstValueFrom(result as Observable<unknown>);
  };

  beforeEach(() => {
    reads = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: HyperliquidInfoService,
          useValue: {
            getFrontendOpenOrders: () => {
              reads++;
              return of([]);
            },
          },
        },
        { provide: HyperliquidMarketService, useValue: {} },
        { provide: AppLifecycleService, useValue: { foregroundCount: signal(0) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: AuthService, useValue: {} },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
      ],
    });
    page = TestBed.runInInjectionContext(() => new OpenOrdersPage());
    lastFetchFn = page.fetchFn();
  });

  // L'ordre mesuré dans le navigateur : la sélection restaurée, puis le hook d'entrée.
  // Compté après **chaque** étape : deux reconstructions successives ne laissent voir que la dernière.
  it('loads once on first entry when the dex selection comes first', async () => {
    page.onSelectionChanged(['']);
    let reloads = reloadsSinceLastCheck();
    page.ionViewWillEnter();
    reloads += reloadsSinceLastCheck();

    expect(reloads).toBe(1);
    await runLoad();
    expect(reads).toBe(1);
  });

  // L'ordre possible sur un téléphone, où le stockage répond plus lentement.
  it('loads once on first entry when the dex selection comes after', async () => {
    page.ionViewWillEnter();
    let reloads = reloadsSinceLastCheck();
    page.onSelectionChanged(['']);
    reloads += reloadsSinceLastCheck();

    expect(reloads).toBe(1);
    await runLoad();
    expect(reads).toBe(1);
  });

  // Le retour depuis le détail d'un ordre : il a pu être modifié ou annulé, la liste doit le montrer.
  it('reads the orders again when coming back to the page', () => {
    page.onSelectionChanged(['']);
    page.ionViewWillEnter();
    reloadsSinceLastCheck();

    page.ionViewWillEnter();

    expect(reloadsSinceLastCheck()).toBe(1);
  });
});
