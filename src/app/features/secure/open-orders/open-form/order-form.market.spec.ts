import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController, ToastController } from '@ionic/angular/standalone';
import { readPerpMarketMeta } from '@utils/market-meta.util';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { AvailableCapitalService } from '@services/available-capital.service';
import { HyperliquidGatewayService } from '@services/hyperliquid-gateway.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import type { MarketFillOutcome } from '../market-order/market-fill.util';
import { MarketOrderService } from '../market-order/market-order.service';
import { OrderFormComponent } from './order-form.component';

/**
 * ============================================================================
 * L'ordre au marché dans le formulaire : une confirmation, UN envoi, puis les protections sur ce
 * qui a été rempli. La lecture de la réponse est testée dans `market-fill.util.spec.ts` ; ici, ce
 * que le formulaire fait de chaque issue.
 *
 * Les doubles ne rendent que ce que les vrais rendent : la confirmation rend un ticket
 * `{ worstPx, mid, readAt }` ou rien ; `send` rend une `MarketFillOutcome` et ne lève jamais (le
 * vrai convertit toute erreur HTTP en issue).
 * ============================================================================
 */
describe('OrderFormComponent — market order', () => {
  let fixture: ComponentFixture<OrderFormComponent>;
  let form: OrderFormComponent;

  const BTC_META = { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] };

  let confirmRole: 'confirm' | 'cancel';
  let dismiss: ReturnType<typeof vi.fn>;
  let modalCreate: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  let placeOrders: ReturnType<typeof vi.fn>;
  let readPositionSize: ReturnType<typeof vi.fn>;
  /** Les positions que `clearinghouseState` rend : la forme d'Hyperliquid, réduite à ce qui est lu. */
  let heldPositions: { position: { coin: string; szi: string; entryPx: string } }[] = [];
  afterEach(() => (heldPositions = []));

  function settle(): void {
    fixture.detectChanges();
    fixture.detectChanges();
  }

  /** Les microtâches de `submitMarket` (lecture de la position, modale) : elles s'enchaînent. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    settle();
  }

  function create(setup?: (component: OrderFormComponent) => void, coin = 'BTC'): void {
    confirmRole = 'confirm';
    dismiss = vi.fn(() => Promise.resolve(true));
    modalCreate = vi.fn(() =>
      Promise.resolve({
        present: () => Promise.resolve(),
        onDidDismiss: () =>
          Promise.resolve(
            confirmRole === 'confirm'
              ? { role: 'confirm', data: { worstPx: '101010', mid: 100005, readAt: 1 } }
              : { role: 'cancel', data: null },
          ),
      }),
    );
    send = vi.fn();
    placeOrders = vi.fn(() =>
      of({
        status: 'ok',
        response: { type: 'order', data: { statuses: [{ resting: { oid: 9 } }] } },
      }),
    );
    readPositionSize = vi.fn(() => of(null));

    TestBed.configureTestingModule({
      providers: [
        { provide: ModalController, useValue: { dismiss, create: modalCreate } },
        {
          provide: ToastController,
          useValue: { create: () => Promise.resolve({ present: () => {} }) },
        },
        { provide: HyperliquidGatewayService, useValue: { placeOrders } },
        {
          provide: HyperliquidMarketService,
          useValue: {
            // Le vrai rend une erreur typée dans l'Observable, il ne lève pas.
            getMarketMeta: (name: string) => {
              try {
                return of(readPerpMarketMeta(BTC_META as never, name));
              } catch (error) {
                return throwError(() => error);
              }
            },
            resolveCoin: (name: string) => of(name),
          },
        },
        {
          provide: HyperliquidInfoService,
          useValue: {
            getClearinghouseState: () => of({ assetPositions: heldPositions }),
            getActiveAssetData: () => of(null),
          },
        },
        {
          provide: AvailableCapitalService,
          useValue: {
            invalidate: () => {},
            getAvailableCapital: () => of({ status: 'unavailable' }),
          },
        },
        {
          provide: MarketOrderService,
          useValue: {
            maxSlippagePct: signal(1).asReadonly(),
            loadMaxSlippage: () => Promise.resolve(),
            setMaxSlippage: vi.fn(),
            readPositionSize,
            send,
          },
        },
      ],
    });
    TestBed.overrideComponent(OrderFormComponent, {
      set: { imports: [], template: '', templateUrl: undefined, styleUrls: [] },
    });
    fixture = TestBed.createComponent(OrderFormComponent);
    form = fixture.componentInstance;
    form.defaultCoin = coin;
    setup?.(form);
    settle();
  }

  /** Un achat au marché de 0,00011 BTC, une protection Stop Loss à 2 %. */
  function startMarketBuy(withProtection = true): void {
    create();
    form.orderKind.set('market');
    settle();
    form.sz.set('0.00011');
    if (withProtection) {
      form.protectiveOrders.set([
        {
          id: 'sl',
          kind: 'sl',
          label: 'Stop Loss',
          sizePercent: 100,
          priceOffsetPercent: 2,
          isMarket: true,
        },
      ]);
    }
    settle();
  }

  function answer(outcome: MarketFillOutcome): void {
    send.mockReturnValue(of(outcome));
  }

  it('keeps the side when going from limit to market: only a trigger closes', () => {
    create();
    form.isBuy.set(true);
    form.orderKind.set('market');
    settle();
    expect(form.isBuy()).toBe(true);
    expect(form.reduceOnly()).toBe(false);
  });

  it('sends one IOC at the worst price the confirmation showed', async () => {
    startMarketBuy(false);
    answer({ kind: 'filled', totalSz: '0.00011', avgPx: '100020.0', oid: 1 });

    form.submit();
    await flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      assetName: 'BTC',
      isBuy: true,
      limitPx: '101010',
      sz: '0.00011',
      reduceOnly: false,
      orderType: { limit: { tif: 'Ioc' } },
    });
    expect(dismiss).toHaveBeenCalledWith(null, 'confirm');
  });

  // Le bouton dit « Long » ; un achat contre un short le réduit ou le retourne, et la confirmation
  // le dit, d'après la position relue au moment de confirmer.
  it('tells the confirmation what the order does to the position re-read at that moment', async () => {
    startMarketBuy(false);
    readPositionSize.mockReturnValue(of(-0.00005));
    confirmRole = 'cancel';

    form.submit();
    await flush();

    const props = modalCreate.mock.calls[0][0].componentProps;
    expect(props.positionEffect()).toEqual({
      kind: 'flips',
      text: "Closes your short 0.00005 AND opens a long 0.00006. To close only, use the position's Close buttons.",
    });
    expect(props.hasPosition()).toBe(true);
  });

  it('tells the confirmation nothing when there is no position, or when it could not be read', async () => {
    startMarketBuy(false);
    confirmRole = 'cancel';
    form.submit();
    await flush();
    expect(modalCreate.mock.calls[0][0].componentProps.positionEffect()).toBeNull();

    readPositionSize.mockReturnValue(throwError(() => new Error('down')));
    form.submit();
    await flush();
    const props = modalCreate.mock.calls[1][0].componentProps;
    expect(props.positionEffect()).toBeNull();
    expect(props.hasPosition()).toBeNull();
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    startMarketBuy(false);
    confirmRole = 'cancel';

    form.submit();
    await flush();

    expect(send).not.toHaveBeenCalled();
  });

  it('places the protections on what filled, priced from the average fill', async () => {
    startMarketBuy();
    answer({ kind: 'filled', totalSz: '0.00011', avgPx: '100000.0', oid: 1 });

    form.submit();
    await flush();

    expect(placeOrders).toHaveBeenCalledTimes(1);
    const [orders] = placeOrders.mock.calls[0] as [Array<Record<string, unknown>>];
    // Stop Loss d'un long, 2 % sous le prix moyen OBTENU (100000), pas sous le marché d'avant.
    expect(orders[0]).toMatchObject({
      assetName: 'BTC',
      isBuy: false,
      sz: '0.00011',
      reduceOnly: true,
      orderType: { trigger: { triggerPx: '98000', tpsl: 'sl', isMarket: true } },
    });
    expect(dismiss).toHaveBeenCalledWith(null, 'confirm');
  });

  it('sizes the protections on the filled part of a partial fill, and stays open to say it', async () => {
    startMarketBuy();
    answer({
      kind: 'partial',
      totalSz: '0.00005',
      avgPx: '100000.0',
      oid: 1,
      requestedSz: '0.00011',
    });

    form.submit();
    await flush();

    const [orders] = placeOrders.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(orders[0]['sz']).toBe('0.00005');
    expect(form.marketOutcome()?.text).toContain('Partially filled: 0.00005 of 0.00011');
    expect(dismiss).not.toHaveBeenCalled();
    expect(form.isFormInvalid()).toBe(true);
  });

  it('does not close on an open position left unprotected, and retries only what failed', async () => {
    startMarketBuy();
    form.protectiveOrders.update((list) => [
      ...list,
      {
        id: 'tp',
        kind: 'tp',
        label: 'Take Profit',
        sizePercent: 100,
        priceOffsetPercent: 3,
        isMarket: true,
      },
    ]);
    answer({ kind: 'filled', totalSz: '0.00011', avgPx: '100000.0', oid: 1 });
    placeOrders.mockReturnValueOnce(
      of({
        status: 'ok',
        response: {
          type: 'order',
          data: { statuses: [{ resting: { oid: 9 } }, { error: 'Insufficient margin' }] },
        },
      }),
    );

    form.submit();
    await flush();

    expect(dismiss).not.toHaveBeenCalled();
    expect(form.unprotected()?.items.map((p) => p.id)).toEqual(['tp']);
    expect(form.unprotected()?.message).toContain('Take Profit: Insufficient margin');

    form.retryProtection();
    settle();

    const [retried] = placeOrders.mock.calls[1] as [Array<Record<string, unknown>>];
    expect(retried).toHaveLength(1);
    expect(retried[0]['orderType']).toMatchObject({ trigger: { tpsl: 'tp' } });
    expect(form.unprotected()).toBeNull();
    expect(dismiss).toHaveBeenCalledWith(null, 'confirm');
  });

  it('says nothing executed when the book could not fill, and lets the user try again', async () => {
    startMarketBuy();
    answer({ kind: 'not-filled', message: 'Not filled: no liquidity within the max slippage.' });

    form.submit();
    await flush();

    expect(form.error()).toContain('Not filled');
    expect(placeOrders).not.toHaveBeenCalled();
    expect(form.marketLocked()).toBe(false);
  });

  it('re-reads the position once after an unknown state, and blocks sending until it is shown', async () => {
    startMarketBuy();
    answer({ kind: 'unknown', message: 'Server error (502). The order may have executed.' });
    const position$ = new Subject<number | null>();
    // Premier appel : avant la confirmation (pas de position). Second : après l'état inconnu.
    readPositionSize.mockReturnValueOnce(of(null)).mockReturnValueOnce(position$);

    form.submit();
    await flush();

    expect(form.error()).toContain('may have executed');
    expect(form.checkingPosition()).toBe(true);
    expect(form.isFormInvalid()).toBe(true);
    expect(placeOrders).not.toHaveBeenCalled();

    position$.next(0.00011);
    settle();

    expect(form.checkingPosition()).toBe(false);
    expect(form.marketOutcome()?.text).toContain('long 0.00011 on BTC');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('says when the position could not be re-read', async () => {
    startMarketBuy();
    answer({ kind: 'unknown', message: 'Network error.' });
    readPositionSize
      .mockReturnValueOnce(of(null))
      .mockReturnValueOnce(throwError(() => new Error('offline')) as Observable<never>);

    form.submit();
    await flush();

    expect(form.marketOutcome()).toMatchObject({ tone: 'high' });
    expect(form.marketOutcome()?.text).toContain('check it on Hyperliquid');
  });

  // Mesuré le 2026-11-12 : short ETH 0,0343, un achat de 0,006 passait pour une ouverture — G2 se
  // taisait et G3 annonçait une marge qu'un achat qui réduit ne demande pas.
  it('reads the held position for a market order, so a buy against a short reads as a reduction', () => {
    heldPositions = [{ position: { coin: 'BTC', szi: '-0.0003', entryPx: '100000' } }];
    create();
    form.currentPrice.set(100000);
    form.orderKind.set('market');
    form.isBuy.set(true);
    form.sz.set('0.0001');
    settle();
    expect(form.guardNotices()).toEqual([
      { tone: 'info', text: 'Reduces your short 0.0003 to 0.0002.' },
    ]);
  });

  it('offers no market order on a spot market, and falls back to limit', () => {
    create();
    form.orderKind.set('market');
    settle();

    form.selectedCoin.set('PURR/USDC');
    settle();

    expect(form.isPerpCoin()).toBe(false);
    expect(form.orderKind()).toBe('limit');
  });

  describe('a close prepared from a position card', () => {
    it('keeps the closing side, the position size and reduce-only', () => {
      create((component) => {
        component.closePreset = { coin: 'BTC', isBuy: false, sz: '0.00011' };
      });

      expect(form.isBuy()).toBe(false);
      expect(form.sz()).toBe('0.00011');
      expect(form.reduceOnly()).toBe(true);
    });

    it('says Close long on its button, and gives the ordinary label back once the side changes', () => {
      create((component) => {
        component.closePreset = { coin: 'BTC', isBuy: false, sz: '0.00011' };
      });
      expect(form.closeLabel()).toBe('Close long');

      form.isBuy.set(true);
      expect(form.closeLabel()).toBeNull();
    });
  });
});
