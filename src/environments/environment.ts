import { AppConfig } from '@models/app-config.interface';

// Build de développement (`ng serve`) : ces URL amorcent ConfigService tant que
// `app_hl_config` est absent du storage, ce qui évite de ressaisir les quatre
// champs à chaque navigateur neuf. Le build de production les remplace par des
// chaînes vides (fileReplacements dans angular.json) — voir environment.prod.ts.
export const environment: { production: boolean; defaultConfig: AppConfig } = {
  production: false,

  defaultConfig: {
    userServiceUrl: 'http://localhost:3010',
    hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
    hyperliquidGatewayUrl: 'http://localhost:3005',
    botServiceUrl: 'http://localhost:3001',
  },
};
