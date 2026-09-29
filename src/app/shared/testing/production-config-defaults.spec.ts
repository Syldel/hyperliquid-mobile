import { environment as devEnvironment } from 'environments/environment';
import { environment as prodEnvironment } from 'environments/environment.prod';
import { describe, expect, it } from 'vitest';

/**
 * `environment.defaultConfig` amorce ConfigService tant que `app_hl_config` est absente
 * du storage. C'est un confort de développement — le formulaire d'URL Configuration
 * arrive pré-rempli — mais un paquet distribué qui hériterait de ces valeurs
 * interrogerait la machine d'un développeur, et l'échec réseau qui s'ensuit ne nomme pas
 * sa cause. D'où ces invariants, à tenir des deux côtés du `fileReplacements`.
 */
describe('configuration bootstrap per environment', () => {
  const serviceUrls = ['userServiceUrl', 'hyperliquidGatewayUrl', 'botServiceUrl'] as const;

  it('exposes no service URL in the production build', () => {
    for (const key of serviceUrls) {
      expect(prodEnvironment.defaultConfig[key]).toBe('');
    }
  });

  it('keeps the one universal URL — the public Hyperliquid API — in both builds', () => {
    // Elle n'appartient à personne : c'est le même point d'entrée en dev et en prod.
    expect(prodEnvironment.defaultConfig.hyperliquidPublicUrl).toBe('https://api.hyperliquid.xyz');
    expect(devEnvironment.defaultConfig.hyperliquidPublicUrl).toBe(
      prodEnvironment.defaultConfig.hyperliquidPublicUrl,
    );
  });

  it('pre-fills the three service URLs in development', () => {
    // Le bénéfice recherché : un navigateur neuf n'a plus rien à semer dans le storage.
    for (const key of serviceUrls) {
      expect(devEnvironment.defaultConfig[key]).toMatch(/^http:\/\/localhost:\d+$/);
    }
  });

  it('tells the two builds apart by their production flag', () => {
    // Si ce drapeau se désaligne, c'est que le mauvais fichier a été édité.
    expect(devEnvironment.production).toBe(false);
    expect(prodEnvironment.production).toBe(true);
  });
});
