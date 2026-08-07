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
  IonRange,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  SegmentCustomEvent,
} from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import { IndicatorColorService } from '@shared/components/indicator-picker/services/indicator-color.service';
import { buildIndicatorKey } from '@shared/components/indicator-picker/utils/indicator-key.util';
import {
  getIndicatorSubFieldNames,
  IndicatorMetadata,
  IndicatorParameter,
  IndicatorRequest,
  isIndicatorName,
  isMultiLineIndicator,
  NumberIndicatorParameter,
} from '@syldel/trading-shared-types';
import { addIcons } from 'ionicons';
import {
  addOutline,
  arrowBackOutline,
  closeOutline,
  diceOutline,
  trashOutline,
} from 'ionicons/icons';
import { combineLatest, map, of, startWith, switchMap } from 'rxjs';
import {
  ActiveIndicator,
  IndicatorHlineStyles,
  LineStyleType,
  SubFieldStyle,
} from './models/indicator.model';
import {
  defaultStyleFor,
  SIMPLE_INDICATOR_DEFAULT_COLORS,
} from './utils/indicator-default-styles.util';
import {
  buildDefaultHlineStyles,
  generateHlineId,
  isHlineIndicatorName,
} from './utils/indicator-hline-defaults.util';

type HlineRowControls = {
  id: string;
  visible: FormControl<boolean>;
  value: FormControl<number>;
  color: FormControl<string>;
  lineStyle: FormControl<LineStyleType>;
};

type HlineZoneRowControls = {
  id: string;
  visible: FormControl<boolean>;
  upperValue: FormControl<number>;
  lowerValue: FormControl<number>;
  color: FormControl<string>;
  opacity: FormControl<number>;
};

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
    IonSegment,
    IonSegmentButton,
    IonRange,
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

  activeTab = signal<'inputs' | 'style'>('inputs');

  /** Vrai uniquement pour RSI / Stoch RSI / CHOP / etc. : ces indicateurs affichent en
   *  plus, dans l'onglet "Style", les sections Levels et Zones. */
  hasHlineSection = computed(() => {
    const name = this.selected()?.name;
    return !!name && isHlineIndicatorName(name);
  });

  // Levels : liste dynamique de lignes de niveau (Upper/Lower/... à la TradingView)
  hlineControls = signal<HlineRowControls[]>([]);
  // Zones : liste dynamique de bandes colorées entre deux valeurs
  hlineZoneControls = signal<HlineZoneRowControls[]>([]);

  readonly editingIndicator = input<ActiveIndicator | null>(null);
  readonly isEditMode = computed(() => this.editingIndicator() !== null);

  private userPickedColor = false;
  private lastKey = '';
  private lastHlineKey = '';

  constructor() {
    addIcons({ arrowBackOutline, closeOutline, diceOutline, addOutline, trashOutline });
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
    this.lastHlineKey = '';
    this.activeTab.set('inputs');

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

    if (isHlineIndicatorName(meta.name)) {
      this.buildHlineControls(meta, form.getRawValue());
      form.valueChanges.subscribe((values) =>
        this.buildHlineControls(meta, values as Record<string, number | string>),
      );
    } else {
      this.hlineControls.set([]);
      this.hlineZoneControls.set([]);
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

    this.assertSubFieldsMatchRegistry(meta);

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

  /** Charge (ou initialise) les Levels/Zones pour la clé d'indicateur courante.
   *  Un jeu de départ (buildDefaultHlineStyles) n'est utilisé QUE si rien n'est
   *  encore persisté pour cette clé — l'utilisateur reste libre d'ajouter,
   *  modifier ou supprimer n'importe quelle ligne/zone par la suite. */
  private async buildHlineControls(
    meta: IndicatorMetadata,
    values: Record<string, number | string>,
  ): Promise<void> {
    const name = meta.name;
    if (!isHlineIndicatorName(name)) return;

    const key = buildIndicatorKey({ name, ...values } as IndicatorRequest);
    if (key === this.lastHlineKey) return;
    this.lastHlineKey = key;

    const defaults = buildDefaultHlineStyles(name);
    const stored = await this.colorService.getOrCreateHlines(key, defaults);

    this.hlineControls.set(
      stored.lines.map((l) => ({
        id: l.id,
        visible: new FormControl<boolean>(l.visible, { nonNullable: true }),
        value: new FormControl<number>(l.value, { nonNullable: true }),
        color: new FormControl<string>(l.color, { nonNullable: true }),
        lineStyle: new FormControl<LineStyleType>(l.lineStyle, { nonNullable: true }),
      })),
    );

    this.hlineZoneControls.set(
      stored.zones.map((z) => ({
        id: z.id,
        visible: new FormControl<boolean>(z.visible, { nonNullable: true }),
        upperValue: new FormControl<number>(z.upperValue, { nonNullable: true }),
        lowerValue: new FormControl<number>(z.lowerValue, { nonNullable: true }),
        color: new FormControl<string>(z.color, { nonNullable: true }),
        opacity: new FormControl<number>(z.opacity, { nonNullable: true }),
      })),
    );
  }

  onTabChange(event: SegmentCustomEvent): void {
    const value = event.detail.value;
    if (value === 'inputs' || value === 'style') {
      this.activeTab.set(value);
    }
  }

  addHline(): void {
    const newRow: HlineRowControls = {
      id: generateHlineId(),
      visible: new FormControl<boolean>(true, { nonNullable: true }),
      value: new FormControl<number>(50, { nonNullable: true }),
      color: new FormControl<string>(this.colorService.randomColor(), { nonNullable: true }),
      lineStyle: new FormControl<LineStyleType>('solid', { nonNullable: true }),
    };
    this.hlineControls.update((rows) => [...rows, newRow]);
  }

  removeHline(id: string): void {
    this.hlineControls.update((rows) => rows.filter((r) => r.id !== id));
  }

  addZone(): void {
    const newRow: HlineZoneRowControls = {
      id: generateHlineId(),
      visible: new FormControl<boolean>(true, { nonNullable: true }),
      upperValue: new FormControl<number>(70, { nonNullable: true }),
      lowerValue: new FormControl<number>(30, { nonNullable: true }),
      color: new FormControl<string>(this.colorService.randomColor(), { nonNullable: true }),
      opacity: new FormControl<number>(10, { nonNullable: true }),
    };
    this.hlineZoneControls.update((rows) => [...rows, newRow]);
  }

  removeZone(id: string): void {
    this.hlineZoneControls.update((rows) => rows.filter((r) => r.id !== id));
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
    this.hlineControls.set([]);
    this.hlineZoneControls.set([]);
    this.activeTab.set('inputs');
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

      if (isIndicatorName(meta.name) && isMultiLineIndicator(meta.name)) {
        const missing = getIndicatorSubFieldNames(meta.name).filter((f) => !(f in subFieldStyles));
        if (missing.length) {
          console.warn(
            `[indicator-picker] "${meta.name}" is missing a style for line(s): ${missing.join(', ')}.`,
          );
        }
      }
    } else {
      this.colorService.set(key, active.color);
    }

    if (isHlineIndicatorName(meta.name)) {
      const hlines: IndicatorHlineStyles = {
        lines: this.hlineControls().map((h) => ({
          id: h.id,
          visible: h.visible.value,
          value: h.value.value,
          color: h.color.value,
          lineStyle: h.lineStyle.value,
        })),
        zones: this.hlineZoneControls().map((z) => ({
          id: z.id,
          visible: z.visible.value,
          upperValue: z.upperValue.value,
          lowerValue: z.lowerValue.value,
          color: z.color.value,
          opacity: z.opacity.value,
        })),
      };
      active.hlines = hlines;
      this.colorService.setHlines(key, hlines);
    }

    this.modalCtrl.dismiss(active, 'confirm');
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  /** Garde-fou dev : les subFields renvoyés par le backend (meta.subFields)
   *  doivent matcher exactement le registre partagé INDICATOR_SUBFIELDS. Un
   *  écart (déploiement backend/front désynchronisé, typo) était auparavant un
   *  bug silencieux — couleur aléatoire sans avertissement. */
  private assertSubFieldsMatchRegistry(meta: IndicatorMetadata): void {
    if (!isIndicatorName(meta.name) || !isMultiLineIndicator(meta.name)) return;

    const expected = new Set(getIndicatorSubFieldNames(meta.name));
    const received = new Set((meta.subFields ?? []).map((f) => f.name));

    const missing = [...expected].filter((f) => !received.has(f));
    const unexpected = [...received].filter((f) => !expected.has(f));

    if (missing.length || unexpected.length) {
      console.warn(
        `[indicator-picker] "${meta.name}": subFields mismatch between backend metadata and ` +
          `trading-shared-types registry. Missing: [${missing.join(', ')}]. ` +
          `Unexpected: [${unexpected.join(', ')}].`,
      );
    }
  }
}
