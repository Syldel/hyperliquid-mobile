import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { of } from 'rxjs';
import { MarketPickerModalComponent } from './market-picker-modal.component';

/**
 * Ce que ce spec garde n'est pas le calcul — `market-source.util.spec.ts` s'en
 * charge — mais le **câblage**, parce que c'est là qu'était le défaut :
 * `trading-pair-modal` passait bien l'exchange choisi en `componentProps`, et
 * le composant ne déclarait aucune entrée pour le recevoir. Il listait donc
 * les marchés Hyperliquid pour n'importe quel exchange, sans un mot.
 *
 * Éprouvé sur le code cassé : en retirant l'entrée `exchangeKey` (ou le garde
 * de `ngOnInit`), les deux premiers tests tombent — le service est appelé et
 * `refusal()` rend `null`.
 *
 * Le double compte ses appels plutôt que de rendre des marchés : la question
 * posée est « a-t-on interrogé Hyperliquid ? », et un exchange qu'on ne sait
 * pas servir ne doit produire aucun aller-retour.
 */
describe('MarketPickerModalComponent exchange scoping', () => {
  let fixture: ComponentFixture<MarketPickerModalComponent>;
  let calls: number;

  function mount(exchangeKey: string | undefined): MarketPickerModalComponent {
    fixture = TestBed.createComponent(MarketPickerModalComponent);
    fixture.componentRef.setInput('exchangeKey', exchangeKey);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    calls = 0;
    const count =
      <T>(value: T) =>
      () => {
        calls++;
        return of(value);
      };

    TestBed.configureTestingModule({
      imports: [MarketPickerModalComponent],
      providers: [
        {
          provide: HyperliquidMarketService,
          useValue: {
            getPerpMeta: count({ universe: [{ name: 'BTC', isDelisted: false }] }),
            getSpotNames: count(['PURR/USDC']),
            getPerpDexs: count([]),
          },
        },
      ],
    });
  });

  it('asks Hyperliquid for markets when the pair is on hyperliquid', () => {
    const component = mount('hyperliquid');

    expect(calls).toBeGreaterThan(0);
    expect(component.refusal()).toBeNull();
  });

  it('never fetches hyperliquid markets for another exchange', () => {
    const component = mount('binance');

    // Le cœur du défaut : la modale affichait BTC, ETH, SOL… pour binance.
    expect(calls).toBe(0);
    expect(component.refusal()).toContain('binance');
    expect(component.filteredMarkets()).toEqual([]);
  });

  it('refuses instead of assuming an exchange when the caller passes none', () => {
    const component = mount(undefined);

    expect(calls).toBe(0);
    expect(component.refusal()).not.toBeNull();
  });

  it('refuses to return a market it never should have listed', () => {
    // Défense en profondeur : même si un template laissait passer un clic, un
    // marché Hyperliquid ne doit pas être écrit sur une paire d'un autre
    // exchange — le bot ne l'exécuterait pas.
    const component = mount('binance');
    const dismiss = vi.spyOn(component['modalCtrl'], 'dismiss');

    component.select('BTC');

    expect(dismiss).not.toHaveBeenCalled();
  });
});
