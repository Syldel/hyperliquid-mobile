import type { CapacitorConfig } from '@capacitor/cli';

interface MyCapacitorConfig extends CapacitorConfig {
  bundledWebRuntime?: boolean;
}

const config: MyCapacitorConfig = {
  appId: 'com.syl-studio.hyperliquid',
  appName: 'HyperliquidMobile',
  webDir: 'dist/hyperliquid-mobile/browser',
  bundledWebRuntime: false,
  server: {
    url: 'http://10.10.77.25:8100',
    cleartext: true,
  },
};

export default config;
