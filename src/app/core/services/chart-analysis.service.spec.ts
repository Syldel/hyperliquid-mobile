import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AnalysisRequest, AnalysisResponse } from '@syldel/trading-shared-types';
import { WITH_WALLET_TOKEN } from '../interceptors/auth.interceptor';
import { ChartAnalysisService } from './chart-analysis.service';
import { ConfigService } from './config.service';

/**
 * Ce service est l'unique porte vers `POST /analysis`, donc vers tout backtest
 * affiché. Il ne décide rien : ce qui se vérifie ici, c'est le contrat de
 * l'appel — où, avec quoi, et surtout ce qu'il ne cache pas.
 */
describe('ChartAnalysisService', () => {
  let service: ChartAnalysisService;
  let httpMock: HttpTestingController;
  let config: { botServiceUrl: string };

  const request: AnalysisRequest = { symbol: 'xyz:BRENTOIL', interval: '60' };

  beforeEach(() => {
    config = { botServiceUrl: 'http://bot.test' };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: config },
      ],
    });
    service = TestBed.inject(ChartAnalysisService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('posts the request unchanged to the bot analysis route', () => {
    service.analyze(request).subscribe();

    const call = httpMock.expectOne('http://bot.test/analysis');
    expect(call.request.method).toBe('POST');
    // Même objet, pas une copie « nettoyée » : un champ retiré ici changerait
    // le marché ou la fenêtre analysés sans que l'écran le sache.
    expect(call.request.body).toBe(request);
    call.flush({});
  });

  it('reads the bot URL at call time, so a reconfigured URL is honoured', () => {
    service.analyze(request).subscribe();
    httpMock.expectOne('http://bot.test/analysis').flush({});

    config.botServiceUrl = 'http://other-bot.test';
    service.analyze(request).subscribe();

    httpMock.expectOne('http://other-bot.test/analysis').flush({});
  });

  // La route est anonyme : lui présenter un jeton n'apporterait rien, et le
  // faire fuiter vers une URL de bot configurée à la main serait un défaut.
  it('does not ask for the wallet token', () => {
    service.analyze(request).subscribe();

    const call = httpMock.expectOne('http://bot.test/analysis');
    expect(call.request.context.get(WITH_WALLET_TOKEN)).toBe(false);
    call.flush({});
  });

  it('hands back the response as received', () => {
    const response = { symbol: 'xyz:BRENTOIL', candles: [] } as unknown as AnalysisResponse;
    let received: AnalysisResponse | undefined;

    service.analyze(request).subscribe((r) => (received = r));
    httpMock.expectOne('http://bot.test/analysis').flush(response);

    expect(received).toEqual(response);
  });

  // Le chart annonce son repli sur des bougies nues à partir de cette erreur
  // (`overlayFailureReason`) : l'avaler ici le rendrait muet.
  it('lets a refusal reach the caller with its status and body', () => {
    let error: { status: number; error: unknown } | undefined;

    service.analyze(request).subscribe({ error: (e) => (error = e) });
    httpMock
      .expectOne('http://bot.test/analysis')
      .flush(
        { message: 'Ambiguous or invalid indicator operand' },
        { status: 400, statusText: 'Bad Request' },
      );

    expect(error?.status).toBe(400);
    expect(error?.error).toEqual({ message: 'Ambiguous or invalid indicator operand' });
  });
});
