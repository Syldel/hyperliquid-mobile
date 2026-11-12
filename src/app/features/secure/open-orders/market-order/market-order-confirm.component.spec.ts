import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/standalone';
import type { HLL2BookResponse, HLPerpMetaAndCtx } from '@syldel/hl-shared-types';
import { of } from 'rxjs';
import { MarketOrderConfirmComponent } from './market-order-confirm.component';
import { MarketOrderService } from './market-order.service';
import { MARKET_SNAPSHOT_MAX_AGE_MS, readMarketSnapshot } from './market-snapshot.util';

/**
 * ============================================================================
 * La confirmation ne presse pas : Confirm reste actif quand la lecture vieillit, et la RELIT. L'ordre
 * ne part sans nouveau geste que si les chiffres tiennent (`figureChanges`, testé à part) ; sinon
 * rien ne part et les changements sont dits.
 *
 * Le double de `readSnapshot` rend ce que le vrai rend : une `SnapshotReading`, construite par la
 * vraie `readMarketSnapshot` sur un carnet et un contexte de la forme d'Hyperliquid.
 * ============================================================================
 */

/** Un carnet BTC profond autour de `mid` : un verdict OK pour 0,001. */
function readingAt(mid: number, readAt: number) {
  const book: HLL2BookResponse = {
    coin: 'BTC',
    time: readAt,
    levels: [
      [{ px: String(mid - 1), sz: '50', n: 10 }],
      [{ px: String(mid + 1), sz: '50', n: 10 }],
    ],
  };
  const metaAndCtx = [
    {
      universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40, marginTableId: 56 }],
      marginTables: [],
    },
    [
      {
        markPx: String(mid),
        oraclePx: String(mid),
        dayNtlVlm: '2000000000',
        funding: '0.0000125',
        midPx: String(mid),
      },
    ],
  ] as unknown as HLPerpMetaAndCtx;
  return readMarketSnapshot('BTC', book, metaAndCtx, readAt);
}

describe('MarketOrderConfirmComponent — freshness', () => {
  let fixture: ComponentFixture<MarketOrderConfirmComponent>;
  let sheet: MarketOrderConfirmComponent;
  let dismiss: ReturnType<typeof vi.fn>;
  let readSnapshot: ReturnType<typeof vi.fn>;
  /** Le mid que la prochaine lecture rendra. */
  let nextMid: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    nextMid = 73000;
    dismiss = vi.fn(() => Promise.resolve(true));
    readSnapshot = vi.fn(() => of(readingAt(nextMid, Date.now())));

    TestBed.configureTestingModule({
      providers: [
        { provide: ModalController, useValue: { dismiss } },
        {
          provide: MarketOrderService,
          useValue: {
            maxSlippagePct: signal(1).asReadonly(),
            readSnapshot,
            takerRate: () => of({ rate: 0.00045, status: 'read' }),
          },
        },
      ],
    });
    TestBed.overrideComponent(MarketOrderConfirmComponent, {
      set: { imports: [], template: '', templateUrl: undefined, styleUrls: [] },
    });
    fixture = TestBed.createComponent(MarketOrderConfirmComponent);
    sheet = fixture.componentInstance;
    fixture.componentRef.setInput('coin', 'BTC');
    fixture.componentRef.setInput('isBuy', true);
    fixture.componentRef.setInput('sz', '0.001');
    fixture.componentRef.setInput('szDecimals', 5);
    fixture.componentRef.setInput('actionLabel', 'Long');
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
  });

  // Un doigt déjà en route ne valide pas des chiffres qui viennent d'apparaître.
  it('keeps Confirm inactive for a moment after the figures appear', () => {
    expect(sheet.canConfirm()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(sheet.canConfirm()).toBe(true);
  });

  it('sends a fresh reading at once, without reading again', () => {
    vi.advanceTimersByTime(1000);
    sheet.confirm();
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledWith(
      expect.objectContaining({ worstPx: '73730', mid: 73000 }),
      'confirm',
    );
  });

  // Le cœur du changement : vieillir n'empêche plus de confirmer.
  it('keeps Confirm active once the reading is old', () => {
    vi.advanceTimersByTime(MARKET_SNAPSHOT_MAX_AGE_MS + 1000);
    expect(sheet.stale()).toBe(true);
    expect(sheet.canConfirm()).toBe(true);
  });

  it('re-reads an old reading on Confirm, and sends when the figures held', () => {
    vi.advanceTimersByTime(MARKET_SNAPSHOT_MAX_AGE_MS + 1000);
    nextMid = 73010; // le plafond bouge de 0,014 % : sous la tolérance.
    sheet.confirm();
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(dismiss).toHaveBeenCalledWith(
      expect.objectContaining({ mid: 73010, readAt: Date.now() }),
      'confirm',
    );
  });

  it('sends nothing when the re-read moved the worst price, and says what changed', () => {
    vi.advanceTimersByTime(MARKET_SNAPSHOT_MAX_AGE_MS + 1000);
    nextMid = 73500; // + 0,68 %.
    sheet.confirm();
    expect(dismiss).not.toHaveBeenCalled();
    expect(sheet.changes().map((c) => c.id)).toEqual(['worst-price']);
    expect(sheet.canConfirm()).toBe(false);

    // Les nouveaux chiffres lus, un second geste les envoie.
    vi.advanceTimersByTime(1000);
    sheet.confirm();
    expect(dismiss).toHaveBeenCalledWith(expect.objectContaining({ mid: 73500 }), 'confirm');
  });
});
