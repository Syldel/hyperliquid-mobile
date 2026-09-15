import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import type { IndicatorMetadata, Operand } from '@syldel/trading-shared-types';
import { OperandEditorModalComponent } from './operand-editor-modal.component';

/**
 * Le formulaire d'opérande est testé pour le seul endroit où il *fabrique* une
 * valeur destinée au bot : le type de ce qu'il écrit dans un opérande
 * `indicator`.
 *
 * Un `ion-input`, même `type="number"`, rend une **chaîne**. Écrite telle
 * quelle, elle traverse tout : la validation partagée ne regarde que `name` et
 * `subField`, et `POST /exchanges/strategies/validate` répond `valid: true`
 * (mesuré). Le bot calcule alors `2 / (period + 1)` avec `period = "20"`, donc
 * `2 / "201"` — un lissage dix fois trop long, sur une stratégie que rien
 * n'accuse. C'est l'incident que ces tests empêchent de revenir.
 */
const emaMeta: IndicatorMetadata = {
  name: 'ema',
  label: 'Exponential Moving Average',
  overlay: true,
  parameters: [{ type: 'number', name: 'period', label: 'Period', defaultValue: 9 }],
};

const ichimokuMeta: IndicatorMetadata = {
  name: 'ichimoku',
  label: 'Ichimoku',
  overlay: true,
  parameters: [
    { type: 'number', name: 'spanPeriod', label: 'Span', defaultValue: 52 },
    {
      type: 'select',
      name: 'pivotType',
      label: 'Pivot',
      defaultValue: 'standard',
      options: [
        { label: 'Standard', value: 'standard' },
        { label: 'Fibonacci', value: 'fibonacci' },
      ],
    },
  ],
};

describe('OperandEditorModalComponent indicator parameters', () => {
  let fixture: ComponentFixture<OperandEditorModalComponent>;
  let component: OperandEditorModalComponent;
  let modalCtrl: { dismissed: { data: unknown; role?: string }[] };

  function mount(operand: Operand): void {
    fixture = TestBed.createComponent(OperandEditorModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('initialOperand', operand);
    fixture.detectChanges();
  }

  /** L'opérande tel qu'il partirait vers l'arbre de règles. */
  function confirmed(): Record<string, unknown> {
    component.confirm();
    return modalCtrl.dismissed.at(-1)?.data as Record<string, unknown>;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OperandEditorModalComponent],
      providers: [
        {
          provide: BotService,
          useValue: {
            indicators: signal([emaMeta, ichimokuMeta]),
            transforms: signal([]),
            functions: signal([]),
            ruleBuilderGrammar: signal(null),
          },
        },
      ],
    });

    modalCtrl = TestBed.inject(ModalController) as unknown as typeof modalCtrl;
    modalCtrl.dismissed.length = 0;
  });

  // La régression elle-même : c'est ce que rend `ion-input`.
  it('writes a number when the field hands back a numeric string', () => {
    mount({ type: 'indicator', name: 'ema', period: 9 } as unknown as Operand);

    component.onParameterChange('period', '20');

    expect(confirmed()['period']).toBe(20);
  });

  // Un paramètre jamais touché garde le défaut du catalogue, déjà numérique.
  it('keeps the catalogue default untouched when the field is never edited', () => {
    mount({ type: 'indicator', name: 'ema', period: 9 } as unknown as Operand);

    expect(confirmed()['period']).toBe(9);
  });

  // Rouvrir un document déjà atteint suffit à le réparer : la valeur relue est
  // ramenée au type que le catalogue déclare, sans attendre une saisie.
  it('repairs a parameter stored as a string by a previous build', () => {
    mount({ type: 'indicator', name: 'ema', period: '20' } as unknown as Operand);

    expect(confirmed()['period']).toBe(20);
  });

  /**
   * `JSON.stringify({ period: NaN })` donne `{"period":null}` : une saisie
   * illisible écrirait une valeur *absente* plutôt qu'une valeur fausse, et le
   * bot retomberait sur son propre défaut. On ne l'écrit pas du tout.
   */
  it('refuses a value that is not a finite number, rather than storing NaN', () => {
    mount({ type: 'indicator', name: 'ema', period: 9 } as unknown as Operand);

    component.onParameterChange('period', 'abc');

    expect(confirmed()['period']).toBe(9);
  });

  // Un champ vidé en cours de frappe n'efface pas la valeur précédente.
  it('ignores an empty field instead of clearing the parameter', () => {
    mount({ type: 'indicator', name: 'ema', period: 9 } as unknown as Operand);

    component.onParameterChange('period', '');

    expect(confirmed()['period']).toBe(9);
  });

  // Le type d'un `select` est celui que le catalogue déclare, pas celui que
  // l'événement transporte.
  it('keeps a select parameter as the catalogue declares it', () => {
    mount({
      type: 'indicator',
      name: 'ichimoku',
      spanPeriod: 52,
      pivotType: 'standard',
    } as unknown as Operand);

    component.onParameterChange('pivotType', 'fibonacci');

    expect(confirmed()['pivotType']).toBe('fibonacci');
  });

  /**
   * Un paramètre que ce build ne connaît pas vient d'un bot plus récent : il
   * traverse tel quel, comme tout ce que l'éditeur ne sait pas interpréter.
   */
  it('passes through a parameter the catalogue does not declare', () => {
    mount({
      type: 'indicator',
      name: 'ema',
      period: 9,
      smoothing: 'wilder',
    } as unknown as Operand);

    expect(confirmed()['smoothing']).toBe('wilder');
  });
});
