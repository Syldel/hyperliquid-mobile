import { Component, computed, input, output } from '@angular/core';
import {
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { trashOutline } from 'ionicons/icons';
import { formatEthereumAddress } from '../../../../core/utils/ethereum-utils';
import { LoginWallet } from '../login-wallet.interface';

@Component({
  selector: 'app-wallet-item',
  standalone: true,
  imports: [IonItemSliding, IonItem, IonLabel, IonIcon, IonItemOptions, IonItemOption],
  templateUrl: './wallet-item.component.html',
  styleUrls: ['./wallet-item.component.scss'],
})
export class WalletItemComponent {
  wallet = input.required<LoginWallet>();

  clicked = output<LoginWallet>();
  deleted = output<LoginWallet>();

  walletName = computed(() => {
    return this.wallet().name;
  });

  formattedAddress = computed(() => {
    return formatEthereumAddress(this.wallet().address, 12, 12);
  });

  constructor() {
    addIcons({ trashOutline });
  }

  onClick() {
    this.clicked.emit(this.wallet());
  }

  onDelete(event: Event) {
    event.stopPropagation();
    this.deleted.emit(this.wallet());
  }
}
