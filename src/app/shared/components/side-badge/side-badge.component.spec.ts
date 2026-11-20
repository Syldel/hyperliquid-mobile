import { ComponentFixture, TestBed } from '@angular/core/testing';
import { orderSideBadge, type SideBadge } from '@utils/order-labels.util';
import { SideBadgeComponent } from './side-badge.component';

/**
 * La règle (quel mot, quelle couleur) est gardée par `order-labels.util.spec.ts`. Ce spec garde le
 * **rendu** : le mot seul, sans glyphe ni padding élargi, depuis le 2026-11-20.
 */
describe('SideBadgeComponent', () => {
  let fixture: ComponentFixture<SideBadgeComponent>;

  function mount(badge: SideBadge): HTMLElement {
    fixture = TestBed.createComponent(SideBadgeComponent);
    fixture.componentRef.setInput('badge', badge);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('writes the side alone, with no glyph and the plain badge layout', () => {
    const el = mount(orderSideBadge('ETH', false));
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('ion-badge')?.classList.contains('badge--glyph')).toBe(false);
    expect(el.textContent?.trim()).toBe('SHORT');
  });
});
