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
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import type { IndicatorMetadata, Operand, PriceField } from '@syldel/trading-shared-types';

/** Les seuls types d'opérande que cette version sait éditer (arith/transform/fn viendront ensuite). */
type EditableOperandType = 'price' | 'number' | 'indicator';

/**
 * Édition d'un opérande unique : un champ de prix, une constante, ou une ligne
 * d'indicateur.
 *
 * Les indicateurs, leurs paramètres et leurs sous-champs viennent tous de
 * `/exchanges/meta` — rien n'est dérivé du paquet compilé. Les paramètres sont
 * écrits **explicitement** dans l'opérande, même lorsque l'utilisateur garde la
 * valeur par défaut : une stratégie doit continuer à calculer la même chose si
 * les défauts du bot changent un jour.
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
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonSegment,
    IonSegmentButton,
  ],
  templateUrl: './operand-editor-modal.component.html',
  styleUrls: ['./operand-editor-modal.component.scss'],
})
export class OperandEditorModalComponent implements OnInit {
  readonly initialOperand = input<Operand | null>(null);
  readonly slotLabel = input<string>('Operand');

  private readonly bot = inject(BotService);
  private readonly modalCtrl = inject(ModalController);

  readonly indicators = this.bot.indicators;
  readonly priceFields = computed(() => this.bot.ruleBuilderGrammar()?.priceFields ?? []);

  readonly type = signal<EditableOperandType>('price');
  readonly priceField = signal<PriceField>('close');
  readonly numberValue = signal<number>(0);
  readonly indicatorName = signal<string>('');
  readonly parameters = signal<Record<string, number | string>>({});
  readonly subField = signal<string>('');
  readonly offset = signal<number>(0);

  readonly selectedMeta = computed<IndicatorMetadata | undefined>(() =>
    this.indicators().find((indicator) => indicator.name === this.indicatorName()),
  );

  readonly subFields = computed(() => this.selectedMeta()?.subFields ?? []);

  /**
   * Un indicateur multi-lignes ne désigne aucune valeur par défaut : `subField`
   * y est obligatoire côté types partagés, donc exigé ici aussi.
   */
  readonly requiresSubField = computed(() => this.subFields().length > 0);

  readonly canConfirm = computed(() => {
    if (this.type() !== 'indicator') return true;
    if (!this.selectedMeta()) return false;
    return !this.requiresSubField() || this.subField().length > 0;
  });

  ngOnInit(): void {
    const operand = this.initialOperand();
    if (!operand) return;

    if (operand.type === 'price') {
      this.type.set('price');
      this.priceField.set(operand.field);
      this.offset.set(operand.offset ?? 0);
      return;
    }

    if (operand.type === 'number') {
      this.type.set('number');
      this.numberValue.set(operand.value);
      return;
    }

    if (operand.type === 'indicator') {
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

      this.type.set('indicator');
      this.indicatorName.set(name);
      this.parameters.set(parameters as Record<string, number | string>);
      this.subField.set(subField ?? '');
      this.offset.set(offset ?? 0);
    }

    // Un opérande arith/transform/fn ouvert par cette version n'est pas
    // éditable ici : la modale s'ouvre sur ses valeurs par défaut, et
    // l'utilisateur reste libre d'annuler sans rien écraser.
  }

  onTypeChange(value: string | number | undefined): void {
    if (value === 'price' || value === 'number' || value === 'indicator') this.type.set(value);
  }

  /** Change d'indicateur : réinitialise paramètres et sous-champ depuis le catalogue serveur. */
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

  confirm(): void {
    const offset = this.offset();
    const withOffset = offset > 0 ? { offset } : {};

    if (this.type() === 'price') {
      this.modalCtrl.dismiss({ type: 'price', field: this.priceField(), ...withOffset }, 'confirm');
      return;
    }

    if (this.type() === 'number') {
      this.modalCtrl.dismiss({ type: 'number', value: this.numberValue() }, 'confirm');
      return;
    }

    // `IndicatorOperand` est une union stricte que ce formulaire dynamique ne
    // peut pas satisfaire à la compilation : la garantie vient de la validation
    // (locale puis serveur), pas du cast.
    const operand = {
      type: 'indicator',
      name: this.indicatorName(),
      ...this.parameters(),
      ...(this.requiresSubField() ? { subField: this.subField() } : {}),
      ...withOffset,
    } as unknown as Operand;

    this.modalCtrl.dismiss(operand, 'confirm');
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
