import type { CollateralBalance } from '@syldel/hl-shared-types';
import { describeCapitalGap, readAvailableCapital } from './available-capital.utils';

/**
 * Le contrat tient en une phrase : un capital se rend avec sa **cause**, jamais
 * sous la forme d'un nombre qui se lirait comme un solde.
 *
 * Ce que l'app affichait avant, mesuré le 2026-10-01 sur `0x728430a0…7083` :
 * `0,0108 $` de capital disponible pour une paire **perp**, parce qu'elle
 * supposait le compte unifié et lisait donc le **spot**. `userAbstraction`
 * rend `"default"` sur ce compte, et l'état perp vaut `0.0`. Le chiffre affiché
 * n'était pas périmé, il était faux.
 */

/** Ce que le gateway rend quand il a lu un solde. */
function ok(total: string, used = '0.0'): CollateralBalance {
  return {
    status: 'ok',
    mode: 'default',
    collateral: 'USDC',
    collateralToken: 0,
    total,
    used,
  };
}

describe('readAvailableCapital', () => {
  it('subtracts what is already committed from the total', () => {
    expect(readAvailableCapital(ok('250.5', '50.5'))).toEqual({
      status: 'ok',
      asset: 'USDC',
      amount: 200,
    });
  });

  it('reports which asset the amount was read from', () => {
    expect(readAvailableCapital(ok('0.01079182'))).toEqual({
      status: 'ok',
      asset: 'USDC',
      amount: 0.01079182,
    });
  });

  // Un engagement supérieur au total est un état que l'exchange peut rendre ;
  // ce n'est pas une anomalie de lecture, donc le statut reste `ok`.
  it('clamps a commitment larger than the total without reporting a failure', () => {
    expect(readAvailableCapital(ok('10', '25'))).toEqual({
      status: 'ok',
      asset: 'USDC',
      amount: 0,
    });
  });

  // Un zéro que l'exchange a **écrit** est un solde, pas une absence. C'est ce
  // qui empêche le test suivant d'être trivial.
  it('reports a zero the exchange actually returned as a real amount', () => {
    expect(readAvailableCapital(ok('0.0'))).toEqual({
      status: 'ok',
      asset: 'USDC',
      amount: 0,
    });
  });

  it('never turns a missing balance line into an amount', () => {
    const balance: CollateralBalance = {
      status: 'no-balance-entry',
      mode: 'default',
      collateral: 'USDT',
      collateralToken: 2,
    };

    expect(readAvailableCapital(balance)).toEqual({
      status: 'no-balance-entry',
      asset: 'USDT',
    });
  });

  // ⚠️ Ce mode n'a pas pu être **exercé** : le compte de développement est
  // unifié. Ce que ce test fige, c'est que l'app relaie le refus du gateway
  // sans le transformer en chiffre — pas que le refus soit le bon verdict sur
  // un vrai compte en portfolio margin.
  it('never turns a mode the gateway cannot read into an amount', () => {
    const balance: CollateralBalance = {
      status: 'unsupported-mode',
      mode: 'portfolioMargin',
      asset: 'BTC',
    };

    expect(readAvailableCapital(balance)).toEqual({
      status: 'unsupported-mode',
      mode: 'portfolioMargin',
    });
  });

  it('never turns an unresolved collateral into an amount', () => {
    const balance: CollateralBalance = {
      status: 'unknown-collateral',
      mode: 'default',
      asset: 'NOPE',
    };

    expect(readAvailableCapital(balance)).toEqual({ status: 'unknown-collateral' });
  });

  // `parseFloat('n/a')` rend `NaN`, que `| number` affiche **vide** dans un
  // gabarit : un trou silencieux à l'endroit exact où l'on chiffre une position.
  it('refuses amounts that are not numbers', () => {
    expect(readAvailableCapital(ok('n/a'))).toEqual({
      status: 'unreadable-amounts',
      asset: 'USDC',
    });
    expect(readAvailableCapital(ok('100', ''))).toEqual({
      status: 'unreadable-amounts',
      asset: 'USDC',
    });
  });
});

describe('describeCapitalGap', () => {
  // Un montant lu n'a rien à expliquer : c'est ce qui distingue « il y a un
  // chiffre » de « il n'y en a pas, et voici pourquoi ».
  it('has nothing to say when an amount was read', () => {
    expect(describeCapitalGap({ status: 'ok', asset: 'USDC', amount: 12 })).toBeNull();
  });

  it('has nothing to say before anything was asked', () => {
    expect(describeCapitalGap(null)).toBeNull();
  });

  // Chaque cause a sa phrase : les confondre rendrait le remède indevinable.
  it('names the asset the account holds no line for', () => {
    expect(describeCapitalGap({ status: 'no-balance-entry', asset: 'USDT' })).toContain('USDT');
  });

  it('says the catalogue is what failed, not the account', () => {
    expect(describeCapitalGap({ status: 'unknown-collateral' })).toContain('catalogue');
  });

  it('says the gateway is what failed, not the balance', () => {
    expect(describeCapitalGap({ status: 'unavailable' })).toContain('gateway');
  });

  // Le mode est nommé parce qu'il désigne le remède : en portfolio margin le
  // capital existe, il s'étale simplement sur plusieurs actifs.
  it('names the account mode it cannot read', () => {
    expect(describeCapitalGap({ status: 'unsupported-mode', mode: 'portfolioMargin' })).toContain(
      'portfolioMargin',
    );
  });

  it('distinguishes an unreadable balance from a missing one', () => {
    const unreadable = describeCapitalGap({
      status: 'unreadable-amounts',
      asset: 'USDC',
    });

    expect(unreadable).not.toEqual(
      describeCapitalGap({ status: 'no-balance-entry', asset: 'USDC' }),
    );
  });
});
