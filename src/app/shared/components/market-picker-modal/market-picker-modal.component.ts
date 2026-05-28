import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { ModalController } from '@ionic/angular';
import {
  IonBadge,
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
import { HLPerpDex, HLPerpMeta } from '@syldel/hl-shared-types';
import { addIcons } from 'ionicons';
import { closeOutline, searchOutline } from 'ionicons/icons';

export type MarketType = 'perp' | 'spot' | 'hip3';

interface MarketEntry {
  name: string;
  isDelisted: boolean;
}

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
    IonBadge,
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
  isLoadingDexMeta = signal(false);

  private perpMeta = signal<HLPerpMeta | null>(null);
  private spotNames = signal<string[]>([]);
  private perpDexs = signal<HLPerpDex[]>([]);
  private dexMeta = signal<HLPerpMeta | null>(null);

  readonly dexNames = computed(() => this.perpDexs().map((d) => d.name));

  readonly filteredMarkets = computed((): MarketEntry[] => {
    let assets: string[];
    let delistedSet = new Set<string>();

    if (this.marketType() === 'perp') {
      const meta = this.perpMeta();
      assets = meta?.universe.map((u) => u.name) ?? [];
      delistedSet = new Set(meta?.universe.filter((u) => u.isDelisted).map((u) => u.name) ?? []);
    } else if (this.marketType() === 'spot') {
      assets = this.spotNames();
    } else {
      // HIP-3
      const dex = this.perpDexs().find((d) => d.name === this.selectedDex());
      assets = dex ? dex.assetToStreamingOiCap.map(([asset]) => asset) : [];
      const meta = this.dexMeta();
      delistedSet = new Set(meta?.universe.filter((u) => u.isDelisted).map((u) => u.name) ?? []);
    }

    const q = this.searchQuery().toLowerCase().trim();
    const filtered = q ? assets.filter((n) => n.toLowerCase().includes(q)) : assets;

    return filtered.map((name) => ({ name, isDelisted: delistedSet.has(name) }));
  });

  // ------------------------------------------------------------------
  //  Lifecycle
  // ------------------------------------------------------------------
  ngOnInit(): void {
    addIcons({ closeOutline, searchOutline });

    this.loadMarkets();

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
  //  Markets loading
  // ------------------------------------------------------------------
  private loadCount = 0;

  private loadMarkets(): void {
    this.isLoadingMarkets.set(true);
    this.loadCount = 0;

    this.marketService.getPerpMeta().subscribe({
      next: (meta) => this.perpMeta.set(meta),
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

        const firstDex = this.selectedDex() || activeDexs[0]?.name;
        if (firstDex) {
          this.selectedDex.set(firstDex);
          this.loadDexMeta(firstDex);
        }
      },
      complete: () => this.checkLoadingDone(),
    });
  }

  private checkLoadingDone(): void {
    if (++this.loadCount >= 3) this.isLoadingMarkets.set(false);
  }

  // ------------------------------------------------------------------
  //  Load Dex Meta
  // ------------------------------------------------------------------
  private loadDexMeta(dexName: string): void {
    this.isLoadingDexMeta.set(true);
    this.dexMeta.set(null);
    this.marketService.getPerpMeta(dexName).subscribe({
      next: (meta) => this.dexMeta.set(meta),
      complete: () => this.isLoadingDexMeta.set(false),
    });
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
    this.loadDexMeta(dexName);
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
