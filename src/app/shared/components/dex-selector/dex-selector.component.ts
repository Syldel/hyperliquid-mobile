import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { AuthService } from '@auth/auth.service';
import {
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonSkeletonText,
} from '@ionic/angular/standalone';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { StorageService } from '@storage/storage.service';
import { HLPerpDex } from '@syldel/hl-shared-types';

const DEFAULT_DEX_NAME = 'default';

type DexSelectionStorage = Record<string, string[]>;

@Component({
  selector: 'app-dex-selector',
  standalone: true,
  imports: [IonItem, IonLabel, IonSelect, IonSelectOption, IonSkeletonText],
  templateUrl: './dex-selector.component.html',
  styleUrl: './dex-selector.component.scss',
})
export class DexSelectorComponent implements OnInit {
  private readonly hlMarket = inject(HyperliquidMarketService);
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);

  availableDexs = signal<HLPerpDex[]>([]);
  selectedDexNames = signal<string[]>([DEFAULT_DEX_NAME]);
  isLoading = signal(true);

  labelStacked = input<boolean>(false);

  selectionChanged = output<string[]>();

  private readonly STORAGE_KEY = 'selected_dexs';

  async ngOnInit() {
    this.hlMarket.getPerpDexs().subscribe((response) => {
      this.availableDexs.set(response.filter((d): d is HLPerpDex => d !== null));
      this.isLoading.set(false);
    });

    await this.restoreSelection();
  }

  private async restoreSelection() {
    const address = this.auth.currentAddress();
    if (!address) return;

    try {
      const all = (await this.storage.get<DexSelectionStorage>(this.STORAGE_KEY)) ?? {};
      const saved = all[address];

      if (saved?.length) {
        this.selectedDexNames.set(saved);
        this.selectionChanged.emit(this.toApiDexNames(saved));
        return;
      }

      const defaultValue = [DEFAULT_DEX_NAME];
      this.selectedDexNames.set(defaultValue);
      this.selectionChanged.emit(this.toApiDexNames(defaultValue));
    } catch {
      await this.storage.remove(this.STORAGE_KEY);

      const defaultValue = [DEFAULT_DEX_NAME];
      this.selectedDexNames.set(defaultValue);
      this.selectionChanged.emit(this.toApiDexNames(defaultValue));
    }
  }

  async onDexChange(event: CustomEvent) {
    const address = this.auth.currentAddress();
    if (!address) return;

    const updated: string[] = event.detail.value ?? [DEFAULT_DEX_NAME];

    this.selectedDexNames.set(updated);

    const all = (await this.storage.get<DexSelectionStorage>(this.STORAGE_KEY)) ?? {};
    all[address] = updated;

    await this.storage.set(this.STORAGE_KEY, all);

    this.selectionChanged.emit(this.toApiDexNames(updated));
  }

  private toApiDexNames(names: string[]): string[] {
    return names.map((n) => (n === DEFAULT_DEX_NAME ? '' : n));
  }
}
