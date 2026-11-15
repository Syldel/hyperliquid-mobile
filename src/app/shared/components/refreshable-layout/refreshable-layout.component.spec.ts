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
