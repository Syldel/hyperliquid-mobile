import { ComponentFixture, TestBed } from '@angular/core/testing';
import { fillSideBadge, orderSideBadge, type SideBadge } from '@utils/order-labels.util';
import { SideBadgeComponent } from './side-badge.component';

/**
 * La règle (quel glyphe pour quel badge) est gardée par `order-labels.util.spec.ts`. Ce spec garde le
 * **câblage** : que le badge dessine bien le tracé de ce glyphe, et pas l'autre. Un ▲ et un ▼
 * intervertis dans le gabarit passeraient tous les tests de la règle.
 *
 * Éprouvé sur le code cassé : en échangeant les tracés de `buy` et `sell`, les deux premiers tests
 * tombent.
 */
describe('SideBadgeComponent glyph', () => {
  let fixture: ComponentFixture<SideBadgeComponent>;

  function mount(badge: SideBadge): HTMLElement {
    fixture = TestBed.createComponent(SideBadgeComponent);
    fixture.componentRef.setInput('badge', badge);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  // Le sommet du triangle dit son sens : en haut (y = 0,5) pour ▲, en bas (y = 6,5) pour ▼.
  const apexY = (el: HTMLElement): number => {
    const d = el.querySelector('svg path')?.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/L?(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
    const apex = ys.find((y) => ys.filter((other) => other === y).length === 1);
    return apex ?? NaN;
  };

  it('points up for a long being opened', () => {
    const el = mount(orderSideBadge('ETH', true));
    expect(el.querySelector('svg')?.getAttribute('aria-label')).toBe('Opens, buys');
    expect(apexY(el)).toBe(0.5);
  });

  it('points down for a short being opened', () => {
    const el = mount(fillSideBadge({ dir: 'Open Short', side: 'A' }));
    expect(el.querySelector('svg')?.getAttribute('aria-label')).toBe('Opens, sells');
    expect(apexY(el)).toBe(6.5);
  });

  it('draws a square for a close', () => {
    const el = mount(orderSideBadge('ETH', true, true));
    expect(el.querySelector('svg rect')).not.toBeNull();
    expect(el.querySelector('svg path')).toBeNull();
  });

  // Sans glyphe, pas de padding élargi : le badge garde la largeur de ses voisins.
  it('draws no glyph and keeps the plain layout for a position', () => {
    const el = mount({ text: 'LONG', action: null, tone: 'success' });
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('ion-badge')?.classList.contains('badge--glyph')).toBe(false);
    expect(el.textContent?.trim()).toBe('LONG');
  });
});
