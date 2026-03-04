export interface JwtPayload {
  sub: string;
  username: string;
  wallet: string;
  exp: number;
  iat: number;
}

export interface AuthResponse {
  access_token: string;
}

export type TokenMap = Record<string, string>;
