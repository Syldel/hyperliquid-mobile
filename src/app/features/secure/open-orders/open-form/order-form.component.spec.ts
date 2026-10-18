import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController, ToastController } from '@ionic/angular/standalone';
import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import { of } from 'rxjs';
import { AvailableCapitalService } from '@services/available-capital.service';
import { HyperliquidGatewayService } from '@services/hyperliquid-gateway.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
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
 * composant lit (`universe[].name / szDecimals / maxLeverage`), et `extractDex` est
 * recopié du vrai service.
 * ============================================================================
 */
describe('OrderFormComponent — price wiring', () => {
  let fixture: ComponentFixture<OrderFormComponent>;
  let form: OrderFormComponent;

  // BTC à 5 décimales de taille : un prix perp arrondi à 5 chiffres significatifs.
  const BTC_META = { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] };

  const marketDouble = {
    getPerpMeta: () => of(BTC_META),
    getSpotMeta: () => of({ tokens: [] }),
    extractDex: (pairName: string) => {
      const parts = pairName.split(':');
      return parts.length > 1 ? parts[0] : '';
    },
    resolveCoin: (name: string) => of(name),
  };
  const infoDouble = {
    getClearinghouseState: () => of({ assetPositions: [] }),
    getActiveAssetData: () => of(null),
  };

  /** Les effets du composant tournent avec la détection de changement, et s'enchaînent. */
  function settle(): void {
    fixture.detectChanges();
    fixture.detectChanges();
  }

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
        { provide: AvailableCapitalService, useValue: { invalidate: () => {} } },
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
});
