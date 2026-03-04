/**
 * Formate une adresse Ethereum pour afficher un format raccourci.
 * @param address L'adresse Ethereum à formater.
 * @param startChars Nombre de caractères à afficher au début (après le 0x).
 * @param endChars Nombre de caractères à afficher à la fin.
 * @returns L'adresse formatée.
 */
export function formatEthereumAddress(
  address: string,
  startChars: number = 4,
  endChars: number = 4,
): string {
  if (!address || address.length < 10) {
    return address;
  }

  const start = address.substring(0, 2 + startChars);
  const end = address.substring(address.length - endChars);
  return `${start}...${end}`;
}
