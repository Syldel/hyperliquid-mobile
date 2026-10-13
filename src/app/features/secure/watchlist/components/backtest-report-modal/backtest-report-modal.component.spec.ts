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
    payoffRatio: null,
    realizedGrossPercent: 0,
    realizedNetPercent: 0,
    unrealizedGrossPercent: 0,
    unrealizedNetPercent: 0,
    maxDrawdown: { depthPercent: 0, peakTime: null, troughTime: null },
    maxDrawdownIntrabar: { depthPercent: 0, peakTime: null, troughTime: null },
    currentDrawdown: { depthPercent: 0, peakTime: null },
    ...overrides,
  };
}

/**
 * L'achat-conservation, plat par défaut : les tests qui ne le regardent pas ne
 * doivent pas le lire non plus.
 */
function holdFixture(): NonNullable<BacktestReport['hold']> {
  return {
    returnPercent: 0,
    maxDrawdown: { depthPercent: 0, peakTime: null, troughTime: null },
    maxDrawdownIntrabar: { depthPercent: 0, peakTime: null, troughTime: null },
    currentDrawdown: { depthPercent: 0, peakTime: null },
  };
}

function report(overrides: Partial<BacktestReport> = {}): BacktestReport {
  return {
    from: H,
    to: 10 * H,
    // Palier taker de base, écrit en clair : un test ne gagne rien à relire
    // la constante du paquet, et il dirait alors la même chose qu'elle.
    feePerSide: 0.00045,
    long: stats({ trades: 2 }),
    short: stats(),
    total: stats({ trades: 2 }),
    hold: holdFixture(),
    exposurePercent: 0,
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
    equity: [{ time: H, long: 0, short: 0, total: 0, hold: 0 }],
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
   * Les bornes de la baisse : la profondeur seule ne dit pas si 25 % se sont
   * joués en quatre heures ou en quatre mois, et c'est cette durée que
   * Freqtrade comme TradingView publient à côté du chiffre.
   */
  it('dates the deepest drawdown and says how long it lasted', () => {
    const host = mount(
      report({
        long: stats({ maxDrawdown: { depthPercent: 25.24, peakTime: 2 * H, troughTime: 9 * H } }),
        short: stats(),
        total: stats({ maxDrawdown: { depthPercent: 25.24, peakTime: 2 * H, troughTime: 9 * H } }),
      }),
    );

    const lines = [...host.querySelectorAll('.drawdowns li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );

    expect(lines[0]).toContain('-25.24%');
    expect(lines[0]).toContain('7 h');
    // Le côté qui n'a jamais baissé ne reçoit pas une borne inventée.
    expect(lines[1]).toContain('never fell below its peak');
  });

  /**
   * `peakTime: null` ne veut pas dire « pas de sommet » depuis les types
   * partagés 0.30.0 : le sommet est le **début de la fenêtre**, que la courbe
   * n'a jamais regagné. Rendu tel quel à un `DatePipe`, ce `null` afficherait
   * « Jan 1, 01:00 » — une date de 1970 présentée comme un sommet de marché.
   */
  it('says the peak is the range start rather than dating it in 1970', () => {
    const host = mount(
      report({
        long: stats({ maxDrawdown: { depthPercent: 8, peakTime: null, troughTime: 4 * H } }),
        short: stats(),
        total: null,
      }),
    );

    const line = host.querySelector('.drawdowns li')?.textContent?.replace(/\s+/g, ' ').trim();

    // La borne gauche est mesurée **avant** la flèche : une date rendue là y
    // apparaîtrait, et les dates de ce fixture tombent justement en 1970.
    expect(line).toMatch(/-8\.00% Range start → /);
  });

  /**
   * La référence à battre, à côté du rendement qu'elle juge. « Ne rien faire »
   * est ce qu'une stratégie doit dépasser pour exister, et un rendement positif
   * affiché seul se lit comme un succès.
   */
  it('puts the benchmark one line under the return it judges', () => {
    const host = mount(
      report({
        total: stats({ realizedNetPercent: -3.28 }),
        hold: {
          returnPercent: 12.5,
          maxDrawdown: { depthPercent: 18.4, peakTime: 2 * H, troughTime: 6 * H },
          maxDrawdownIntrabar: { depthPercent: 20.1, peakTime: 2 * H, troughTime: 6 * H },
          currentDrawdown: { depthPercent: 0, peakTime: 10 * H },
        },
        exposurePercent: 23.4,
      }),
    );

    const rows = [...host.querySelectorAll('tbody tr')].map((tr) => [
      tr.querySelector('th')?.textContent?.trim(),
      tr.querySelector('td')?.textContent?.trim(),
    ]);
    const labels = rows.map((row) => row[0]);

    expect(labels.indexOf('Buy and hold')).toBe(labels.indexOf('Realized, net of fees') + 1);
    expect(rows.find((row) => row[0] === 'Buy and hold')?.[1]).toBe('+12.50%');
    expect(rows.find((row) => row[0] === 'Time in position')?.[1]).toBe('23%');
  });

  it('spreads the benchmark across the sides, having none of its own', () => {
    // Une valeur par colonne ferait croire à un hold par côté ; et une colonne
    // de plus ne tiendrait pas à 360 px.
    const host = mount(report({ hold: { ...holdFixture(), returnPercent: 1 } }));

    const cell = [...host.querySelectorAll('tbody tr')]
      .find((tr) => tr.querySelector('th')?.textContent?.includes('Buy and hold'))
      ?.querySelector('td');

    expect(cell?.getAttribute('colspan')).toBe('3');
  });

  it('gives the benchmark the same drawdown lines as the sides', () => {
    const host = mount(
      report({
        hold: {
          ...holdFixture(),
          maxDrawdown: { depthPercent: 18.4, peakTime: 2 * H, troughTime: 6 * H },
          currentDrawdown: { depthPercent: 5.2, peakTime: 8 * H },
        },
      }),
    );

    const blocks = [...host.querySelectorAll('.drawdowns')].map((ul) =>
      ul.textContent?.replace(/\s+/g, ' ').trim(),
    );

    expect(blocks[0]).toContain('Buy and hold');
    expect(blocks[0]).toContain('-18.40%');
    expect(blocks[1]).toContain('Buy and hold');
  });

  it('reads the payoff ratio, and refuses one it cannot compute', () => {
    const host = mount(
      report({
        long: stats({ payoffRatio: 2.37 }),
        short: stats({ payoffRatio: null }),
        total: null,
      }),
    );

    const cells = [...host.querySelectorAll('tbody tr')]
      .find((tr) => tr.querySelector('th')?.textContent?.includes('Payoff ratio'))
      ?.querySelectorAll('td');

    expect([...(cells ?? [])].map((td) => td.textContent?.trim())).toEqual(['2.37', '—']);
  });

  /**
   * Les trois lectures d'un même creux, que le rapport porte depuis les types
   * partagés 0.31.0. Les afficher ensemble est tout l'intérêt : l'intra-bougie
   * ne peut pas être moins profond que les clôtures, et le courant distingue un
   * creux refermé d'un creux ouvert.
   */
  it('puts the three drawdown readings side by side', () => {
    const host = mount(
      report({
        long: stats({
          maxDrawdown: { depthPercent: 6.88, peakTime: 2 * H, troughTime: 5 * H },
          maxDrawdownIntrabar: { depthPercent: 8.1, peakTime: 2 * H, troughTime: 5 * H },
          currentDrawdown: { depthPercent: 3.2, peakTime: 7 * H },
        }),
        short: stats(),
        total: null,
      }),
    );

    const rowFor = (label: string) =>
      [...host.querySelectorAll('tbody tr')]
        .find((tr) => tr.querySelector('th')?.textContent?.includes(label))
        ?.querySelector('td')
        ?.textContent?.trim();

    expect(rowFor('Max drawdown, net')).toBe('-6.88%');
    expect(rowFor('Max drawdown, intrabar')).toBe('-8.10%');
    expect(rowFor('Below its peak now')).toBe('-3.20%');
  });

  it('says since when a side is still under water, and for how long', () => {
    const host = mount(
      report({
        long: stats({ currentDrawdown: { depthPercent: 3.2, peakTime: 6 * H } }),
        short: stats(),
        total: null,
      }),
    );

    const lines = [...host.querySelectorAll('h2')]
      .find((h) => h.textContent?.includes('Still under water'))
      ?.nextElementSibling?.textContent?.replace(/\s+/g, ' ')
      .trim();

    // La fenêtre court jusqu'à la dernière bougie du rapport (10 h), soit 4 h.
    expect(lines).toContain('Long');
    expect(lines).toContain('since');
    expect(lines).toContain('4 h');
    // La profondeur reste au tableau : la répéter ferait chercher une différence.
    expect(lines).not.toContain('3.20%');
  });

  it('says the drawdowns are closed rather than leaving the section empty', () => {
    // Une section absente se lit comme une donnée manquante ; ici c'est une
    // bonne nouvelle, et elle doit s'écrire.
    const host = mount(report({ long: stats(), short: stats(), total: stats() }));

    const note = [...host.querySelectorAll('h2')]
      .find((h) => h.textContent?.includes('Still under water'))
      ?.nextElementSibling?.textContent?.trim();

    expect(note).toContain('back at its peak');
  });

  it('names the candle instead of a duration when the fall fits inside one', () => {
    /**
     * Creux sur la première bougie, sommet au début de la fenêtre : la durée
     * vaut 0, et « over 0 min » nierait la bougie dans laquelle la chute s'est
     * jouée. Le cas se produit dès qu'une position est ouverte sur la première
     * bougie de la fenêtre — son frais d'entrée met la courbe sous le capital
     * intact.
     */
    const host = mount(
      report({
        long: stats({ maxDrawdown: { depthPercent: 0.045, peakTime: null, troughTime: H } }),
        short: stats(),
        total: null,
      }),
    );

    const line = host.querySelector('.drawdowns li')?.textContent?.replace(/\s+/g, ' ').trim();

    expect(line).toContain('within one candle');
    expect(line).not.toContain('min');
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
