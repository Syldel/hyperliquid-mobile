import { TitleCasePipe } from '@angular/common';
import { Component, computed, effect, inject, input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { BotSettings, TradingPair, TradingStrategy } from '@models/user.interface';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { addIcons } from 'ionicons';
import {
  addOutline,
  checkmarkCircle,
  checkmarkOutline,
  closeCircle,
  closeOutline,
  removeOutline,
} from 'ionicons/icons';

type MarketType = 'perp' | 'spot';

interface TradingPairForm {
  exchangeKey: FormControl<string>;
  pairName: FormControl<string>;
  strategy: FormControl<TradingStrategy>;
  ratio: FormControl<number>;
  interval: FormControl<string>; // CandleInterval
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
  private readonly fb = inject(FormBuilder);

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
  //  Constants
  // ------------------------------------------------------------------

  readonly candleIntervals: string[] = ['15', '60', '240', '1D'];

  readonly strategies: TradingStrategy[] = [
    { name: 'Tol Langit ATR v7 Pro', shortname: 'tol-langit-atr-v7-pro' },
    { name: 'Tol Langit ATR v7 AI Enhanced', shortname: 'tol-langit-atr-v7-ai-enhanced' },
  ];

  // ------------------------------------------------------------------
  //  State
  // ------------------------------------------------------------------

  readonly isEditMode = computed(() => !!this.editPair());

  marketType = signal<MarketType>('perp');
  searchQuery = signal('');
  isLoadingMarkets = signal(false);

  private perpNames = signal<string[]>([]);
  private spotNames = signal<string[]>([]);

  readonly filteredMarkets = computed(() => {
    const list = this.marketType() === 'perp' ? this.perpNames() : this.spotNames();
    const q = this.searchQuery().toLowerCase().trim();
    return q ? list.filter((n) => n.toLowerCase().includes(q)) : list;
  });

  // Mémoire parallèle par marketType
  private readonly pairMemory = {
    perp: signal<string>(''),
    spot: signal<string>(''),
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
    interval: this.fb.nonNullable.control<string>(null as any, Validators.required),
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

      const type: MarketType = pair.name.includes('/') ? 'spot' : 'perp';

      if (pair) {
        this.form.get('exchangeKey')?.disable();

        this.pairMemory[type].set(pair.name);
      }

      this.marketType.set(type);
    });
  }

  ngOnInit(): void {
    this.loadMarkets();
  }

  // ------------------------------------------------------------------
  //  Market loading
  // ------------------------------------------------------------------

  private loadMarkets(): void {
    this.isLoadingMarkets.set(true);

    this.marketService.getPerpNames().subscribe({
      next: (names) => this.perpNames.set(names),
      complete: () => this.checkLoadingDone(),
    });

    this.marketService.getSpotNames().subscribe({
      next: (names) => this.spotNames.set(names),
      complete: () => this.checkLoadingDone(),
    });
  }

  private loadCount = 0;

  private checkLoadingDone(): void {
    this.loadCount++;
    if (this.loadCount >= 2) this.isLoadingMarkets.set(false);
  }

  // ------------------------------------------------------------------
  //  UI handlers
  // ------------------------------------------------------------------

  onMarketTypeChange(event: CustomEvent): void {
    const type = event.detail.value as MarketType;
    if (!['spot', 'perp'].includes(type)) return;

    this.pairMemory[this.marketType()].set(this.form.get('pairName')?.value || '');

    this.marketType.set(type);
    this.searchQuery.set('');

    this.form.patchValue({ pairName: this.pairMemory[type as MarketType]() });
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
