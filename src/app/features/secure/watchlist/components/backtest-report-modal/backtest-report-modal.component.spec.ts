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
    realizedGrossPercent: 0,
    realizedNetPercent: 0,
    unrealizedGrossPercent: 0,
    unrealizedNetPercent: 0,
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
        grossReturnPercent: 1,
        netReturnPercent: 1,
      },
      {
        side: 'LONG',
        entryTime: 5 * H,
        entryPrice: 100,
        exitTime: 7 * H,
        exitPrice: 98,
        grossReturnPercent: -2,
        netReturnPercent: -2,
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

  /**
   * Le drawdown n'avait aucun test : toutes les fixtures le laissaient à 0, donc
   * rien ne vérifiait qu'il s'affiche, ni avec quel signe.
   *
   * Depuis la version 0.26.0 des types partagés, `depthPercent` est le drawdown
   * **relatif standard** — un pourcentage du sommet, et non plus un écart de
   * points cumulés sans dénominateur. Un chiffre qui veut enfin dire quelque
   * chose mérite d'être épinglé.
   */
  it('shows the max drawdown as a loss, with its sign', () => {
    const host = mount(
      report({
        long: stats({ maxDrawdown: { depthPercent: 25.24, peakTime: H, troughTime: 5 * H } }),
        short: stats(),
        total: stats({ maxDrawdown: { depthPercent: 25.24, peakTime: H, troughTime: 5 * H } }),
      }),
    );

    const row = [...host.querySelectorAll('tbody tr')].find((tr) =>
      tr.querySelector('th')?.textContent?.includes('Max drawdown'),
    );

    expect([...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.trim())).toEqual([
      '-25.24%',
      '0.00%',
      '-25.24%',
    ]);
  });

  it('leaves a drawdown too small to display uncoloured', () => {
    // La règle que `percentTone` porte : un 0,004 % s'affiche `0.00%`, et le
    // colorer en rouge annoncerait une perte que le texte ne montre pas.
    const host = mount(
      report({
        long: stats({ maxDrawdown: { depthPercent: 0.004, peakTime: H, troughTime: 2 * H } }),
        short: stats(),
        total: null,
      }),
    );

    const cell = [...host.querySelectorAll('tbody tr')]
      .find((tr) => tr.querySelector('th')?.textContent?.includes('Max drawdown'))
      ?.querySelector('td');

    expect(cell?.textContent?.trim()).toBe('0.00%');
    expect(cell?.classList.contains('down')).toBe(false);
  });

  /**
   * Le brut et le net rendus **distincts**, parce que toutes les fixtures les
   * laissaient egaux a zero : rien ne verifiait donc lequel la vue affiche.
   * C'est le meme trou que celui trouve sur le drawdown le 2026-10-08.
   */
  it('shows the net figure where it matters, and the gross beside it', () => {
    const host = mount(
      report({
        long: stats({
          trades: 1,
          realizedGrossPercent: 10,
          realizedNetPercent: 9.8,
          unrealizedGrossPercent: 4,
          unrealizedNetPercent: 3.9,
        }),
        short: stats(),
        total: null,
      }),
    );

    const row = (label: string) =>
      [...host.querySelectorAll('tbody tr')]
        .find((tr) => tr.querySelector('th')?.textContent?.trim() === label)
        ?.querySelector('td')
        ?.textContent?.trim();

    expect(row('Realized, gross')).toBe('+10.00%');
    expect(row('Realized, net of fees')).toBe('+9.80%');
    expect(row('Open, net of fees')).toBe('+3.90%');
  });

  it('shows a trade return net of fees, never gross', () => {
    // Un trade a +1 brut et -0,2 net est une **perte** : l'afficher en vert a
    // +1 dirait l'inverse de ce que le compte a fait.
    const host = mount(
      report({
        trades: [
          {
            side: 'LONG',
            entryTime: 2 * H,
            entryPrice: 100,
            exitTime: 3 * H,
            exitPrice: 101,
            grossReturnPercent: 1,
            netReturnPercent: -0.2,
          },
        ],
      }),
    );

    expect(host.textContent).toContain('-0.20%');
    expect(host.textContent).not.toContain('+1.00%');
  });

  it('says the curve figures are net of fees', () => {
    // Sans ca, l'ecran affiche un pourcentage dont rien ne dit de quoi il est
    // net - le defaut que ce changement corrige.
    const host = mount(report());

    expect(host.textContent).toContain('net of the trading fees');
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
