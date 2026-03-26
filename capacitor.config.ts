import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sylstudio.hyperliquid',
  appName: 'HyperliquidMobile',
  webDir: 'dist/hyperliquid-mobile/browser',
  android: {
    allowMixedContent: true, // autorise HTTP depuis HTTPS,
  },
};

export default config;
