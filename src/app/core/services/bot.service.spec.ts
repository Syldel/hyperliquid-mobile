import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ExchangesMetaResponse,
  IndicatorMetadata,
  PACKAGE_VERSION,
} from '@syldel/trading-shared-types';
import { ConfigService } from './config.service';
import { BotService } from './bot.service';

/** Minimal fixture — seuls les champs lus par BotService importent ici. */
function buildMeta(packageVersion: string): ExchangesMetaResponse {
  return {
    intervals: [],
    exchanges: [],
    strategies: {},
    globalOptions: { exitBehaviors: [] },
    indicators: [],
    transforms: [],
    functions: [],
    strategyFormSchema: {
      anchorSources: [],
      orderTypes: [],
      tpslTypes: [],
      positionSides: [],
      ruleBuilderGrammar: {
        nodeTypes: [],
        logicalOperators: [],
        comparisonOperators: [],
        priceFields: [],
        trendDirections: [],
        trendModes: [],
        crossDirections: [],
        arithOperators: [],
        targetTypes: [],
      },
    },
    packageVersion,
  };
}

describe('BotService', () => {
  let service: BotService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BotService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { botServiceUrl: 'http://api.test' } },
      ],
    });

    service = TestBed.inject(BotService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('exposes the locally compiled package version unconditionally', () => {
    expect(service.localPackageVersion).toBe(PACKAGE_VERSION);
  });

  describe('before any metadata fetch', () => {
    it('has no server version and no mismatch (never a false alarm during load)', () => {
      expect(service.serverPackageVersion()).toBeNull();
      expect(service.hasPackageVersionMismatch()).toBe(false);
    });
  });

  describe('after a matching metadata fetch', () => {
    it('reports no mismatch', () => {
      service.getExchangeFormMetadata().subscribe();
      httpMock.expectOne('http://api.test/exchanges/meta').flush(buildMeta(PACKAGE_VERSION));

      expect(service.serverPackageVersion()).toBe(PACKAGE_VERSION);
      expect(service.hasPackageVersionMismatch()).toBe(false);
    });
  });

  describe('after a diverging metadata fetch', () => {
    it('reports a mismatch with the server version', () => {
      const serverVersion = '0.0.1-does-not-match';
      service.getExchangeFormMetadata().subscribe();
      httpMock.expectOne('http://api.test/exchanges/meta').flush(buildMeta(serverVersion));

      expect(service.serverPackageVersion()).toBe(serverVersion);
      expect(service.hasPackageVersionMismatch()).toBe(true);
    });
  });

  describe('invalidateMetadataCache', () => {
    it('resets the server version back to null (mismatch not falsely reported as resolved)', () => {
      service.getExchangeFormMetadata().subscribe();
      httpMock.expectOne('http://api.test/exchanges/meta').flush(buildMeta('0.0.1-does-not-match'));
      expect(service.hasPackageVersionMismatch()).toBe(true);

      service.invalidateMetadataCache();

      expect(service.serverPackageVersion()).toBeNull();
      expect(service.hasPackageVersionMismatch()).toBe(false);
    });
  });

  /**
   * La clé doit reproduire exactement celle que `POST /analysis` produit, mais
   * en la dérivant du catalogue SERVI par le bot — jamais du registre compilé,
   * qui peut être en retard sur les valeurs par défaut réellement exécutées.
   */
  describe('buildIndicatorKey', () => {
    function loadMeta(indicators: IndicatorMetadata[]): void {
      service.getExchangeFormMetadata().subscribe();
      httpMock
        .expectOne('http://api.test/exchanges/meta')
        .flush({ ...buildMeta(PACKAGE_VERSION), indicators });
    }

    const ema: IndicatorMetadata = {
      name: 'ema',
      label: 'EMA',
      overlay: true,
      parameters: [{ type: 'number', name: 'period', label: 'Period', defaultValue: 9 }],
    };

    const macd: IndicatorMetadata = {
      name: 'macd',
      label: 'MACD',
      overlay: false,
      parameters: [
        { type: 'number', name: 'fastPeriod', label: 'Fast', defaultValue: 12 },
        { type: 'number', name: 'slowPeriod', label: 'Slow', defaultValue: 26 },
        { type: 'number', name: 'signalPeriod', label: 'Signal', defaultValue: 9 },
      ],
    };

    const obv: IndicatorMetadata = { name: 'obv', label: 'OBV', overlay: false, parameters: [] };

    it('uses the explicit parameter values, in the order the catalogue declares', () => {
      loadMeta([macd]);

      expect(
        service.buildIndicatorKey({
          name: 'macd',
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9,
        }),
      ).toBe('macd_12_26_9');
    });

    it('fills an omitted parameter with the default SERVED by the bot', () => {
      loadMeta([
        {
          ...ema,
          parameters: [{ type: 'number', name: 'period', label: 'Period', defaultValue: 12 }],
        },
      ]);

      // Le registre compilé dirait `ema_9` ; c'est exactement la dérive évitée.
      expect(service.buildIndicatorKey({ name: 'ema' })).toBe('ema_12');
    });

    it('omits the separator for a parameterless indicator', () => {
      loadMeta([obv]);

      expect(service.buildIndicatorKey({ name: 'obv' })).toBe('obv');
    });

    it('returns null when the indicator is absent from the loaded catalogue', () => {
      loadMeta([ema]);

      expect(service.buildIndicatorKey({ name: 'sma', period: 20 })).toBeNull();
    });

    it('returns null before any catalogue is loaded', () => {
      expect(service.buildIndicatorKey({ name: 'ema', period: 9 })).toBeNull();
    });
  });
});
