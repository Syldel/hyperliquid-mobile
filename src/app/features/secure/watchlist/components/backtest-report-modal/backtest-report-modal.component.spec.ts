import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/standalone';
import type { BacktestReport, BacktestStats } from '@syldel/trading-shared-types';
import { EquityCurveComponent } from '../equity-curve/equity-curve.component';
import { BacktestReportModalComponent } from './backtest-report-modal.component';

/**
 * La modale n'a qu'un enchaînement à risque — toucher un trade doit recentrer
 * le chart sur **ce** trade — et deux règles d'affichage qui, cassées, feraient
 * lire un chiffre que le bot n'a pas donné : pas de total quand il le refuse,
 * et les anomalies jamais escamotées.
 *
 * La courbe est remplacée par un double : lightweight-charts dessine sur un
 * canvas que jsdom ne sait pas fournir, et ce n'est pas ce qui est testé ici.
 */
@Component({ selector: 'app-equity-curve', standalone: true, template: '' })
class EquityCurveStub {
  readonly lines = input<unknown>();
}

const H = 3_600_000;

function stats(overrides: Partial<BacktestStats> = {}): BacktestStats {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    winRatePercent: null,
    realizedPercent: 0,
    unrealizedPercent: 0,
    maxDrawdown: { depthPercent: 0, peakTime: null, troughTime: null },
    ...overrides,
  };
}

function report(overrides: Partial<BacktestReport> = {}): BacktestReport {
  return {
    from: H,
    to: 10 * H,
    long: stats({ trades: 2 }),
    short: stats(),
    total: stats({ trades: 2 }),
    trades: [
      {
        side: 'LONG',
        entryTime: 2 * H,
        entryPrice: 100,
        exitTime: 3 * H,
        exitPrice: 101,
        returnPercent: 1,
      },
      {
        side: 'LONG',
        entryTime: 5 * H,
        entryPrice: 100,
        exitTime: 7 * H,
        exitPrice: 98,
        returnPercent: -2,
      },
    ],
    openPositions: [],
    carriedIn: [],
    equity: [{ time: H, long: 0, short: 0, total: 0 }],
    overlap: { candles: 0, firstTime: null },
    anomalies: [],
    ...overrides,
  };
}

describe('BacktestReportModalComponent', () => {
  let fixture: ComponentFixture<BacktestReportModalComponent>;
  let modalCtrl: { dismissed: { data: unknown; role?: string }[] };

  function mount(
    value: BacktestReport,
    sides: ('LONG' | 'SHORT')[] = ['LONG', 'SHORT'],
  ): HTMLElement {
    fixture = TestBed.createComponent(BacktestReportModalComponent);
    fixture.componentRef.setInput('name', 'EMA cross');
    fixture.componentRef.setInput('color', '#4dd0e1');
    fixture.componentRef.setInput('report', value);
    fixture.componentRef.setInput('sides', sides);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BacktestReportModalComponent] });
    TestBed.overrideComponent(BacktestReportModalComponent, {
      remove: { imports: [EquityCurveComponent] },
      add: { imports: [EquityCurveStub] },
    });
    modalCtrl = TestBed.inject(ModalController) as unknown as typeof modalCtrl;
    modalCtrl.dismissed.length = 0;
  });

  // Newest first : le trade touché est le premier de la liste, celui de 5h.
  it('closes on a tapped trade and hands back exactly its range', () => {
    const host = mount(report());

    const rows = host.querySelectorAll<HTMLElement>('ion-item[button]');
    rows[0]?.click();

    expect(modalCtrl.dismissed.at(-1)).toEqual({
      role: 'focus',
      data: { entryTime: 5 * H, exitTime: 7 * H },
    });
  });

  it('shows a total column when the report gives one', () => {
    const host = mount(report());

    expect([...host.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toEqual([
      '',
      'Long',
      'Short',
      'Total',
    ]);
  });

  // Le bot ne tient qu'une position par paire : le rapport refuse le total, et
  // l'écran doit dire pourquoi plutôt que de laisser une colonne manquer.
  it('shows no total, and says why, when the sides overlap', () => {
    const host = mount(
      report({ total: null, overlap: { candles: 3, firstTime: 4 * H }, equity: [] }),
    );

    expect(
      [...host.querySelectorAll('thead th')].map((th) => th.textContent?.trim()),
    ).not.toContain('Total');
    expect(host.querySelector('.warning')?.textContent).toContain('cannot get both');
  });

  it('lists every anomaly the bot reported', () => {
    const host = mount(
      report({
        anomalies: [
          {
            code: 'EXIT_WITHOUT_ENTRY',
            time: H,
            side: 'LONG',
            message: 'LONG EXIT ignored: no LONG position is open.',
          },
        ],
      }),
    );

    expect(host.textContent).toContain('LONG EXIT ignored: no LONG position is open.');
  });

  it('only shows the sides the strategy evaluates', () => {
    const host = mount(report(), ['LONG']);

    expect([...host.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toEqual([
      '',
      'Long',
      'Total',
    ]);
  });
});
