import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TradingPair } from '@models/user.interface';
import { AvailableCapitalService } from '@services/available-capital.service';
import { BotService } from '@services/bot.service';
import type { ExchangesMetaResponse, StrategyMeta } from '@syldel/trading-shared-types';
import { of } from 'rxjs';
import { TradingPairModalComponent } from './trading-pair-modal.component';

/**
 * Le composant est testé sur son pré-remplissage, et sur lui seul.
 *
 * C'est là qu'un défaut est passé inaperçu longtemps : l'hydratation vivait
 * dans un `effect`, qui se ré-exécutait à la fermeture d'une modale ouverte
 * par-dessus et remettait le formulaire aux valeurs enregistrées, effaçant ce
 * que l'utilisateur venait de saisir. Rejouer ce déclencheur exact demanderait
 * le cycle de vie des overlays Ionic ; c'est la **propriété** qui est vérifiée
 * ici — hydrater n'a lieu qu'une fois, quoi qu'on appelle.
 */
const ADVANCED_RULES: StrategyMeta = {
  name: 'Advanced Logical Rules',
  shortname: 'advanced-rules',
  description: 'Trees of logical conditions',
  parameters: [
    { id: 'long.entry', label: 'Long Entry Rules', type: 'rule-builder', defaultValue: null },
    { id: 'long.exit', label: 'Long Exit Rules', type: 'rule-builder', defaultValue: null },
  ],
};

const TOL_LANGIT: StrategyMeta = {
  name: 'Tol Langit ATR v7 Pro',
  shortname: 'tol-langit-atr-v7-pro',
};

const META = {
  intervals: ['60', '240'],
  exchanges: ['hyperliquid'],
  strategies: { hyperliquid: [TOL_LANGIT, ADVANCED_RULES] },
  globalOptions: {
    exitBehaviors: [{ label: 'No Algo Exit', value: 'NO_ALGO_EXIT', description: '' }],
  },
} as unknown as ExchangesMetaResponse;

function pair(overrides: Partial<TradingPair> = {}): TradingPair {
  return {
    name: 'SOL',
    ratio: 20,
    interval: '60',
    enabled: true,
    exitBehavior: 'NO_ALGO_EXIT',
    strategy: { name: 'Tol Langit ATR v7 Pro', shortname: 'tol-langit-atr-v7-pro' },
    ...overrides,
  } as TradingPair;
}

describe('TradingPairModalComponent prefill', () => {
  let fixture: ComponentFixture<TradingPairModalComponent>;
  let component: TradingPairModalComponent;

  function mount(edited: TradingPair | undefined): void {
    fixture = TestBed.createComponent(TradingPairModalComponent);
    component = fixture.componentInstance;
    if (edited) {
      fixture.componentRef.setInput('editPair', edited);
      fixture.componentRef.setInput('editExchangeKey', 'hyperliquid');
    }
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TradingPairModalComponent],
      providers: [
        {
          provide: BotService,
          useValue: {
            getExchangeFormMetadata: () => of(META),
            indicators: signal([]),
            transforms: signal([]),
            validateStrategy: () => of({ valid: true, issues: [] }),
          },
        },
        {
          provide: AvailableCapitalService,
          useValue: { getAvailableCapital: () => of(1000) },
        },
      ],
    });
  });

  it('copies the edited pair into the form', () => {
    mount(pair());

    expect(component.form.getRawValue()).toMatchObject({
      exchangeKey: 'hyperliquid',
      pairName: 'SOL',
      ratio: 20,
      interval: '60',
      enabled: true,
      exitBehavior: 'NO_ALGO_EXIT',
    });
  });

  /**
   * Le défaut, verrouillé. Ce que l'utilisateur a saisi doit survivre à une
   * seconde hydratation — ce que la fermeture d'une sous-modale provoquait.
   */
  it('does not overwrite what the user changed when it runs again', () => {
    mount(pair());
    component.form.patchValue({ ratio: 42, pairName: 'BTC' });

    component.ngOnInit();

    expect(component.form.getRawValue().ratio).toBe(42);
    expect(component.form.getRawValue().pairName).toBe('BTC');
  });

  it('keeps the rules the user picked when it runs again', () => {
    mount(
      pair({
        strategy: {
          name: 'Stored',
          shortname: 'advanced-rules',
          rules: { long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } },
        },
      } as Partial<TradingPair>),
    );
    expect(component.ruleDocument()?.name).toBe('Stored');

    // L'utilisateur en choisit une autre dans sa bibliothèque.
    component.ruleDocument.set({
      id: 'st_picked',
      name: 'Picked',
      rules: {},
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: 1,
    });

    component.ngOnInit();

    expect(component.ruleDocument()?.name).toBe('Picked');
  });

  /**
   * Le contrôle `strategy` porte le *schéma* du formulaire, que seul
   * `/exchanges/meta` fournit : il est rebranché sur le catalogue par
   * `shortname`, jamais recopié depuis la paire enregistrée.
   */
  it('resolves the strategy from the catalogue rather than from the stored pair', () => {
    mount(pair());

    expect(component.form.getRawValue().strategy).toBe(TOL_LANGIT);
  });

  // Le bot aiguille sur `shortname` : une paire héritée qui n'en a pas ne peut
  // pas être ré-enregistrée telle quelle.
  it('leaves the selector empty for a pair whose strategy is not in the catalogue', () => {
    mount(pair({ strategy: { name: 'Neural Momentum Strategy' } } as Partial<TradingPair>));

    expect(component.form.getRawValue().strategy).toBeNull();
    expect(component.isValid()).toBe(false);
  });

  it('hydrates the rules of an advanced-rules pair', () => {
    mount(
      pair({
        strategy: {
          name: 'Breakout',
          shortname: 'advanced-rules',
          rules: { long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } },
        },
      } as Partial<TradingPair>),
    );

    expect(component.ruleDocument()?.name).toBe('Breakout');
    expect(component.ruleDocument()?.rules).toEqual({
      long: { entry: { type: 'logical', operator: 'AND', conditions: [] } },
    });
  });

  it('leaves an empty form when no pair is being edited', () => {
    mount(undefined);

    expect(component.form.getRawValue().pairName).toBe('');
    expect(component.ruleDocument()).toBeNull();
  });
});
