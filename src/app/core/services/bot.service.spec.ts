import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ExchangesMetaResponse, PACKAGE_VERSION } from '@syldel/trading-shared-types';
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
});
