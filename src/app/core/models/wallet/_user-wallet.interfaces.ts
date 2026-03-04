import { JwtPayload } from '@models/auth.interfaces';

export interface UserWallet {
  user?: JwtPayload;
  token?: string;
}
