import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { ModalController } from '@ionic/angular';
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
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { HLPerpDex } from '@syldel/hl-shared-types';

export type MarketType = 'perp' | 'spot' | 'hip3';

@Component({
  selector: 'app-market-picker-modal',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonText,
    IonList,
    IonItem,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    IonSearchbar,
    IonSpinner,
    IonNote,
  ],
  providers: [ModalController],
  templateUrl: './market-picker-modal.component.html',
  styleUrls: ['./market-picker-modal.component.scss'],
})
export class MarketPickerModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly marketService = inject(HyperliquidMarketService);

  // ------------------------------------------------------------------
  //  Inputs
  // ------------------------------------------------------------------

  readonly initialValue = input<string | undefined>();

  // ------------------------------------------------------------------
  //  State
  // ------------------------------------------------------------------
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
      const dex = this.perpDexs().find((d) => d.name === this.selectedDex());
      list = dex ? dex.assetToStreamingOiCap.map(([asset]) => asset) : [];
    }
    const q = this.searchQuery().toLowerCase().trim();
    return q ? list.filter((n) => n.toLowerCase().includes(q)) : list;
  });

  // ------------------------------------------------------------------
  //  Lifecycle
  // ------------------------------------------------------------------
  ngOnInit(): void {
    this.loadMarkets();

    // Pré-sélection du type de marché si valeur initiale
    const initial = this.initialValue();
    if (initial) {
      if (initial.includes('/')) {
        this.marketType.set('spot');
      } else if (initial.includes(':')) {
        this.marketType.set('hip3');
      }
    }
  }

  // ------------------------------------------------------------------
  //  Markets loading — repris de TradingPairModalComponent
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
    if (++this.loadCount >= 3) this.isLoadingMarkets.set(false);
  }

  // ------------------------------------------------------------------
  //  UI handlers
  // ------------------------------------------------------------------
  onMarketTypeChange(event: CustomEvent): void {
    const type = event.detail.value as MarketType;
    if (!['perp', 'spot', 'hip3'].includes(type)) return;
    this.marketType.set(type);
    this.searchQuery.set('');
  }

  onDexChange(event: CustomEvent): void {
    const dexName = event.detail.value as string;
    if (!dexName || dexName === this.selectedDex()) return;
    this.selectedDex.set(dexName);
    this.searchQuery.set('');
  }

  // ------------------------------------------------------------------
  //  Modal actions
  // ------------------------------------------------------------------
  select(name: string): void {
    this.modalCtrl.dismiss(name, 'confirm');
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
