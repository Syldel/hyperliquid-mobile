import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/standalone';
import { ProtectiveOrderFormComponent } from './protective-order-form.component';

/**
 * ============================================================================
 * Une protection qui vaudrait moins de 10 $ à son déclenchement ne s'ajoute pas : Hyperliquid
 * l'accepterait à la pose et la refuserait au déclenchement, sans rien fermer (mesuré le
 * 2026-11-13). La règle est testée à part (`order-minimum.utils.spec.ts`) ; ici, son branchement.
 * ============================================================================
 */
describe('ProtectiveOrderFormComponent — the 10 $ minimum at the trigger', () => {
  let fixture: ComponentFixture<ProtectiveOrderFormComponent>;
  let sheet: ProtectiveOrderFormComponent;
  let dismiss: ReturnType<typeof vi.fn>;

  /** Un long ETH de 0,0056 entré à 1 975,2 (≈ 11,06 $), comme la position mesurée. */
  function open(mainSz = '0.0056'): void {
    dismiss = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [{ provide: ModalController, useValue: { dismiss } }],
    });
    TestBed.overrideComponent(ProtectiveOrderFormComponent, {
      set: { imports: [], template: '', templateUrl: undefined, styleUrls: [] },
    });
    fixture = TestBed.createComponent(ProtectiveOrderFormComponent);
    sheet = fixture.componentInstance;
    Object.assign(sheet, {
      coin: 'ETH',
      mainIsBuy: true,
      mainLimitPx: '1975.2',
      mainSz,
      szDecimals: 4,
      isSpotAsset: false,
    });
    fixture.detectChanges();
  }

  it('refuses a Stop Loss worth under 10 $ when it triggers, and adds nothing', () => {
    open();
    sheet.onPriceOffsetInput('10'); // 0,0056 × 1 777,7 ≈ 9,96 $.
    expect(sheet.minimumRefusal()).toContain('when it triggers, under the 10 $ minimum');
    expect(sheet.isFormInvalid()).toBe(true);

    sheet.confirm();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('lets the same Stop Loss through when it is worth 10 $ or more at its trigger', () => {
    open();
    sheet.onPriceOffsetInput('2'); // 0,0056 × 1 935,7 ≈ 10,84 $.
    expect(sheet.minimumRefusal()).toBeNull();

    sheet.confirm();
    expect(dismiss).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sl' }), 'confirm');
  });

  it('counts only the protected share of the size', () => {
    open();
    sheet.onPriceOffsetInput('2');
    sheet.onSizePercentInput('50'); // 0,0028 × 1 935,7 ≈ 5,42 $.
    expect(sheet.minimumRefusal()).toContain('≈ 5.42 $');
  });
});
