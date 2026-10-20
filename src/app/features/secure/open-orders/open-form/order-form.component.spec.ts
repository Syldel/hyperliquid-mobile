import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController, ToastController } from '@ionic/angular/standalone';
import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import { Subject, firstValueFrom, of, throwError } from 'rxjs';
import { MarketMetaError, readPerpMarketMeta, type MarketMeta } from '@utils/market-meta.util';
import { AvailableCapitalService } from '@services/available-capital.service';
import { HyperliquidGatewayService } from '@services/hyperliquid-gateway.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { PRICE_CHECK_UNSUPPORTED } from './active-asset.util';
import { OrderFormComponent } from './order-form.component';

/**
 * ============================================================================
 * Le câblage du formulaire : ce que les effets font des signaux.
 *
 * La décision pure (`limitFromTrigger`, `isLimitOnWrongSide`) est testée dans
 * `order-limit.util.spec.ts`. Ce qui ne l'était pas, c'est ce que le composant en
 * fait : quand il recalcule le prix limite, quand il y renonce parce que
 * l'utilisateur l'a saisi, quand il vide un champ. Ces enchaînements n'avaient été
 * mesurés que dans le navigateur (docs/roadmap.md) ; cassés, ils réécrivent ou
 * conservent un prix sans que rien le dise.
 *
 * Le gabarit est vidé : il n'est pas ce qui est testé, et il appellerait le réseau
 * (`RefreshableLayout` charge le marché). Les services sont des doubles qui ne
 * rendent que ce que les vrais rendent : la forme de `getPerpMeta` est celle que le
 * composant lit (`universe[].name / szDecimals / maxLeverage`).
 * ============================================================================
 */
describe('OrderFormComponent — price wiring', () => {
  let fixture: ComponentFixture<OrderFormComponent>;
  let form: OrderFormComponent;

  // BTC à 5 décimales de taille : un prix perp arrondi à 5 chiffres significatifs.
  const BTC_META = { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] };

  /**
   * Ce que rend le vrai `getMarketMeta` pour un perp : la lecture EXACTE de `market-meta.util`, ou son
   * erreur typée. Le double ne rend que ce que le vrai rendrait ; un test peut le remplacer pour
   * simuler une méta qui tarde ou qui échoue.
   */
  let metaFor: (coin: string) => import('rxjs').Observable<MarketMeta>;

  const marketDouble = {
    getMarketMeta: (coin: string) => metaFor(coin),
    getPerpMeta: () => of(BTC_META),
    getSpotMeta: () => of({ tokens: [] }),
    resolveCoin: (name: string) => of(name),
  };
  const infoDouble = {
    getClearinghouseState: () => of({ assetPositions: [] }),
    getActiveAssetData: vi.fn(() => of(null)),
  };
  // Le vrai rend un `Observable` de capital ; `unavailable` est la forme que le formulaire sait lire.
  const capitalDouble = {
    invalidate: () => {},
    getAvailableCapital: () => of({ status: 'unavailable' }),
  };

  /** Les effets du composant tournent avec la détection de changement, et s'enchaînent. */
  function settle(): void {
    fixture.detectChanges();
    fixture.detectChanges();
  }

  beforeEach(() => {
    infoDouble.getActiveAssetData.mockClear();
    metaFor = (coin) => {
      try {
        return of(readPerpMarketMeta(BTC_META as never, coin));
      } catch (error) {
        return throwError(() => error);
      }
    };
  });

  function create(setup?: (component: OrderFormComponent) => void): void {
    TestBed.configureTestingModule({
      providers: [
        { provide: ModalController, useValue: { dismiss: () => Promise.resolve(true) } },
        {
          provide: ToastController,
          useValue: { create: () => Promise.resolve({ present: () => {} }) },
        },
        { provide: HyperliquidGatewayService, useValue: {} },
        { provide: HyperliquidMarketService, useValue: marketDouble },
        { provide: HyperliquidInfoService, useValue: infoDouble },
        { provide: AvailableCapitalService, useValue: capitalDouble },
      ],
    });
    TestBed.overrideComponent(OrderFormComponent, {
      set: { imports: [], template: '', templateUrl: undefined, styleUrls: [] },
    });
    fixture = TestBed.createComponent(OrderFormComponent);
    form = fixture.componentInstance;
    setup?.(form);
    settle();
  }

  /** Un ordre de création passé en mode déclencheur, vente (le sens bascule avec le type). */
  function startSellStop(): void {
    create((component) => (component.defaultCoin = 'BTC'));
    form.orderKind.set('trigger');
    settle();
    form.isMarket.set(false);
    form.triggerPx.set('81000');
    settle();
  }

  describe('creating a trigger order', () => {
    it('derives the limit from the trigger, 5 % under it for a Stop Loss sell', () => {
      startSellStop();

      expect(form.isBuy()).toBe(false);
      expect(form.limitPx()).toBe('76950');
    });

    it('follows the trigger while the limit has not been typed', () => {
      startSellStop();

      form.triggerPx.set('82000');
      settle();

      expect(form.limitPx()).toBe('77900');
    });

    it('clears both price fields when going back to a limit order: the trigger price means nothing to it', () => {
      startSellStop();
      expect(form.limitPx()).toBe('76950');

      form.orderKind.set('limit');
      settle();

      expect(form.limitPx()).toBe('');
      expect(form.triggerPx()).toBe('');
    });
  });

  describe('a limit typed by hand', () => {
    beforeEach(() => {
      startSellStop();
      form.onLimitInput('75000');
      settle();
    });

    it('is not rewritten when the trigger changes', () => {
      form.triggerPx.set('82000');
      settle();

      expect(form.limitPx()).toBe('75000');
    });

    it('is not rewritten when Stop Loss becomes Take Profit', () => {
      form.tpsl.set('tp');
      settle();

      expect(form.limitPx()).toBe('75000');
    });

    it('gives the hand back to the derived price when the field is emptied', () => {
      form.onLimitInput('');
      settle();
      form.triggerPx.set('82000');
      settle();

      expect(form.limitPx()).toBe('77900');
    });

    it('is replaced by the slippage bound when the trigger becomes a market trigger', () => {
      form.isMarket.set(true);
      settle();

      expect(form.limitEdited()).toBe(false);
      // 10 % under 81000: the exchange's bound (72900, raised one tick for a sell), not the typed price.
      expect(form.limitPx()).toBe('72901');
    });

    it('is flagged, and blocks placing, when a direction change leaves it on the wrong side of the trigger', () => {
      form.sz.set('0.001');
      settle();
      expect(form.isLimitSideInvalid()).toBe(false);

      // Vente à 75000 sous un déclencheur à 81000 : valable. Passée en achat, la même
      // saisie est sous le déclencheur — un ordre qui se déclenche sans pouvoir se remplir.
      form.isBuy.set(true);
      settle();

      expect(form.limitPx()).toBe('75000');
      expect(form.isLimitSideInvalid()).toBe(true);
      expect(form.isFormInvalid()).toBe(true);
    });
  });

  describe('the warning for a stop loss limit that is too tight', () => {
    // Mesuré le 2026-10-18 (ETH) : un Stop Limit au limite égal au déclencheur est resté au carnet
    // 826 secondes, la position ouverte et sans protection. Le formulaire le DIT, il ne le bloque pas.
    it('says nothing for the default limit, 5 % from the trigger', () => {
      startSellStop();

      expect(form.limitPx()).toBe('76950');
      expect(form.stopLimitWarning()).toBeNull();
    });

    it('warns when the limit typed is equal to the trigger, and says how far it is', () => {
      startSellStop();
      form.onLimitInput('81000');
      settle();

      expect(form.stopLimitWarning()).toBe(
        'Limit is only 0.00% from the trigger: this stop may trigger without filling and leave the position open.',
      );
    });

    it('does not block placing: the case is legitimate to test', () => {
      startSellStop();
      form.sz.set('0.001');
      form.onLimitInput('81000');
      settle();

      expect(form.stopLimitWarning()).not.toBeNull();
      expect(form.isFormInvalid()).toBe(false);
    });

    it('says nothing for a take profit, a market trigger or a limit order', () => {
      startSellStop();
      form.onLimitInput('81000');
      form.tpsl.set('tp');
      settle();
      expect(form.stopLimitWarning()).toBeNull();

      form.tpsl.set('sl');
      form.isMarket.set(true);
      settle();
      expect(form.stopLimitWarning()).toBeNull();
    });

    it('leaves a limit on the wrong side to the existing block, not to this warning', () => {
      startSellStop();
      form.onLimitInput('82000'); // un stop vendeur dont le limite est AU-DESSUS du déclencheur
      settle();

      expect(form.isLimitSideInvalid()).toBe(true);
      expect(form.stopLimitWarning()).toBeNull();
    });
  });

  it('never rewrites the trigger when the direction changes: the limit follows it, not the reverse', () => {
    startSellStop();

    form.isBuy.set(true);
    settle();

    expect(form.triggerPx()).toBe('81000');
  });

  it('starts over from the new asset: nothing typed for the previous one survives', () => {
    startSellStop();
    form.onLimitInput('75000');
    settle();

    form.selectedCoin.set('ETH');
    settle();

    expect(form.limitPx()).toBe('');
    expect(form.triggerPx()).toBe('');
    expect(form.limitEdited()).toBe(false);
  });

  describe('modifying an existing trigger order', () => {
    // Un ordre de forme devinée : ce que le composant en lit est `coin`, `side`, `limitPx`,
    // `triggerPx`, `orderType`, `isTrigger`, `sz`, `reduceOnly`. La sémantique réelle de
    // `limitPx` pour un Stop Limit n'a pas été lue sur un ordre réel (roadmap, « À éprouver
    // en réel », point 3).
    const existing = {
      oid: 1,
      coin: 'BTC',
      side: 'A',
      limitPx: '80000',
      sz: '0.001',
      reduceOnly: true,
      isTrigger: true,
      triggerPx: '81000',
      orderType: 'Stop Limit',
    } as unknown as HLFrontendOpenOrder;

    beforeEach(() => create((component) => (component.existingOrder = existing)));

    it('shows the order as it is: its own limit, not one derived from its trigger', () => {
      expect(form.isModify()).toBe(true);
      expect(form.limitPx()).toBe('80000');
    });

    it('follows a changed trigger, and gives the order its own limit back when the trigger returns', () => {
      form.triggerPx.set('82000');
      settle();
      expect(form.limitPx()).toBe('77900');

      form.triggerPx.set('81000');
      settle();
      expect(form.limitPx()).toBe('80000');
    });
  });

  /**
   * LA GRILLE DU MARCHÉ : LA SIENNE, OU L'ENVOI EST BLOQUÉ.
   *
   * Le formulaire cherchait `szDecimals` et le levier par sous-chaîne : 38 perps recevaient les données
   * d'un autre (mesuré le 2026-10-19), et `roundSize` / `roundPrice` ARRONDISSENT sur cette grille — une
   * taille saisie à 12,5 partait à 13 sur MAVIA, une limite à 0,52345 partait à 0,52 sur ETHFI. Un échec
   * de lecture ne disait rien : `szDecimals` gardait le défaut 3 ou la valeur de l'actif précédent.
   */
  /**
   * « Spot » se décide par `hlMarketKind` : le formulaire le décidait par `includes('/') || includes('-')`.
   * Cela change les libellés (Buy/Sell), l'arrondi du prix et le `isSpotAsset` de l'ordre protecteur.
   */
  describe('the spot predicate', () => {
    it.each([
      ['PURR/USDC', true],
      ['HYPE/USDC', true],
      ['@107', true],
      ['BTC', false],
      ['xyz:MU', false],
      // L'ancien `includes('-')` : un nom avec un tiret n'est pas un spot.
      ['xyz:TSLA-USDT', false],
    ])('reads %s as a spot: %s', (coin, spot) => {
      create();
      form.selectedCoin.set(coin);
      settle();

      expect(form.isSpot()).toBe(spot);
    });

    it('is false, and not undefined, when no market is selected', () => {
      create();

      expect(form.isSpot()).toBe(false);
    });
  });

  // Long / Short est le vocabulaire d'un perp : un outcome ne se prend ni long ni court, et `isSpot()` seul le
  // laissait en Long / Short. Sans actif choisi le libellé par défaut reste Long / Short.
  describe('the side vocabulary', () => {
    it.each([
      ['BTC', false],
      ['xyz:MU', false],
      ['PURR/USDC', true],
      ['@107', true],
      ['#10', true],
      ['+10', true],
      [':BTC', true],
    ])('uses Buy / Sell for %s: %s', (coin, buySell) => {
      create();
      form.selectedCoin.set(coin);
      settle();

      expect(form.usesBuySell()).toBe(buySell);
    });

    it('keeps Long / Short while no market is selected', () => {
      create();

      expect(form.usesBuySell()).toBe(false);
    });
  });

  /**
   * LA REQUÊTE DE PRIX N'EST ENVOYÉE QU'À UN PERP.
   *
   * `activeAssetData` est une requête de perps : mesuré le 2026-10-20 dans le navigateur, l'API répond
   * **500** pour l'outcome `#10` comme pour un spot. Le formulaire l'envoyait pourtant à tout marché qui
   * n'était pas un spot, puis affichait « Market data could not be loaded » avec un bouton Retry qui ne
   * pouvait jamais réussir.
   */
  describe('the price request', () => {
    async function readingOf(coin: string): Promise<unknown> {
      create((component) => (component.defaultCoin = coin));
      return firstValueFrom(form.fetchFn()());
    }

    it('asks activeAssetData for a perp, and only for its own name', async () => {
      await readingOf('BTC');

      expect(infoDouble.getActiveAssetData).toHaveBeenCalledTimes(1);
      expect(infoDouble.getActiveAssetData).toHaveBeenCalledWith('BTC');
    });

    it.each(['xyz:MU', 'kPEPE'])('asks it for the perp %s as well', async (coin) => {
      await readingOf(coin);

      expect(infoDouble.getActiveAssetData).toHaveBeenCalledWith(coin);
    });

    it.each(['PURR/USDC', 'HYPE/USDC', '@107', '#10', '+10', '#142000', ':BTC'])(
      'does not ask for %s, which is not a perp: it says the price check does not exist',
      async (coin) => {
        const reading = await readingOf(coin);

        expect(infoDouble.getActiveAssetData).not.toHaveBeenCalled();
        expect(reading).toBe(PRICE_CHECK_UNSUPPORTED);
      },
    );
  });

  describe('the market grid', () => {
    // Les valeurs de l'API (2026-10-19) ; ETH est listé AVANT ETHFI, comme dans l'univers réel.
    const UNIVERSE = {
      universe: [
        { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
        { name: 'ETHFI', szDecimals: 1, maxLeverage: 5 },
        { name: 'MAV', szDecimals: 0, maxLeverage: 3 },
        { name: 'MAVIA', szDecimals: 1, maxLeverage: 3 },
      ],
    };

    const readFromUniverse = (coin: string) => {
      try {
        return of(readPerpMarketMeta(UNIVERSE as never, coin));
      } catch (error) {
        return throwError(() => error);
      }
    };

    function fill(sz: string, limit: string): void {
      form.sz.set(sz);
      form.limitPx.set(limit);
      settle();
    }

    beforeEach(() => {
      metaFor = readFromUniverse;
    });

    it('reads the grid of the market itself: ETHFI keeps its 1 decimal and its 5x, not those of ETH', () => {
      create((component) => (component.defaultCoin = 'ETHFI'));

      expect(form.marketMeta()).toBe('ok');
      expect(form.szDecimals()).toBe(1);
      expect(form.maxLeverage()).toBe(5);
    });

    it('sends the size as typed on MAVIA: 12.5 stays 12.5 instead of rounding to 13 on the grid of MAV', () => {
      create((component) => (component.defaultCoin = 'MAVIA'));
      fill('12.5', '1.2345');

      expect(form.buildOrderDetails().sz).toBe('12.5');
    });

    it('leaves the typed limit price alone on ETHFI: 0.52345 does not become 0.52', () => {
      create((component) => (component.defaultCoin = 'ETHFI'));
      fill('10', '0.52345');

      expect(form.buildOrderDetails().limitPx).toBe('0.52345');
    });

    // Une paire spot n'a pas de levier : la grille est celle de son jeton de base, et le levier d'un
    // perp précédent ne lui survit pas.
    describe('a spot pair', () => {
      it('takes the size grid of its base token and carries no leverage', () => {
        metaFor = (coin) =>
          coin === 'PURR/USDC'
            ? of({ kind: 'spot', szDecimals: 0 } as MarketMeta)
            : readFromUniverse(coin);
        create((component) => (component.defaultCoin = 'ETH'));
        expect(form.maxLeverage()).toBe(25);

        form.selectedCoin.set('PURR/USDC');
        settle();

        expect(form.marketMeta()).toBe('ok');
        expect(form.szDecimals()).toBe(0);
        expect(form.maxLeverage()).toBeNull();
      });
    });

    describe('a market it cannot read', () => {
      beforeEach(() => create((component) => (component.defaultCoin = 'ETHX')));

      it('blocks placement, and says which market and why', () => {
        fill('1', '2000');

        expect(form.marketMeta()).toBe('missing');
        expect(form.isFormInvalid()).toBe(true);
        expect(form.marketMetaMessage()).toContain('"ETHX"');
        expect(form.marketMetaMessage()).toContain('no perp market named');
        expect(form.marketMetaMessage()).toContain('placing an order is disabled');
      });

      it('has no retry: a market missing from its meta does not appear by trying again', () => {
        expect(form.canRetryMarketMeta()).toBe(false);
      });

      it('refuses submit() itself, without calling the gateway: the button is not the only guard', () => {
        const placeOrder = vi.fn();
        (form as unknown as { hlGateway: { placeOrder: unknown } }).hlGateway.placeOrder =
          placeOrder;
        fill('1', '2000');

        form.submit();

        expect(placeOrder).not.toHaveBeenCalled();
        expect(form.error()).toContain('could not be read');
      });

      it('keeps the default grid out of the picture: nothing it reads can be mistaken for the market', () => {
        expect(form.maxLeverage()).toBeNull();
        expect(form.marketMeta()).not.toBe('ok');
      });
    });

    // Observé dans le navigateur le 2026-10-19 : après une lecture réussie, un échec sur le MÊME marché
    // laissait « Cross · 5x / 5x » affiché sous un bandeau qui disait la grille illisible.
    describe('a read that fails after one that succeeded, on the same market', () => {
      it.each([
        [
          'the market is no longer in its meta',
          () => throwError(() => new MarketMetaError('not-found', 'gone')),
        ],
        ['the meta no longer loads', () => throwError(() => new Error('network down'))],
      ])('forgets the leverage it had read, when %s', (_, failing) => {
        create((component) => (component.defaultCoin = 'ETHFI'));
        expect(form.maxLeverage()).toBe(5);

        metaFor = failing as typeof metaFor;
        form.retryMarketMeta();
        settle();

        expect(form.marketMeta()).not.toBe('ok');
        expect(form.maxLeverage()).toBeNull();
      });
    });

    describe('a meta that does not load', () => {
      let fails: boolean;

      beforeEach(() => {
        fails = true;
        metaFor = (coin) =>
          fails ? throwError(() => new Error('network down')) : readFromUniverse(coin);
        create((component) => (component.defaultCoin = 'ETHFI'));
      });

      it('blocks placement and offers a retry: a transport failure may pass', () => {
        fill('1', '0.5');

        expect(form.marketMeta()).toBe('unavailable');
        expect(form.isFormInvalid()).toBe(true);
        expect(form.canRetryMarketMeta()).toBe(true);
        expect(form.marketMetaMessage()).toContain('could not be loaded');
      });

      it('unblocks once a retry reads the grid', () => {
        fails = false;

        form.retryMarketMeta();
        settle();
        // 100 × 0,5 $ = 50 $ : au-dessus du minimum de 10 $, donc seule la grille décidait.
        fill('100', '0.5');

        expect(form.marketMeta()).toBe('ok');
        expect(form.szDecimals()).toBe(1);
        expect(form.isFormInvalid()).toBe(false);
      });
    });

    describe('while the grid is loading', () => {
      it('blocks placement without crying wolf: no red notice for a state of a few instants', () => {
        const pending = new Subject<MarketMeta>();
        metaFor = () => pending;
        create((component) => (component.defaultCoin = 'ETHFI'));
        fill('1', '0.5');

        expect(form.marketMeta()).toBe('loading');
        expect(form.isFormInvalid()).toBe(true);
        expect(form.marketMetaMessage()).toBeNull();

        pending.next({ kind: 'perp', szDecimals: 1, maxLeverage: 5 });
        settle();

        expect(form.marketMeta()).toBe('ok');
      });

      it('still refuses submit() with a message, since a silent refusal is a silent failure', () => {
        const pending = new Subject<MarketMeta>();
        metaFor = () => pending;
        create((component) => (component.defaultCoin = 'ETHFI'));
        fill('1', '0.5');

        form.submit();

        expect(form.error()).toContain('still loading');
      });
    });

    describe('changing market', () => {
      it('ignores the answer of the market it left: the old grid does not overwrite the new one', () => {
        const slow = new Subject<MarketMeta>();
        metaFor = (coin) => (coin === 'ETH' ? slow : readFromUniverse(coin));
        create((component) => (component.defaultCoin = 'ETH'));

        form.selectedCoin.set('ETHFI');
        settle();
        expect(form.szDecimals()).toBe(1);

        // ETH répond APRÈS : sa grille (4 décimales, 25x) ne doit pas remplacer celle d'ETHFI.
        slow.next({ kind: 'perp', szDecimals: 4, maxLeverage: 25 });
        settle();

        expect(form.szDecimals()).toBe(1);
        expect(form.maxLeverage()).toBe(5);
        expect(form.marketMeta()).toBe('ok');
      });

      it('ignores the failure of the market it left: its error does not block the new market', () => {
        const slow = new Subject<MarketMeta>();
        metaFor = (coin) => (coin === 'ETH' ? slow : readFromUniverse(coin));
        create((component) => (component.defaultCoin = 'ETH'));

        form.selectedCoin.set('ETHFI');
        settle();
        expect(form.marketMeta()).toBe('ok');

        // ETH échoue APRÈS : cette panne n'est pas celle d'ETHFI, dont la grille est lue.
        slow.error(new Error('network down'));
        settle();

        expect(form.marketMeta()).toBe('ok');
        expect(form.marketMetaMessage()).toBeNull();
        expect(form.szDecimals()).toBe(1);
      });

      it('forgets the leverage of the previous market until the new one is read', () => {
        create((component) => (component.defaultCoin = 'ETH'));
        expect(form.maxLeverage()).toBe(25);

        const pending = new Subject<MarketMeta>();
        metaFor = () => pending;
        form.selectedCoin.set('ETHFI');
        settle();

        expect(form.maxLeverage()).toBeNull();
        expect(form.marketMeta()).toBe('loading');
      });

      it('goes back to "none" when no market is selected any more', () => {
        create((component) => (component.defaultCoin = 'ETH'));

        form.selectedCoin.set('');
        settle();

        expect(form.marketMeta()).toBe('none');
        expect(form.marketMetaMessage()).toBeNull();
      });
    });
  });
});
