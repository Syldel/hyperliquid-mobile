import { TitleCasePipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonRange,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { ChartInterval, ExchangeStrategy } from '@models/bot.interfaces';
import { BotSettings, TradingPair, TradingStrategy } from '@models/user.interface';
import { BotService } from '@services/bot.service';
import { MarketPickerModalComponent } from '@shared/components/market-picker-modal/market-picker-modal.component';
import { addIcons } from 'ionicons';
import {
  addOutline,
  checkmarkOutline,
  chevronForwardOutline,
  closeCircle,
  closeOutline,
  removeOutline,
} from 'ionicons/icons';

interface TradingPairForm {
  exchangeKey: FormControl<string>;
  pairName: FormControl<string>;
  strategy: FormControl<TradingStrategy>;
  ratio: FormControl<number>;
  interval: FormControl<ChartInterval>;
  enabled: FormControl<boolean>;
}

export interface TradingPairModalResult {
  exchangeKey: string;
  pair: TradingPair;
}

@Component({
  selector: 'app-trading-pair-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TitleCasePipe,
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
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonRange,
    IonToggle,
    IonNote,
    IonText,
  ],
  templateUrl: './trading-pair-modal.component.html',
  styleUrls: ['./trading-pair-modal.component.scss'],
})
export class TradingPairModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly botService = inject(BotService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // ------------------------------------------------------------------
  //  Inputs — provided by the caller via ModalController componentProps
  // ------------------------------------------------------------------

  /** Existing exchanges on the user account. */
  readonly exchanges = input<{ key: string; value: BotSettings }[]>([]);

  /** Pre-fill when editing an existing pair. */
  readonly editPair = input<TradingPair | undefined>();

  /** Pre-fill when editing — the exchange this pair belongs to. */
  readonly editExchangeKey = input<string | undefined>();

  // ------------------------------------------------------------------
  //  State
  // ------------------------------------------------------------------

  isLoadingMetadata = signal(false);
  candleIntervals = signal<ChartInterval[]>([]);
  strategies = signal<ExchangeStrategy[]>([]);
  availableExchanges = signal<string[]>([]);
  strategiesByExchange = signal<Record<string, ExchangeStrategy[]>>({});
  metadataError = signal(false);

  // ------------------------------------------------------------------
  //  Computed
  // ------------------------------------------------------------------

  readonly filteredStrategies = computed(() => {
    const exchangeKey = this.formValue().exchangeKey;
    if (!exchangeKey) return this.strategies();
    return this.strategiesByExchange()[exchangeKey] ?? this.strategies();
  });

  readonly selectableExchanges = computed(() => {
    const fromApi = this.availableExchanges();
    const fromInput = this.exchanges().map((e) => e.key);
    return [...new Set([...fromApi, ...fromInput])];
  });

  // ------------------------------------------------------------------
  //  Metadata loading
  // ------------------------------------------------------------------

  private loadMetadata(): void {
    this.isLoadingMetadata.set(true);
    this.metadataError.set(false);
    this.form.controls.strategy.disable();
    this.form.controls.interval.disable();

    this.botService.getExchangeFormMetadata().subscribe({
      next: (meta) => {
        this.candleIntervals.set(meta.intervals);
        this.availableExchanges.set(meta.exchanges);
        this.strategiesByExchange.set(meta.strategies);

        const all = Object.values(meta.strategies).flat();
        this.strategies.set(all);

        this.form.controls.strategy.enable();
        this.form.controls.interval.enable();
      },
      error: () => {
        this.metadataError.set(true);
        this.isLoadingMetadata.set(false);
      },
      complete: () => this.isLoadingMetadata.set(false),
    });
  }

  // ------------------------------------------------------------------
  //  State
  // ------------------------------------------------------------------

  readonly isEditMode = computed(() => !!this.editPair());

  // ------------------------------------------------------------------
  //  Form
  // ------------------------------------------------------------------

  private pairNameExistsValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const exchangeKey = this.form?.getRawValue().exchangeKey;
      const exchange = this.exchanges?.()?.find((e) => e.key === exchangeKey);
      if (!exchange) return null;

      const existingNames = exchange.value.pairs.map((p) => p.name);
      const currentName = this.editPair?.()?.name;

      const conflict = existingNames.filter((n) => n !== currentName).includes(control.value);

      return conflict ? { pairNameExists: true } : null;
    };
  }

  readonly form = this.fb.nonNullable.group<TradingPairForm>({
    exchangeKey: this.fb.nonNullable.control('', Validators.required),
    pairName: this.fb.nonNullable.control('', [
      Validators.required,
      this.pairNameExistsValidator(),
    ]),
    strategy: this.fb.nonNullable.control<TradingStrategy>(null as any, Validators.required),
    ratio: this.fb.nonNullable.control(0, [
      Validators.required,
      Validators.min(0),
      Validators.max(100),
    ]),
    interval: this.fb.nonNullable.control<ChartInterval>(null as any, Validators.required),
    enabled: this.fb.nonNullable.control(true),
  });

  readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  readonly formStatus = toSignal(this.form.statusChanges, {
    initialValue: this.form.status,
  });

  readonly isValid = computed(() => this.formStatus() === 'VALID');

  // ------------------------------------------------------------------
  //  Lifecycle
  // ------------------------------------------------------------------

  constructor() {
    addIcons({
      closeOutline,
      checkmarkOutline,
      closeCircle,
      removeOutline,
      addOutline,
      chevronForwardOutline,
    });

    effect(() => {
      const pair = this.editPair();
      const exchangeKey = this.editExchangeKey();

      if (!pair) return;

      this.form.patchValue({
        exchangeKey: exchangeKey ?? '',
        pairName: pair.name,
        strategy: pair.strategy,
        ratio: pair.ratio,
        interval: pair.interval,
        enabled: pair.enabled,
      });
    });
  }

  ngOnInit(): void {
    this.form.controls.exchangeKey.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.form.controls.pairName.updateValueAndValidity({ emitEvent: false });
      });

    this.loadMetadata();
  }

  // ------------------------------------------------------------------
  //  UI handlers
  // ------------------------------------------------------------------

  async openMarketPicker(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: MarketPickerModalComponent,
      componentProps: {
        exchange: () => this.form.controls.exchangeKey.value,
        initialValue: () => this.form.controls.pairName.value,
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<string>();
    if (role === 'confirm' && data) {
      this.form.patchValue({ pairName: data });
    }
  }

  compareStrategies = (s1: TradingStrategy, s2: TradingStrategy): boolean => {
    return s1 && s2 ? s1.shortname === s2.shortname : s1 === s2;
  };

  readonly pinFormatter = (value: number) => `${value}%`;

  adjustRatio(delta: number): void {
    const current = this.form.getRawValue().ratio;
    const next = Math.min(100, Math.max(0, current + delta));
    this.form.patchValue({ ratio: next });
  }

  // ------------------------------------------------------------------
  //  Modal actions
  // ------------------------------------------------------------------

  submit(): void {
    if (!this.isValid()) return;

    const formValue = this.form.getRawValue();

    const result: TradingPairModalResult = {
      exchangeKey: formValue.exchangeKey,
      pair: {
        name: formValue.pairName,
        ratio: formValue.ratio,
        interval: formValue.interval,
        enabled: formValue.enabled,
        strategy: formValue.strategy,
      },
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
