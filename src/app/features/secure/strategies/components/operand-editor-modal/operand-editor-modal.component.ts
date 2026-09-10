import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import type { IndicatorMetadata, Operand, OperandType, PriceField } from '@syldel/trading-shared-types';
import { addIcons } from 'ionicons';
import { addOutline, closeCircle } from 'ionicons/icons';
import { availableOperandTypes } from '../../domain/operand-types.util';
import { formatOperand } from '../../domain/strategy-format.util';

/**
 * Édition d'un opérande.
 *
 * Les types composés (`arith`, `transform`, `fn`) rouvrent cette même modale
 * pour chacun de leurs sous-opérandes : la récursion passe par la pile de
 * modales, chaque niveau renvoyant sa valeur au précédent. Aucun état partagé
 * n'est nécessaire, contrairement à l'arbre de règles — un opérande est une
 * valeur, pas un document en cours d'édition.
 *
 * Indicateurs, transformations et fonctions viennent tous de
 * `/exchanges/meta`, jamais d'un registre compilé. Les paramètres sont écrits
 * explicitement dans l'opérande, même laissés à leur valeur par défaut : une
 * stratégie doit continuer à calculer la même chose si les défauts du bot
 * changent.
 */
@Component({
  selector: 'app-operand-editor-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonInput,
    IonSelect,
    IonSelectOption,
  ],
  templateUrl: './operand-editor-modal.component.html',
  styleUrls: ['./operand-editor-modal.component.scss'],
})
export class OperandEditorModalComponent implements OnInit {
  readonly initialOperand = input<Operand | null>(null);
  readonly slotLabel = input<string>('Operand');
  /**
   * Profondeur d'imbrication de cet opérande. Au-delà, les types composés ne
   * sont plus proposés : la validation partagée rejette un `arith`/`transform`/
   * `fn` imbriqué trop profondément (`*_TOO_DEEP`), autant ne pas laisser
   * construire ce que le serveur refusera.
   */
  readonly depth = input<number>(0);

  private readonly bot = inject(BotService);
  private readonly modalCtrl = inject(ModalController);

  readonly indicators = this.bot.indicators;
  readonly transforms = this.bot.transforms;
  readonly functions = this.bot.functions;
  readonly priceFields = computed(() => this.bot.ruleBuilderGrammar()?.priceFields ?? []);
  readonly arithOperators = computed(() => this.bot.ruleBuilderGrammar()?.arithOperators ?? []);


  readonly type = signal<OperandType>('price');

  // ── Types simples ──────────────────────────────────────────────────────────
  readonly priceField = signal<PriceField>('close');
  readonly numberValue = signal<number>(0);
  readonly indicatorName = signal<string>('');
  readonly parameters = signal<Record<string, number | string>>({});
  readonly subField = signal<string>('');
  readonly offset = signal<number>(0);

  // ── Types composés ─────────────────────────────────────────────────────────
  readonly arithOperator = signal<string>('ADD');
  readonly left = signal<Operand>({ type: 'price', field: 'close' });
  readonly right = signal<Operand>({ type: 'number', value: 0 });
  readonly transformKind = signal<string>('');
  readonly transformPeriod = signal<number | null>(null);
  readonly source = signal<Operand>({ type: 'price', field: 'close' });
  readonly fnKind = signal<string>('');
  readonly args = signal<Operand[]>([]);

  readonly selectedMeta = computed<IndicatorMetadata | undefined>(() =>
    this.indicators().find((indicator) => indicator.name === this.indicatorName()),
  );

  readonly subFields = computed(() => this.selectedMeta()?.subFields ?? []);

  /**
   * Un indicateur multi-lignes ne désigne aucune valeur par défaut : `subField`
   * y est obligatoire côté types partagés, donc exigé ici aussi.
   */
  readonly requiresSubField = computed(() => this.subFields().length > 0);

  /** Types proposés : la grammaire du serveur, amputée des composés trop profonds. */
  readonly availableTypes = computed(() =>
    availableOperandTypes(this.bot.ruleBuilderGrammar()?.targetTypes ?? [], this.depth()),
  );

  readonly selectedFunction = computed(() =>
    this.functions().find((fn) => fn.kind === this.fnKind()),
  );

  readonly canAddArgument = computed(() => {
    const meta = this.selectedFunction();
    return meta ? this.args().length < (meta.maxArgs ?? 8) : false;
  });

  readonly canRemoveArgument = computed(() => {
    const meta = this.selectedFunction();
    return meta ? this.args().length > meta.minArgs : false;
  });

  readonly canConfirm = computed(() => {
    switch (this.type()) {
      case 'indicator':
        if (!this.selectedMeta()) return false;
        return !this.requiresSubField() || this.subField().length > 0;
      case 'transform':
        return this.transformKind().length > 0;
      case 'fn': {
        const meta = this.selectedFunction();
        if (!meta) return false;
        const count = this.args().length;
        return count >= meta.minArgs && count <= (meta.maxArgs ?? 8);
      }
      default:
        return true;
    }
  });

  constructor() {
    addIcons({ addOutline, closeCircle });
  }

  ngOnInit(): void {
    const operand = this.initialOperand();
    if (!operand) return;

    this.type.set(operand.type);

    switch (operand.type) {
      case 'price':
        this.priceField.set(operand.field);
        this.offset.set(operand.offset ?? 0);
        return;

      case 'number':
        this.numberValue.set(operand.value);
        return;

      case 'arith':
        this.arithOperator.set(operand.operator);
        this.left.set(operand.left);
        this.right.set(operand.right);
        return;

      case 'transform':
        this.transformKind.set(operand.kind);
        this.transformPeriod.set(operand.period ?? null);
        this.source.set(operand.source);
        this.offset.set(operand.offset ?? 0);
        return;

      case 'fn':
        this.fnKind.set(operand.kind);
        this.args.set([...operand.args]);
        return;

      case 'indicator': {
        const {
          type: _type,
          name,
          subField,
          offset,
          ...parameters
        } = operand as Record<string, unknown> & {
          type: string;
          name: string;
          subField?: string;
          offset?: number;
        };

        this.indicatorName.set(name);
        this.parameters.set(parameters as Record<string, number | string>);
        this.subField.set(subField ?? '');
        this.offset.set(offset ?? 0);
      }
    }
  }

  /** Libellé compact d'un sous-opérande, tel qu'affiché sur sa ligne. */
  label(operand: Operand): string {
    return formatOperand(operand);
  }

  onTypeChange(value: OperandType): void {
    this.type.set(value);

    // Un type composé ouvert pour la première fois part sur des valeurs
    // valides : sans ça, `transform` sans `kind` serait immédiatement rejeté.
    if (value === 'transform' && !this.transformKind()) this.selectTransform(this.transforms()[0]?.kind ?? '');
    if (value === 'fn' && !this.fnKind()) this.selectFunction(this.functions()[0]?.kind ?? '');
  }

  onIndicatorChange(name: string): void {
    this.indicatorName.set(name);

    const meta = this.indicators().find((indicator) => indicator.name === name);
    this.parameters.set(
      Object.fromEntries(
        (meta?.parameters ?? []).map((parameter) => [parameter.name, parameter.defaultValue]),
      ),
    );
    this.subField.set('');
  }

  onParameterChange(name: string, value: string | number | null | undefined): void {
    if (value === null || value === undefined || value === '') return;
    this.parameters.update((parameters) => ({ ...parameters, [name]: value }));
  }

  parameterValue(name: string): number | string {
    return this.parameters()[name] ?? '';
  }

  /** Change de transformation et adopte sa fenêtre par défaut, servie par le bot. */
  selectTransform(kind: string): void {
    this.transformKind.set(kind);
    const meta = this.transforms().find((transform) => transform.kind === kind);
    this.transformPeriod.set(meta?.parameters[0]?.defaultValue ?? null);
  }

  /** Change de fonction et ajuste la liste d'arguments à son arité minimale. */
  selectFunction(kind: string): void {
    this.fnKind.set(kind);

    const meta = this.functions().find((fn) => fn.kind === kind);
    if (!meta) return;

    this.args.update((current) => {
      const next = [...current];
      while (next.length < meta.minArgs) next.push({ type: 'number', value: 0 });
      const max = meta.maxArgs ?? 8;
      return next.slice(0, max);
    });
  }

  addArgument(): void {
    this.args.update((current) => [...current, { type: 'number', value: 0 }]);
  }

  removeArgument(index: number): void {
    this.args.update((current) => current.filter((_, position) => position !== index));
  }

  /** Ouvre cette même modale un cran plus bas, pour un sous-opérande. */
  async editNested(
    current: Operand,
    label: string,
    apply: (operand: Operand) => void,
  ): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: OperandEditorModalComponent,
      componentProps: {
        initialOperand: () => current,
        slotLabel: () => label,
        depth: () => this.depth() + 1,
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<Operand>();
    if (role === 'confirm' && data) apply(data);
  }

  editLeft(): Promise<void> {
    return this.editNested(this.left(), 'Left side', (operand) => this.left.set(operand));
  }

  editRight(): Promise<void> {
    return this.editNested(this.right(), 'Right side', (operand) => this.right.set(operand));
  }

  editSource(): Promise<void> {
    return this.editNested(this.source(), 'Source', (operand) => this.source.set(operand));
  }

  editArgument(index: number): Promise<void> {
    return this.editNested(this.args()[index], `Argument ${index + 1}`, (operand) =>
      this.args.update((current) =>
        current.map((existing, position) => (position === index ? operand : existing)),
      ),
    );
  }

  confirm(): void {
    this.modalCtrl.dismiss(this.buildOperand(), 'confirm');
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  private buildOperand(): Operand {
    const offset = this.offset();
    const withOffset = offset > 0 ? { offset } : {};

    switch (this.type()) {
      case 'price':
        return { type: 'price', field: this.priceField(), ...withOffset };

      case 'number':
        return { type: 'number', value: this.numberValue() };

      case 'arith':
        return {
          type: 'arith',
          operator: this.arithOperator(),
          left: this.left(),
          right: this.right(),
        } as Operand;

      case 'transform': {
        const period = this.transformPeriod();
        return {
          type: 'transform',
          kind: this.transformKind(),
          ...(period !== null ? { period } : {}),
          source: this.source(),
          ...withOffset,
        } as Operand;
      }

      case 'fn':
        return { type: 'fn', kind: this.fnKind(), args: this.args() } as Operand;

      default:
        // `IndicatorOperand` est une union stricte que ce formulaire dynamique
        // ne peut pas satisfaire à la compilation : la garantie vient de la
        // validation (locale puis serveur), pas du cast.
        return {
          type: 'indicator',
          name: this.indicatorName(),
          ...this.parameters(),
          ...(this.requiresSubField() ? { subField: this.subField() } : {}),
          ...withOffset,
        } as unknown as Operand;
    }
  }
}
