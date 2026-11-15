import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HLOrderDetails } from '@syldel/hl-shared-types';
import { AccountActivityService } from './account-activity.service';
import { ConfigService } from './config.service';
import { HyperliquidGatewayService } from './hyperliquid-gateway.service';

/**
 * Chaque écriture au compte se signale, **quelle qu'en soit l'issue** : c'est ce qui fait relire au chart
 * de watchlist-detail les ordres qu'il dessine. Un échec compte autant qu'un succès — une modification
 * refusée peut avoir annulé l'ordre d'origine (`nest-trading-bot/docs/hyperliquid/live-check.md`), et une
 * réponse perdue laisse l'état inconnu.
 *
 * Les réponses simulées reprennent les formes mesurées dans ce même document : `ok` avec des statuts, ou
 * `err` avec un texte.
 */
describe('HyperliquidGatewayService — writes to the account', () => {
  let service: HyperliquidGatewayService;
  let httpMock: HttpTestingController;
  let activity: AccountActivityService;

  const order = {} as HLOrderDetails;
  const ignore = { error: () => undefined };

  /** Chaque écriture : son nom, sa route, ce qu'elle signale, et comment l'envoyer. */
  const writes: [string, string, string, (s: HyperliquidGatewayService) => void][] = [
    ['placeOrder', 'hyperliquid/order', 'place', (s) => s.placeOrder(order).subscribe(ignore)],
    ['placeOrders', 'hyperliquid/orders', 'place', (s) => s.placeOrders([order]).subscribe(ignore)],
    [
      'modifyOrder',
      'hyperliquid/order/modify',
      'modify',
      (s) => s.modifyOrder(1, order).subscribe(ignore),
    ],
    [
      'cancelOrder',
      'hyperliquid/order/cancel',
      'cancel',
      (s) => s.cancelOrder([{ asset: 0, oid: 1 }]).subscribe(ignore),
    ],
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { hyperliquidGatewayUrl: 'http://gw.test' } },
      ],
    });
    service = TestBed.inject(HyperliquidGatewayService);
    httpMock = TestBed.inject(HttpTestingController);
    activity = TestBed.inject(AccountActivityService);
  });

  afterEach(() => httpMock.verify());

  it.each(writes)('records %s once its reply has arrived', (_, path, kind, send) => {
    send(service);
    // Rien tant que la réponse n'est pas là : l'état du compte n'a pas encore changé de ce qu'on en sait.
    expect(activity.lastWrite()).toBeNull();

    httpMock
      .expectOne(`http://gw.test/${path}`)
      .flush({ status: 'ok', response: { type: 'order', data: { statuses: [] } } });

    expect(activity.lastWrite()?.kind).toBe(kind);
  });

  it.each(writes)('records %s even when Hyperliquid refuses it', (_, path, __, send) => {
    send(service);
    httpMock.expectOne(`http://gw.test/${path}`).flush({
      status: 'err',
      response: 'Error placing new order during modify: Order must have minimum value of $10.',
    });

    expect(activity.lastWrite()).not.toBeNull();
  });

  it.each(writes)('records %s even when the reply is lost', (_, path, __, send) => {
    send(service);
    httpMock
      .expectOne(`http://gw.test/${path}`)
      .flush(null, { status: 504, statusText: 'Gateway Timeout' });

    expect(activity.lastWrite()).not.toBeNull();
  });

  it('records each write, so two writes in a row both notify', () => {
    service.cancelOrder([{ asset: 0, oid: 1 }]).subscribe();
    httpMock.expectOne('http://gw.test/hyperliquid/order/cancel').flush({ status: 'ok' });
    const first = activity.lastWrite();

    service.cancelOrder([{ asset: 0, oid: 2 }]).subscribe();
    httpMock.expectOne('http://gw.test/hyperliquid/order/cancel').flush({ status: 'ok' });

    expect(activity.lastWrite()).not.toBe(first);
  });

  // Une lecture ne change rien au compte : elle ne doit pas faire relire le chart.
  it('does not record a read', () => {
    service.getOrderStatus(1).subscribe();
    httpMock.expectOne('http://gw.test/hyperliquid/orders/open/1').flush({});

    expect(activity.lastWrite()).toBeNull();
  });
});
