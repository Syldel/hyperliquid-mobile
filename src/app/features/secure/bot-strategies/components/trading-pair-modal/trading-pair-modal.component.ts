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
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonRange,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { ChartInterval, ExchangeStrategy } from '@models/bot.interfaces';
import { BotSettings, TradingPair, TradingStrategy } from '@models/user.interface';
import { BotService } from '@services/bot.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { HLPerpDex } from '@syldel/hl-shared-types';
import { addIcons } from 'ionicons';
import {
  addOutline,
  checkmarkCircle,
  checkmarkOutline,
  closeCircle,
  closeOutline,
  removeOutline,
} from 'ionicons/icons';

type MarketType = 'perp' | 'spot' | 'hip3';

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
    IonSegment,
    IonSegmentButton,
    IonSearchbar,
    IonSpinner,
    IonRange,
    IonToggle,
    IonChip,
    IonNote,
  ],
  templateUrl: './trading-pair-modal.component.html',
  styleUrls: ['./trading-pair-modal.component.scss'],
})
export class TradingPairModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly marketService = inject(HyperliquidMarketService);
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

  marketType = signal<MarketType>('perp');
  searchQuery = signal('');
  isLoadingMarkets = signal(false);
  selectedDex = signal<string>('');

  private perpNames = signal<string[]>([]);
  private spotNames = signal<string[]>([]);
  private perpDexs = signal<HLPerpDex[]>([]);

  readonly dexNames = computed(() => this.perpDexs().map((d) => d.name));

  readonly filteredMarkets = computed(() => {
    let list: string[];
    if (this.marketType() === 'perp') {
      list = this.perpNames();
    } else if (this.marketType() === 'spot') {
      list = this.spotNames();
    } else {
      // hip3 : assets du DEX sélectionné
      const dex = this.perpDexs().find((d) => d.name === this.selectedDex());
      list = dex ? dex.assetToStreamingOiCap.map(([asset]) => asset) : [];
    }
    const q = this.searchQuery().toLowerCase().trim();
    return q ? list.filter((n) => n.toLowerCase().includes(q)) : list;
  });

  private readonly pairMemory: Record<MarketType, ReturnType<typeof signal<string>>> = {
    perp: signal<string>(''),
    spot: signal<string>(''),
    hip3: signal<string>(''),
  };

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
      checkmarkCircle,
      closeCircle,
      removeOutline,
      addOutline,
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

      // Détection du type de marché
      // Les assets HIP-3 ont le format "dex:ASSET" (contiennent ":")
      // Les spots ont le format "BASE/QUOTE" (contiennent "/")
      let type: MarketType = 'perp';

      if (pair.name.includes('/')) {
        type = 'spot';
      } else if (pair.name.includes(':')) {
        type = 'hip3';
        // Retrouver le DEX propriétaire de cet asset
        const ownerDex = this.perpDexs().find((d) =>
          d.assetToStreamingOiCap.some(([asset]) => asset === pair.name),
        );
        if (ownerDex) {
          this.selectedDex.set(ownerDex.name);
        } else {
          // DEX pas encore chargé — on extrait le préfixe "dex:" du nom
          const prefix = pair.name.split(':')[0];
          this.selectedDex.set(prefix);
        }
      }

      this.pairMemory[type].set(pair.name);
      this.marketType.set(type);
    });
  }

  ngOnInit(): void {
    this.form.controls.exchangeKey.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.form.controls.pairName.updateValueAndValidity({ emitEvent: false });
      });

    this.loadMetadata();
    this.loadMarkets();
  }

  // ------------------------------------------------------------------
  //  Market loading
  // ------------------------------------------------------------------

  private loadCount = 0;

  private loadMarkets(): void {
    this.isLoadingMarkets.set(true);
    this.loadCount = 0;

    this.marketService.getPerpNames().subscribe({
      next: (names) => this.perpNames.set(names),
      complete: () => this.checkLoadingDone(),
    });

    this.marketService.getSpotNames().subscribe({
      next: (names) => this.spotNames.set(names),
      complete: () => this.checkLoadingDone(),
    });

    this.marketService.getPerpDexs().subscribe({
      next: (dexs) => {
        // Filtrer les DEX sans assets
        const activeDexs = dexs.filter((d) => d.assetToStreamingOiCap.length > 0);
        this.perpDexs.set(activeDexs);

        if (activeDexs.length > 0 && !this.selectedDex()) {
          this.selectedDex.set(activeDexs[0].name);
        }
      },
      complete: () => this.checkLoadingDone(),
    });
  }

  private checkLoadingDone(): void {
    this.loadCount++;
    if (this.loadCount >= 3) this.isLoadingMarkets.set(false);
  }

  // ------------------------------------------------------------------
  //  UI handlers
  // ------------------------------------------------------------------

  onMarketTypeChange(event: CustomEvent): void {
    const type = event.detail.value as MarketType;
    if (!['perp', 'spot', 'hip3'].includes(type)) return;

    // Sauvegarder la paire courante dans la mémoire de l'onglet actuel
    this.pairMemory[this.marketType()].set(this.form.get('pairName')?.value ?? '');

    this.marketType.set(type);
    this.searchQuery.set('');

    // Restaurer la paire mémorisée pour le nouvel onglet
    this.form.patchValue({ pairName: this.pairMemory[type]() });
  }

  onDexChange(event: CustomEvent): void {
    const dexName = event.detail.value as string;
    if (!dexName || dexName === this.selectedDex()) return;

    // Sauvegarder la paire courante avant de changer de DEX
    this.pairMemory.hip3.set(this.form.get('pairName')?.value ?? '');

    this.selectedDex.set(dexName);
    this.searchQuery.set('');

    // Réinitialiser la paire — elle n'est pas valide sur un autre DEX
    this.form.patchValue({ pairName: '' });
  }

  selectPairName(name: string): void {
    this.form.patchValue({ pairName: name });
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
