import { AppConfig } from '@models/app-config.interface';

export const environment: { production: boolean; defaultConfig: AppConfig } = {
  production: true,

  defaultConfig: {
    userServiceUrl: '',
    hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
    hyperliquidGatewayUrl: '',
    botServiceUrl: '',
  },
};
