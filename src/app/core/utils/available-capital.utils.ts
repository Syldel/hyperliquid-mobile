import type { CollateralBalance } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * 💰 AVAILABLE CAPITAL
 * Ce que l'app sait du capital d'une paire — et ce qu'elle ignore.
 *
 * L'app ne résout plus le collatéral elle-même. Elle le demandait à une table
 * écrite en dur (`cash → USDT`, `hyna → USDE`, sinon USDC) qui désignait deux
 * dex éteints, et surtout elle posait en commentaire que « le compte est
 * TOUJOURS en mode Unified Account » — donc elle lisait les soldes **spot**
 * pour une paire **perp**.
 *
 * Mesuré le 2026-10-01 sur `0x728430a0…7083` : `userAbstraction` rend
 * `"default"`, l'état perp vaut `0.0` et le spot `0.01079182` USDC. L'app
 * affichait donc `0,0108 $` comme capital disponible pour un perp, alors que
 * cet argent est en spot et n'est pas du collatéral perp dans ce mode. Ce
 * n'était pas une table périmée, c'était un **chiffre faux**.
 *
 * Le gateway interroge le mode (`userAbstraction`) et route en conséquence ;
 * l'app lit sa réponse. Le mode se lit, il ne se suppose pas.
 *
 * ⚠️ `parseFloat` est assumé ici, et nulle part ailleurs : cette valeur n'est
 * qu'**affichée**. Elle n'est comparée à rien et n'est jamais envoyée comme
 * taille d'ordre — le dimensionnement vit dans le bot, en `DecimalString`. Si
 * un jour elle sert à autre chose qu'à écrire « ≈ $X », ce choix se rouvre.
 * ============================================================================
 */

export type AvailableCapital =
  /** Solde lu. `amount` est le capital **disponible** : total moins ce qui est engagé. */
  | { status: 'ok'; asset: string; amount: number }
  /** Collatéral identifié, mais le compte ne porte aucune ligne pour lui. */
  | { status: 'no-balance-entry'; asset: string }
  /** Le catalogue ne dit pas dans quoi ce marché se règle. */
  | { status: 'unknown-collateral' }
  /** Gateway injoignable, jeton refusé, réseau coupé — l'app n'a pas pu demander. */
  | { status: 'unavailable' }
  /** La réponse du gateway porte des montants qui ne sont pas des nombres. */
  | { status: 'unreadable-amounts'; asset: string };

/**
 * Traduit la réponse du gateway en ce que l'écran doit dire.
 *
 * Aucun cas ne retombe sur `0` : « tu n'as rien », « aucune ligne pour cet
 * actif » et « je ne sais pas dans quoi ça se règle » appellent trois phrases
 * différentes, et les confondre sous un chiffre est précisément ce que cette
 * passe corrige.
 */
export function readAvailableCapital(balance: CollateralBalance): AvailableCapital {
  if (balance.status === 'unknown-collateral') return { status: 'unknown-collateral' };
  if (balance.status === 'no-balance-entry') {
    return { status: 'no-balance-entry', asset: balance.collateral };
  }

  const total = Number.parseFloat(balance.total);
  const used = Number.parseFloat(balance.used);

  // `NaN` traverserait jusqu'au gabarit, où `| number` l'affiche **vide** : le
  // plus muet des échecs sur un écran qui chiffre une position.
  if (!Number.isFinite(total) || !Number.isFinite(used)) {
    return { status: 'unreadable-amounts', asset: balance.collateral };
  }

  // Disponible, et non total : `used` est la part déjà engagée — bloquée par des
  // ordres ouverts en spot, ou servant de marge en perp. Un disponible négatif
  // n'a pas de sens ; il se borne à zéro sans cesser d'être un solde lu.
  return { status: 'ok', asset: balance.collateral, amount: Math.max(total - used, 0) };
}

/**
 * La phrase à afficher quand il n'y a pas de montant, ou `null` quand il y en a
 * un.
 *
 * Écrite ici plutôt que dans chaque gabarit : les deux écrans qui affichent ce
 * capital divergeaient déjà — le formulaire d'ordre montrait `?`, la modale de
 * configuration **masquait la ligne**. Deux formulations pour un même état, ce
 * qui est précisément ce qu'on reproche au chiffre unique.
 *
 * Chaque cause a sa phrase, parce que chaque cause a son remède :
 * approvisionner, vérifier le marché, rallumer le gateway.
 */
export function describeCapitalGap(capital: AvailableCapital | null): string | null {
  if (!capital || capital.status === 'ok') return null;

  switch (capital.status) {
    case 'no-balance-entry':
      return `No ${capital.asset} balance on this account`;
    case 'unknown-collateral':
      return 'The exchange catalogue does not say what this market settles in';
    case 'unreadable-amounts':
      return `The ${capital.asset} balance came back unreadable`;
    default:
      return 'Capital unavailable — the gateway could not be reached';
  }
}
