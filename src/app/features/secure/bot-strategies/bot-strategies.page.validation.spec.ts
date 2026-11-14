import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { ModalController } from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { UserService } from '@services/user.service';
import type {
  ExternalUser,
  IExchange,
  IExchangeStrategy,
  StrategyValidationResult,
} from '@syldel/trading-shared-types';
import { Observable, of, throwError } from 'rxjs';
import { BotStrategiesPage } from './bot-strategies.page';
import { ProtectiveModalComponent } from './components/protective-modal/protective-modal.component';
import { TradingPairModalComponent } from './components/trading-pair-modal/trading-pair-modal.component';

/**
 * Ce que ce fichier garde : **une paire dont le bot refuse la stratégie se signale comme non exécutée.**
 *
 * La liste ne signalait qu'une stratégie inconnue du catalogue. Une stratégie que le bot propose toujours, mais dont le
 * contenu est refusé (« Strategy rejected, no signal will be generated » dans son moteur), s'y affichait comme saine.
 * D'où le catalogue de ce double, qui sert les deux stratégies : seul le verdict de validation peut accuser une paire.
 *
 * Les verdicts sont ceux de `POST /exchanges/strategies/validate` pour les deux stratégies de `rabby_01` relevées ce
 * jour-là (voir `pair-validation-status.util.spec.ts`) ; une seule anomalie est recopiée ici.
 */
const LEGACY: IExchangeStrategy = {
  name: 'Tol Langit ATR v7 Pro',
  shortname: 'tol-langit-atr-v7-pro',
  protective: {
    entries: [{ tpsl: 'sl', atrMultiplier: 1.5, sizePercent: 50 }],
  },
} as unknown as IExchangeStrategy;

const PLAIN: IExchangeStrategy = {
  name: 'Tol Langit ATR v7 AI Enhanced',
  shortname: 'tol-langit-atr-v7-ai-enhanced',
} as IExchangeStrategy;

const MISSING_ANCHOR_MESSAGE =
  'Missing anchor at strategy.protective.entries[0].anchor. An order has to say where it sits: MARKET, ENTRY, EXPRESSION.';

const REFUSED: StrategyValidationResult = {
  valid: false,
  issues: [
    {
      code: 'MISSING_ANCHOR',
      path: 'strategy.protective.entries[0].anchor',
      message: MISSING_ANCHOR_MESSAGE,
      allowed: ['MARKET', 'ENTRY', 'EXPRESSION'],
    },
  ],
};

const ACCEPTED: StrategyValidationResult = { valid: true, issues: [] };

const settings = (enabled: boolean) =>
  ({
    hyperliquid: {
      name: 'hyperliquid',
      enabled: true,
      pairs: [
        { name: 'BTC', ratio: 12, interval: '60', enabled, strategy: LEGACY },
        { name: 'SOL', ratio: 5, interval: '60', enabled, strategy: PLAIN },
      ],
    },
  }) as unknown as Record<string, IExchange>;

describe('BotStrategiesPage — a strategy the bot refuses', () => {
  let page: BotStrategiesPage;
  let asked: string[];
  let reply: (strategy: IExchangeStrategy) => Observable<StrategyValidationResult>;

  beforeEach(() => {
    asked = [];
    reply = (strategy) => of(strategy === LEGACY ? REFUSED : ACCEPTED);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: UserService,
          useValue: { getMe: () => of({}), updateStrategy: () => of({}) },
        },
        {
          provide: BotService,
          useValue: {
            exitBehaviorLabels: () => ({}),
            // Le catalogue sert les deux stratégies : seul le verdict de validation peut accuser une paire ici.
            strategiesByExchange: () => ({ hyperliquid: [LEGACY, PLAIN] }),
            getExchangeFormMetadata: () => of({}),
            validateStrategy: (strategy: IExchangeStrategy) => {
              asked.push(strategy.name);
              return reply(strategy);
            },
          },
        },
        {
          provide: HyperliquidMarketService,
          // Le marché n'est pas en cause : le dex principal (`null` dans `perpDexs`, comme Hyperliquid le rend) porte
          // les deux paires, cotées.
          useValue: {
            getPerpDexs: () => of([null]),
            getPerpMeta: () =>
              of({
                universe: [
                  { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
                  { name: 'SOL', szDecimals: 2, maxLeverage: 20 },
                ],
              }),
          },
        },
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
      ],
    });

    page = TestBed.runInInjectionContext(() => new BotStrategiesPage());
  });

  async function load(enabled = true): Promise<void> {
    page.user.set({ tradingSettings: settings(enabled) } as ExternalUser);
    TestBed.tick();
    await vi.waitFor(() => {
      if (page['validations'].isLoading()) throw new Error('still validating');
    });
  }

  const pair = (name: string) =>
    page.user()!.tradingSettings!['hyperliquid'].pairs.find((p) => p.name === name)!;

  it('flags the pair whose strategy the bot refuses, and only that one', async () => {
    await load();

    expect(page.notRunnable('hyperliquid', pair('BTC'))).toBe(true);
    expect(page.notRunnable('hyperliquid', pair('SOL'))).toBe(false);
  });

  it('says what the bot said', async () => {
    await load();

    const verdict = page.validationStatus('hyperliquid', pair('BTC'));
    expect(verdict.kind).toBe('refused');
    expect(verdict.kind === 'refused' && page.refusalSummary(verdict.issues)).toBe(
      MISSING_ANCHOR_MESSAGE,
    );
  });

  // Ne pas savoir n'est pas un défaut de la paire : un bot injoignable n'allume rien en rouge.
  it('flags nothing when the bot cannot be reached', async () => {
    reply = () => throwError(() => new Error('connection refused'));
    await load();

    expect(page.notRunnable('hyperliquid', pair('BTC'))).toBe(false);
    expect(page.validationStatus('hyperliquid', pair('BTC')).kind).toBe('unverified');
  });

  it('still judges the other pairs when one call fails', async () => {
    reply = (strategy) =>
      strategy === PLAIN ? throwError(() => new Error('timeout')) : of(REFUSED);
    await load();

    expect(page.notRunnable('hyperliquid', pair('BTC'))).toBe(true);
    expect(page.validationStatus('hyperliquid', pair('SOL')).kind).toBe('unverified');
  });

  // Le cas du 2026-11-14 était une paire activée, mais une paire désactivée l'est tout autant : le défaut se
  // révélerait à la réactivation.
  it('flags a disabled pair too', async () => {
    await load(false);

    expect(page.notRunnable('hyperliquid', pair('BTC'))).toBe(true);
  });

  it('does not ask the bot again when a pair is only switched on or off', async () => {
    await load();
    expect(asked).toEqual(['Tol Langit ATR v7 Pro', 'Tol Langit ATR v7 AI Enhanced']);

    page.onPairToggle('hyperliquid', 'SOL', false);
    TestBed.tick();

    expect(asked).toHaveLength(2);
  });

  it('opens the protections of a pair refused for its protections', async () => {
    await load();
    const create = vi.spyOn(TestBed.inject(ModalController), 'create');

    page.fixPair('hyperliquid', pair('BTC'), new Event('click'));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ component: ProtectiveModalComponent }),
    );
  });

  it('opens the pair form for a refusal of its rules', async () => {
    reply = () =>
      of({
        valid: false,
        issues: [{ ...REFUSED.issues[0], path: 'strategy.rules.long.entry' }],
      });
    await load();
    const create = vi.spyOn(TestBed.inject(ModalController), 'create');

    page.fixPair('hyperliquid', pair('BTC'), new Event('click'));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ component: TradingPairModalComponent }),
    );
  });
});
