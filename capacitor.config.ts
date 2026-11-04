import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sylstudio.hyperliquid',
  appName: 'HyperliquidMobile',
  webDir: 'dist/hyperliquid-mobile/browser',
  android: {
    // `false` REFUSE le contenu mixte : la page étant servie en https://localhost
    // (`androidScheme` vaut `https` par défaut), le WebView bloque les requêtes
    // en http:// — sauf vers localhost, que les navigateurs tiennent pour sûr.
    // C'est la valeur par défaut de Capacitor ; sa doc réserve `true` au
    // développement.
    // ⚠️ Non vérifié sur un appareil : `serviceUrlValidator` accepte http:// vers
    // un réseau local (10.0.2.2, 192.168.x), que ce réglage devrait bloquer.
    allowMixedContent: false,
  },
};

export default config;
