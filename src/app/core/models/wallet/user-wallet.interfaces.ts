import { Wallet } from './wallet.interfaces';

export interface UserWallet {
  name: string;
  wallet: Wallet;
  user?: any;
  token?: string;
}
