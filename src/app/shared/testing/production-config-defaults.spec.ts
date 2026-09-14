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
describe('amorçage de la configuration par environnement', () => {
  const serviceUrls = ['userServiceUrl', 'hyperliquidGatewayUrl', 'botServiceUrl'] as const;

  it("n'expose aucune URL de service dans le build de production", () => {
    for (const key of serviceUrls) {
      expect(prodEnvironment.defaultConfig[key]).toBe('');
    }
  });

  it("garde la seule URL universelle — l'API publique Hyperliquid — dans les deux builds", () => {
    // Elle n'appartient à personne : c'est le même point d'entrée en dev et en prod.
    expect(prodEnvironment.defaultConfig.hyperliquidPublicUrl).toBe('https://api.hyperliquid.xyz');
    expect(devEnvironment.defaultConfig.hyperliquidPublicUrl).toBe(
      prodEnvironment.defaultConfig.hyperliquidPublicUrl,
    );
  });

  it('pré-remplit les trois URL de service en développement', () => {
    // Le bénéfice recherché : un navigateur neuf n'a plus rien à semer dans le storage.
    for (const key of serviceUrls) {
      expect(devEnvironment.defaultConfig[key]).toMatch(/^http:\/\/localhost:\d+$/);
    }
  });

  it('distingue les deux builds par leur drapeau production', () => {
    // Si ce drapeau se désaligne, c'est que le mauvais fichier a été édité.
    expect(devEnvironment.production).toBe(false);
    expect(prodEnvironment.production).toBe(true);
  });
});
