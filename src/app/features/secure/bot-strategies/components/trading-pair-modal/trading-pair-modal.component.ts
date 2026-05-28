import { CurrencyPipe, TitleCasePipe } from '@angular/common';
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
  FormGroup,
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
  IonInput,
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
import { ChartInterval, ExchangeStrategy, ExitBehaviorMeta } from '@models/bot.interfaces';
import {
  BotSettings,
  ExitBehavior,
  StrategyParameter,
  TradingPair,
  TradingStrategy,
} from '@models/user.interface';
import { BotService } from '@services/bot.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
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
import { combineLatest, debounceTime, map, Observable, of, tap } from 'rxjs';

interface TradingPairForm {
  exchangeKey: FormControl<string>;
  pairName: FormControl<string>;
  strategy: FormControl<TradingStrategy>;
  exitBehavior: FormControl<ExitBehavior>;
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
    CurrencyPipe,
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
    IonInput,
  ],
  templateUrl: './trading-pair-modal.component.html',
  styleUrls: ['./trading-pair-modal.component.scss'],
})
export class TradingPairModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly botService = inject(BotService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hlInfo = inject(HyperliquidInfoService);

  // ------------------------------------------------------------------
  //  Inputs
  // ------------------------------------------------------------------

  readonly exchanges = input<{ key: string; value: BotSettings }[]>([]);
  readonly editPair = input<TradingPair | undefined>();
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
  exitBehaviors = signal<ExitBehaviorMeta[]>([]);

  /** FormGroup reconstruit dynamiquement à chaque changement de strategy */
  strategyParamsForm = signal<FormGroup>(this.fb.group({}));

  /** Paramètres de la strategy actuellement sélectionnée */
  readonly currentStrategyParams = signal<StrategyParameter[]>([]);

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

  readonly selectedExitBehaviorDescription = computed(() => {
    const value = this.formValue().exitBehavior;
    return this.exitBehaviors().find((eb) => eb.value === value)?.description ?? '';
  });

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
    exitBehavior: this.fb.nonNullable.control<ExitBehavior>('STRATEGY_SIGNAL', Validators.required),
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

  /** Valide si le form principal ET les paramètres dynamiques sont valides */
  readonly isValid = computed(
    () => this.formStatus() === 'VALID' && this.strategyParamsForm().valid,
  );

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
        this.exitBehaviors.set(meta.globalOptions?.exitBehaviors ?? []);

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
  //  Available Capital
  // ------------------------------------------------------------------

  private readonly capitalCache = new Map<string, number>();

  private getAvailableCapital(dex: string, pairName: string): Observable<number> {
    const isSpot = pairName.includes('/');
    const cacheKey = `${dex || 'hl'}:${isSpot ? 'spot' : 'perp'}`;

    const cached = this.capitalCache.get(cacheKey);
    if (cached !== undefined) return of(cached);

    const request$ = isSpot
      ? this.hlInfo.getTokenBalances().pipe(
          map((balances) => {
            const usdc = balances.find((b) => b.coin === 'USDC');
            return usdc ? parseFloat(usdc.total) : 0;
          }),
        )
      : this.hlInfo
          .getClearinghouseState(dex)
          .pipe(map((state) => parseFloat(state.marginSummary.accountValue)));

    return request$.pipe(tap((capital) => this.capitalCache.set(cacheKey, capital)));
  }

  availableCapital = signal<number | null>(null);
  isLoadingCapital = signal(false);

  private extractDex(pairName: string): string {
    const parts = pairName.split(':');
    return parts.length > 1 ? parts[0] : '';
  }

  private loadCapital(exchangeKey: string, pairName: string): void {
    if (!pairName) {
      this.availableCapital.set(null);
      return;
    }

    if (exchangeKey === 'hyperliquid') {
      const dex = this.extractDex(pairName);

      this.isLoadingCapital.set(true);
      this.getAvailableCapital(dex, pairName)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (capital) => this.availableCapital.set(capital),
          error: () => {
            this.availableCapital.set(null);
            this.isLoadingCapital.set(false);
          },
          complete: () => this.isLoadingCapital.set(false),
        });
    } else {
      this.availableCapital.set(null);
    }
  }

  readonly ratioInUsd = computed(() => {
    const capital = this.availableCapital();
    const ratio = this.formValue().ratio;
    if (capital === null || !ratio) return null;
    return (capital * ratio) / 100;
  });

  // ------------------------------------------------------------------
  //  Dynamic params form builder
  // ------------------------------------------------------------------

  /**
   * Reconstruit le FormGroup des paramètres dynamiques
   * à chaque fois que la strategy change.
   */
  private buildStrategyParamsForm(
    params: StrategyParameter[],
    existingValues?: Record<string, any>,
  ): void {
    const controls: Record<string, FormControl> = {};

    for (const param of params) {
      const savedValue = existingValues?.[param.id];
      const initialValue = savedValue !== undefined ? savedValue : param.default;

      const validators = [];
      if (param.type === 'number') {
        validators.push(Validators.required);
      }

      controls[param.id] = this.fb.nonNullable.control(initialValue, validators);
    }

    this.strategyParamsForm.set(this.fb.group(controls));
    this.currentStrategyParams.set(params);
  }

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

    // Pré-remplissage en mode édition
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
        exitBehavior: pair.exitBehavior ?? 'STRATEGY_SIGNAL',
      });

      // Reconstruit les params avec les valeurs sauvegardées
      if (pair.strategy?.parameters?.length) {
        this.buildStrategyParamsForm(pair.strategy.parameters, pair.strategyParameters);
      }
    });

    // Reconstruction du form dynamique à chaque changement de strategy
    effect(() => {
      const strategy = this.formValue().strategy as TradingStrategy | null;
      const params = strategy?.parameters ?? [];
      this.buildStrategyParamsForm(params);
    });
  }

  ngOnInit(): void {
    this.form.controls.exchangeKey.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.form.controls.pairName.updateValueAndValidity({ emitEvent: false });
      });

    this.loadMetadata();

    combineLatest([
      this.form.controls.exchangeKey.valueChanges,
      this.form.controls.pairName.valueChanges,
    ])
      .pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef))
      .subscribe(([exchangeKey, pairName]) => {
        this.loadCapital(exchangeKey, pairName);
      });
  }

  // ------------------------------------------------------------------
  //  UI helpers
  // ------------------------------------------------------------------

  async openMarketPicker(): Promise<void> {
    // TODO: Should depend on the selected exchange
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

  compareStrategies = (s1: TradingStrategy, s2: TradingStrategy): boolean =>
    s1 && s2 ? s1.shortname === s2.shortname : s1 === s2;

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
    const strategyParams = this.strategyParamsForm().getRawValue();
    const hasParams = Object.keys(strategyParams).length > 0;

    const result: TradingPairModalResult = {
      exchangeKey: formValue.exchangeKey,
      pair: {
        name: formValue.pairName,
        ratio: formValue.ratio,
        interval: formValue.interval,
        enabled: formValue.enabled,
        strategy: formValue.strategy,
        exitBehavior: formValue.exitBehavior,
        strategyParameters: hasParams ? strategyParams : undefined,
      },
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
