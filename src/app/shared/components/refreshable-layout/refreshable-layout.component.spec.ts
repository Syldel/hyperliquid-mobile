import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { RefreshableLayoutComponent } from './refreshable-layout.component';

/**
 * Le tirer-pour-rafraîchir peut faire plus que le chargement ordinaire : sur le chart de watchlist-detail,
 * il passe les caches (bougies du mobile et du bot, ordres du compte). Un geste « rafraîchir » qui
 * resservirait le cache ne rafraîchirait rien.
 */
describe('RefreshableLayoutComponent — pull to refresh', () => {
  const pull = () =>
    ({ target: { complete: vi.fn() } }) as unknown as CustomEvent & {
      target: { complete: ReturnType<typeof vi.fn> };
    };

  const create = (refreshFn: (() => Promise<string>) | null) => {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { isLoggedIn: () => true } }],
    });
    const fixture = TestBed.createComponent(RefreshableLayoutComponent<string>);
    const fetchFn = vi.fn(async () => 'cached');
    fixture.componentRef.setInput('title', 'Chart');
    fixture.componentRef.setInput('fetchFn', fetchFn);
    fixture.componentRef.setInput('refreshFn', refreshFn);
    fixture.detectChanges();
    fetchFn.mockClear(); // le premier chargement, à la création, ne nous concerne pas ici
    return { component: fixture.componentInstance, fetchFn };
  };

  it('runs the refresh function when one is given, not the ordinary fetch', async () => {
    const refreshFn = vi.fn(async () => 'fresh');
    const { component, fetchFn } = create(refreshFn);
    const event = pull();

    await component.onRefresh(event);

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(component.data()).toBe('fresh');
    expect(event.target.complete).toHaveBeenCalled();
  });

  it('falls back to the ordinary fetch without one', async () => {
    const { component, fetchFn } = create(null);

    await component.onRefresh(pull());

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(component.data()).toBe('cached');
  });
});

/**
 * Une page qui ne sait pas encore quoi charger passe `null`. Open Orders et Perp Summary rendaient à la
 * place un `of([])` d'attente : le layout l'affichait comme une réponse, et « No open order found »
 * restait à l'écran le temps que le stockage rende la sélection des dex (150 ms mesurées en le
 * ralentissant d'autant, sur un compte qui avait deux ordres ouverts).
 */
describe('RefreshableLayoutComponent — nothing to load yet', () => {
  const create = () => {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { isLoggedIn: () => true } }],
    });
    const fixture = TestBed.createComponent(RefreshableLayoutComponent<string[]>);
    fixture.componentRef.setInput('title', 'Open Orders');
    fixture.componentRef.setInput('fetchFn', null);
    fixture.detectChanges();
    return fixture;
  };

  it('shows the spinner, never the empty message, while it waits', () => {
    const fixture = create();
    const html = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance.showSpinner()).toBe(true);
    expect(html.querySelector('.loading-spinner')).not.toBeNull();
    expect(html.textContent).not.toContain('No data found');
  });

  it('loads as soon as the page knows what to load', async () => {
    const fixture = create();
    const fetchFn = vi.fn(async () => ['order']);

    fixture.componentRef.setInput('fetchFn', fetchFn);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.data()).toEqual(['order']);
  });

  it('lets a pull to refresh end without loading anything', async () => {
    const fixture = create();
    const complete = vi.fn();

    await fixture.componentInstance.onRefresh({ target: { complete } } as unknown as CustomEvent);

    expect(complete).toHaveBeenCalled();
    expect(fixture.componentInstance.data()).toBeNull();
  });
});
