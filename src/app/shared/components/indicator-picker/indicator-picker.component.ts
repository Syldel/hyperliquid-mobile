import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  IonButton,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import { IndicatorColorService } from '@shared/components/indicator-picker/services/indicator-color.service';
import { buildIndicatorKey } from '@shared/components/indicator-picker/utils/indicator-key.util';
import {
  IndicatorMetadata,
  IndicatorParameter,
  IndicatorRequest,
  NumberIndicatorParameter,
} from '@syldel/trading-shared-types';
import { addIcons } from 'ionicons';
import { arrowBackOutline, closeOutline, diceOutline } from 'ionicons/icons';
import { combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { ActiveIndicator, SubFieldStyle } from './models/indicator.model';
import {
  defaultStyleFor,
  SIMPLE_INDICATOR_DEFAULT_COLORS,
} from './utils/indicator-default-styles.util';

@Component({
  selector: 'app-indicator-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonInput,
    IonSpinner,
    IonSelect,
    IonSelectOption,
    IonCheckbox,
  ],
  templateUrl: './indicator-picker.component.html',
  styleUrls: ['./indicator-picker.component.scss'],
})
export class IndicatorPickerComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly botService = inject(BotService);
  private readonly colorService = inject(IndicatorColorService);
  private readonly destroyRef = inject(DestroyRef);

  loading = signal(true);
  indicators = signal<IndicatorMetadata[]>([]);
  selected = signal<IndicatorMetadata | null>(null);
  form = signal<FormGroup | null>(null);

  // Pour un indicateur SANS subFields (EMA, RSI, HMA...)
  colorControl = new FormControl<string>('#ffffff', { nonNullable: true });

  // Pour un indicateur AVEC subFields (BB, Ichimoku, MACD...) : une entrée par champ
  subFieldControls = signal<
    {
      name: string;
      label: string;
      color: FormControl<string>;
      lineStyle: FormControl<'solid' | 'dashed' | 'dotted'>;
      visible: FormControl<boolean>;
    }[]
  >([]);

  anySubFieldVisible = toSignal(
    toObservable(this.subFieldControls).pipe(
      switchMap((controls) =>
        controls.length === 0
          ? of(true)
          : combineLatest(
              controls.map((c) => c.visible.valueChanges.pipe(startWith(c.visible.value))),
            ).pipe(map((values) => values.some(Boolean))),
      ),
    ),
    { initialValue: true },
  );

  readonly editingIndicator = input<ActiveIndicator | null>(null);
  readonly isEditMode = computed(() => this.editingIndicator() !== null);

  private userPickedColor = false;
  private lastKey = '';

  constructor() {
    addIcons({ arrowBackOutline, closeOutline, diceOutline });
    this.botService.getExchangeFormMetadata().subscribe({
      next: (meta) => {
        this.indicators.set(meta.indicators);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    effect(() => {
      const indicator = this.editingIndicator();
      const meta = this.indicators();

      if (!indicator || meta.length === 0) {
        return;
      }

      const targetMeta = meta.find((m) => m.name === indicator.request.name);
      if (targetMeta) {
        this.pick(targetMeta, indicator.request);
      }
    });
  }

  private validatorsFor(p: IndicatorParameter) {
    if (p.type === 'number') {
      const numeric = p as NumberIndicatorParameter;
      const validators = [Validators.required];
      if (numeric.min !== undefined) validators.push(Validators.min(numeric.min));
      if (numeric.max !== undefined) validators.push(Validators.max(numeric.max));
      return validators;
    }
    return [Validators.required];
  }

  pick(meta: IndicatorMetadata, initialValues?: IndicatorRequest): void {
    const group: Record<string, FormControl<number | string>> = {};
    for (const p of meta.parameters) {
      const initial =
        initialValues && p.name in initialValues
          ? (initialValues as Record<string, number | string>)[p.name]
          : p.defaultValue;
      group[p.name] = new FormControl<number | string>(initial, {
        nonNullable: true,
        validators: this.validatorsFor(p),
      });
    }
    const form = new FormGroup(group);
    this.selected.set(meta);
    this.form.set(form);
    this.userPickedColor = false;
    this.lastKey = '';

    if (meta.subFields?.length) {
      this.buildSubFieldControls(meta, form.getRawValue());
      form.valueChanges.subscribe((values) =>
        this.buildSubFieldControls(meta, values as Record<string, number>),
      );
    } else {
      this.suggestColor(meta, form.getRawValue());
      form.valueChanges.subscribe((values) =>
        this.suggestColor(meta, values as Record<string, number>),
      );
    }
  }

  /** Résout couleur/style par sous-champ : stocké précédemment > défaut TradingView > aléatoire. */
  private async buildSubFieldControls(
    meta: IndicatorMetadata,
    values: Record<string, number | string>,
  ): Promise<void> {
    const key = buildIndicatorKey({ name: meta.name, ...values } as IndicatorRequest);
    if (key === this.lastKey) return;
    this.lastKey = key;

    const controls = await Promise.all(
      (meta.subFields ?? []).map(async (sf) => {
        const fallback = defaultStyleFor(meta.name, sf.name, this.colorService.randomColor());
        const resolved = await this.colorService.getOrCreateSubField(key, sf.name, fallback);

        const color = new FormControl(resolved.color, {
          nonNullable: true,
        });

        const lineStyle = new FormControl<'solid' | 'dashed' | 'dotted'>(resolved.lineStyle, {
          nonNullable: true,
        });

        const visible = new FormControl<boolean>(resolved.visible ?? true, {
          nonNullable: true,
        });

        const updateDisabled = (isVisible: boolean) => {
          if (isVisible) {
            color.enable({ emitEvent: false });
            lineStyle.enable({ emitEvent: false });
          } else {
            color.disable({ emitEvent: false });
            lineStyle.disable({ emitEvent: false });
          }
        };

        // Etat initial
        updateDisabled(visible.value);

        // Synchronisation
        visible.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(updateDisabled);

        return {
          name: sf.name,
          label: sf.label,
          color,
          lineStyle,
          visible,
        };
      }),
    );

    this.subFieldControls.set(controls);
  }

  private async suggestColor(
    meta: IndicatorMetadata,
    values: Record<string, number | string>,
  ): Promise<void> {
    const key = buildIndicatorKey({ name: meta.name, ...values } as IndicatorRequest);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const stored = await this.colorService.peek(key);
    if (stored) {
      this.colorControl.setValue(stored);
      this.userPickedColor = false;
    } else if (!this.userPickedColor) {
      const fallback =
        SIMPLE_INDICATOR_DEFAULT_COLORS[meta.name] ?? this.colorService.randomColor();
      this.colorControl.setValue(fallback);
    }
  }

  onColorInput(): void {
    this.userPickedColor = true;
  }

  randomizeColor(): void {
    this.colorControl.setValue(this.colorService.randomColor());
    this.userPickedColor = true;
  }

  back(): void {
    this.selected.set(null);
    this.form.set(null);
    this.subFieldControls.set([]);
  }

  confirm(): void {
    const meta = this.selected();
    const form = this.form();
    if (!meta || !form || form.invalid) return;

    const request = { name: meta.name, ...form.getRawValue() } as IndicatorRequest;
    const key = buildIndicatorKey(request);
    const editing = this.editingIndicator();

    const active: ActiveIndicator = {
      id: editing?.id ?? `${meta.name}-${Math.random().toString(36).slice(2, 6)}`,
      request,
      visible: editing?.visible ?? true,
      color: this.colorControl.value,
    };

    if (meta.subFields?.length) {
      const subFieldStyles: Record<string, SubFieldStyle> = {};
      this.subFieldControls().forEach((c) => {
        const style: SubFieldStyle = {
          color: c.color.value,
          lineStyle: c.lineStyle.value,
          visible: c.visible.value,
        };
        subFieldStyles[c.name] = style;
        this.colorService.setSubField(key, c.name, style);
      });
      active.subFieldStyles = subFieldStyles;
    } else {
      this.colorService.set(key, active.color);
    }

    this.modalCtrl.dismiss(active, 'confirm');
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
