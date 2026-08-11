import { ComponentFixture, TestBed } from '@angular/core/testing';

import { formatEthereumAddress } from '../../../../core/utils/ethereum-utils';
import { LoginWallet } from '../login-wallet.interface';
import { WalletItemComponent } from './wallet-item.component';

describe('WalletItemComponent', () => {
  let component: WalletItemComponent;
  let fixture: ComponentFixture<WalletItemComponent>;

  const mockWallet: LoginWallet = {
    name: 'My Wallet',
    address: '0x1234567890abcdef1234567890abcdef12345678',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WalletItemComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WalletItemComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('wallet', mockWallet);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('derives walletName and formattedAddress from the "wallet" input', () => {
    expect(component.walletName()).toBe(mockWallet.name);
    expect(component.formattedAddress()).toBe(
      formatEthereumAddress(mockWallet.address, 12, 12),
    );
  });

  it('emits "clicked" with the wallet on onClick()', () => {
    const emitted: LoginWallet[] = [];
    component.clicked.subscribe((w) => emitted.push(w));

    component.onClick();

    expect(emitted).toEqual([mockWallet]);
  });

  it('emits "deleted" with the wallet and stops propagation on onDelete()', () => {
    const emitted: LoginWallet[] = [];
    component.deleted.subscribe((w) => emitted.push(w));
    const event = new Event('click');
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

    component.onDelete(event);

    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(emitted).toEqual([mockWallet]);
  });
});
