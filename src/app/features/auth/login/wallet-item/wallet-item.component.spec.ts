import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WalletItemComponent } from './wallet-item.component';

describe('WalletItemComponent', () => {
  let component: WalletItemComponent;
  let fixture: ComponentFixture<WalletItemComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WalletItemComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WalletItemComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
