import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TradingPair } from '@models/user.interface';
import { AvailableCapitalService } from '@services/available-capital.service';
import { BotService } from '@services/bot.service';
import type { ExchangesMetaResponse, StrategyMeta } from '@syldel/trading-shared-types';
import { NEVER, of, type Observable } from 'rxjs';
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

/**
 * Le pendant du test « leaves the selector empty » ci-dessus : laisser le
 * champ vide était correct, mais muet. Ces invariants disent quand la modale
 * doit parler — et surtout quand elle doit se taire.
 */
describe('TradingPairModalComponent stalled strategy notice', () => {
  let fixture: ComponentFixture<TradingPairModalComponent>;
  let component: TradingPairModalComponent;

  function mount(edited: TradingPair | undefined, metadata = of(META)): void {
    TestBed.configureTestingModule({
      imports: [TradingPairModalComponent],
      providers: [
        {
          provide: BotService,
          useValue: {
            getExchangeFormMetadata: () => metadata,
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

    fixture = TestBed.createComponent(TradingPairModalComponent);
    component = fixture.componentInstance;
    if (edited) {
      fixture.componentRef.setInput('editPair', edited);
      fixture.componentRef.setInput('editExchangeKey', 'hyperliquid');
    }
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('announces a pair the bot cannot route, rather than only emptying the selector', () => {
    mount(pair({ strategy: { name: 'Neural Momentum Strategy' } } as Partial<TradingPair>));

    expect(component.storedStrategyStatus()).toBe('missing-shortname');
    expect(component.showStalledStrategy()).toBe(true);
  });

  it('announces a strategy the catalogue no longer offers', () => {
    mount(
      pair({
        strategy: { name: 'Neural Momentum Strategy', shortname: 'neural-momentum' },
      } as Partial<TradingPair>),
    );

    expect(component.storedStrategyStatus()).toBe('unknown-shortname');
    expect(component.showStalledStrategy()).toBe(true);
  });

  it('stops announcing once a strategy has been picked', () => {
    // La bannière explique pourquoi le sélecteur est vide ; la garder affichée
    // après un choix décrirait un état que l'écran ne montre plus.
    mount(pair({ strategy: { name: 'Neural Momentum Strategy' } } as Partial<TradingPair>));
    expect(component.showStalledStrategy()).toBe(true);

    component.form.patchValue({ strategy: ADVANCED_RULES });

    expect(component.showStalledStrategy()).toBe(false);
  });

  it('says nothing about a pair the catalogue still offers', () => {
    mount(pair());

    expect(component.storedStrategyStatus()).toBe('ok');
    expect(component.showStalledStrategy()).toBe(false);
  });

  it('never accuses a pair while the catalogue has not answered', () => {
    // Bot injoignable : le sélecteur est vide pour une tout autre raison, et
    // annoncer « plus proposée par le bot » serait un diagnostic faux.
    mount(pair(), NEVER);

    expect(component.storedStrategyStatus()).toBe('unverified');
    expect(component.showStalledStrategy()).toBe(false);
  });

  it('says nothing when a pair is being created', () => {
    mount(undefined);

    expect(component.showStalledStrategy()).toBe(false);
  });
});

/**
 * Une stratégie appartient à un exchange.
 *
 * Ce bloc est le seul à déclarer **deux** exchanges, et c'est tout son objet :
 * le bot n'en sert qu'un, ce qui rendait le catalogue aplati indiscernable du
 * catalogue correct. `spot-grid` n'existe que sur `binance`, `advanced-rules`
 * que sur `hyperliquid` — toute confusion entre les deux se voit.
 */
describe('TradingPairModalComponent exchange-scoped catalogue', () => {
  let fixture: ComponentFixture<TradingPairModalComponent>;
  let component: TradingPairModalComponent;

  const SPOT_GRID: StrategyMeta = { name: 'Spot Grid', shortname: 'spot-grid' };

  const TWO_EXCHANGES = {
    intervals: ['60', '240'],
    exchanges: ['hyperliquid', 'binance'],
    strategies: { hyperliquid: [TOL_LANGIT, ADVANCED_RULES], binance: [SPOT_GRID] },
    globalOptions: {
      exitBehaviors: [{ label: 'No Algo Exit', value: 'NO_ALGO_EXIT', description: '' }],
    },
  } as unknown as ExchangesMetaResponse;

  function mount(
    edited: TradingPair | undefined,
    exchangeKey = 'hyperliquid',
    metadata: Observable<ExchangesMetaResponse> = of(TWO_EXCHANGES),
  ): void {
    TestBed.configureTestingModule({
      imports: [TradingPairModalComponent],
      providers: [
        {
          provide: BotService,
          useValue: {
            getExchangeFormMetadata: () => metadata,
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

    fixture = TestBed.createComponent(TradingPairModalComponent);
    component = fixture.componentInstance;
    if (edited) {
      fixture.componentRef.setInput('editPair', edited);
      fixture.componentRef.setInput('editExchangeKey', exchangeKey);
    }
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('offers only the strategies of the selected exchange', () => {
    mount(pair({ strategy: { name: 'Spot Grid', shortname: 'spot-grid' } }), 'binance');

    expect(component.filteredStrategies()).toEqual([SPOT_GRID]);
  });

  it('resolves the edited pair within its own exchange', () => {
    // Le défaut reporté : la recherche portait sur
    // `Object.values(meta.strategies).flat()`, donc `spot-grid` se résolvait
    // quel que soit l'exchange de la paire.
    mount(pair({ strategy: { name: 'Spot Grid', shortname: 'spot-grid' } }), 'binance');

    expect(component.form.getRawValue().strategy).toBe(SPOT_GRID);
  });

  it('refuses to resolve a strategy served by another exchange', () => {
    // Le symptôme : un `ion-select` portant une valeur absente de ses options.
    mount(pair({ strategy: { name: 'Spot Grid', shortname: 'spot-grid' } }), 'hyperliquid');

    expect(component.form.getRawValue().strategy).toBeNull();
    expect(component.filteredStrategies()).not.toContain(SPOT_GRID);
    expect(component.storedStrategyStatus()).toBe('unknown-shortname');
    expect(component.showStalledStrategy()).toBe(true);
  });

  it('resolves a shortname the bot would route despite its casing', () => {
    // Le moteur compare sur `toLowerCase().trim()` : cette paire tourne. La
    // résolution comparait en `===` strict, laissant le sélecteur vide — et
    // le statut valant `ok`, aucune bannière ne l'expliquait.
    mount(pair({ strategy: { name: 'Advanced', shortname: ' Advanced-Rules ' } }));

    expect(component.storedStrategyStatus()).toBe('ok');
    expect(component.form.getRawValue().strategy).toBe(ADVANCED_RULES);
  });

  it('drops a strategy the newly chosen exchange does not offer', () => {
    mount(pair());
    expect(component.form.getRawValue().strategy).toBe(TOL_LANGIT);

    component.form.patchValue({ exchangeKey: 'binance' });

    expect(component.form.getRawValue().strategy).toBeNull();
    expect(component.isValid()).toBe(false);
  });

  it('keeps a strategy the newly chosen exchange also offers', () => {
    // Effacer un choix encore valable serait aussi arbitraire que garder un
    // choix devenu faux.
    const bothExchanges = {
      ...TWO_EXCHANGES,
      strategies: { hyperliquid: [TOL_LANGIT], binance: [TOL_LANGIT] },
    } as unknown as ExchangesMetaResponse;
    mount(pair(), 'hyperliquid', of(bothExchanges));

    component.form.patchValue({ exchangeKey: 'binance' });

    expect(component.form.getRawValue().strategy).toBe(TOL_LANGIT);
  });

  it('keeps the rules built so far when the strategy is dropped', () => {
    // Les règles appartiennent à l'utilisateur : `usesRules()` les exclut de
    // l'enregistrement tant qu'aucune stratégie ne les réclame, revenir en
    // arrière doit les retrouver.
    mount(
      pair({
        strategy: {
          name: 'Breakout',
          shortname: 'advanced-rules',
          rules: { long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } },
        },
      } as Partial<TradingPair>),
    );

    component.form.patchValue({ exchangeKey: 'binance' });

    expect(component.form.getRawValue().strategy).toBeNull();
    expect(component.ruleDocument()?.name).toBe('Breakout');
  });

  it('announces an exchange the bot declares nothing for', () => {
    // Un sélecteur vide sans un mot serait indiscernable d'un chargement ou
    // d'un bug d'affichage.
    mount(undefined);
    component.form.patchValue({ exchangeKey: 'kraken' });

    expect(component.filteredStrategies()).toEqual([]);
    expect(component.undeclaredExchange()).toBe('kraken');
    expect(component.showUndeclaredExchange()).toBe(true);
  });

  it('names the exchange, not the strategy, when the stored exchange is gone', () => {
    // Le statut reste `unknown-shortname` — la paire ne tourne pas — mais le
    // motif affiché doit désigner le bon coupable.
    mount(pair(), 'kraken');

    expect(component.storedStrategyStatus()).toBe('unknown-shortname');
    expect(component.showStalledStrategy()).toBe(true);
    expect(component.storedExchangeUndeclared()).toBe(true);
    // Pas deux fois le même diagnostic à deux centimètres d'écart.
    expect(component.showUndeclaredExchange()).toBe(false);
  });

  /**
   * Le seul invariant de ce fichier qui s'assure sur le DOM, parce que le
   * défaut n'existait que là : les signaux étaient justes, la phrase affichée
   * ne l'était plus dès que l'utilisateur quittait l'exchange mort.
   */
  it('stops claiming nothing can be picked once the selector fills up', () => {
    mount(pair(), 'kraken');
    const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(component.showStalledStrategy()).toBe(true);
    expect(text()).toContain('No strategy can be picked for the selected exchange');

    component.form.patchValue({ exchangeKey: 'hyperliquid' });
    fixture.detectChanges();

    expect(component.filteredStrategies().length).toBeGreaterThan(0);
    expect(text()).toContain('Pick a strategy below');
    expect(text()).not.toContain('No strategy can be picked');
  });

  it('accuses nothing while the catalogue has not answered', () => {
    mount(pair(), 'kraken', NEVER);

    expect(component.storedExchangeUndeclared()).toBe(false);
    expect(component.showUndeclaredExchange()).toBe(false);
  });
});
