import { LISTABLE_EXCHANGE, marketSource, refusalMessage } from './market-source.util';

/**
 * Le contrat tient en une phrase : **le sélecteur ne propose des marchés que
 * pour l'exchange qu'il sait servir, et dit lequel quand il refuse.**
 *
 * Les cas d'un autre exchange sont écrits avec `binance`, comme les fixtures
 * de `exchange-catalogue.util.spec.ts` : le bot n'en déclare qu'un aujourd'hui,
 * et c'est précisément ce qui rendait le défaut invisible.
 */
describe('marketSource', () => {
  it('serves the one exchange this build knows how to list', () => {
    expect(marketSource(LISTABLE_EXCHANGE)).toEqual({
      state: 'listable',
      exchangeKey: 'hyperliquid',
    });
  });

  it('refuses another exchange instead of listing hyperliquid markets for it', () => {
    // Le cœur du défaut : ici, la modale affichait BTC, ETH, SOL… pour binance.
    expect(marketSource('binance')).toEqual({ state: 'unlistable', exchangeKey: 'binance' });
  });

  it('refuses when no exchange was provided, rather than assuming one', () => {
    // Un appelant qui oublie l'entrée doit se voir, pas hériter d'un défaut.
    expect(marketSource(undefined)).toEqual({ state: 'no-exchange' });
    expect(marketSource(null)).toEqual({ state: 'no-exchange' });
    expect(marketSource('')).toEqual({ state: 'no-exchange' });
    expect(marketSource('   ')).toEqual({ state: 'no-exchange' });
  });

  it('trims the key, exactly as exchangeCatalogue does', () => {
    expect(marketSource('  hyperliquid  ')).toEqual({
      state: 'listable',
      exchangeKey: 'hyperliquid',
    });
  });

  it('refuses a differently-cased key rather than guessing it is the same exchange', () => {
    // Choix assumé : `exchangeCatalogue` compare la clé d'exchange à
    // l'identique, et deux règles divergentes sur un même identifiant sont ce
    // qui avait déjà produit un trou muet. Un refus se lit et se corrige.
    expect(marketSource('Hyperliquid')).toEqual({
      state: 'unlistable',
      exchangeKey: 'Hyperliquid',
    });
  });
});

describe('refusalMessage', () => {
  it('says nothing when the list can be shown', () => {
    expect(refusalMessage({ state: 'listable', exchangeKey: 'hyperliquid' })).toBeNull();
  });

  it('names the exchange it cannot serve', () => {
    // « Aucun résultat » laisserait croire à une panne réseau ; la cause est
    // connue et définitive pour ce build, elle se nomme.
    const message = refusalMessage({ state: 'unlistable', exchangeKey: 'binance' });

    expect(message).toContain('binance');
    expect(message).toContain('hyperliquid');
  });

  it('tells a caller that forgot the input what is missing', () => {
    expect(refusalMessage({ state: 'no-exchange' })).toContain('exchange');
  });

  it('never offers a way out that does not exist', () => {
    // Une première rédaction conseillait de saisir la paire à la main. Le champ
    // `pairName` n'est pas saisissable : il n'est rempli que par ce sélecteur.
    // Un conseil impossible est un diagnostic faux affiché à l'utilisateur.
    const messages = [
      refusalMessage({ state: 'no-exchange' }),
      refusalMessage({ state: 'unlistable', exchangeKey: 'binance' }),
    ];

    for (const message of messages) {
      expect(message?.toLowerCase()).not.toContain('manually');
      expect(message?.toLowerCase()).not.toContain('type ');
    }
  });
});
