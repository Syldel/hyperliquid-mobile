const MAX_DECIMALS_PERP = 6;
const MAX_DECIMALS_SPOT = 8;

/**
 * Arrondit une taille selon szDecimals de l'asset.
 * sz est arrondi à szDecimals décimales.
 */
export function roundSize(sz: number, szDecimals: number): string {
  return sz.toFixed(szDecimals);
}

/**
 * Arrondit un prix selon les règles Hyperliquid :
 * - max 5 chiffres significatifs
 * - max (MAX_DECIMALS - szDecimals) décimales
 * - les prix entiers sont toujours valides
 */
export function roundPrice(px: number, szDecimals: number, isSpot = false): string {
  if (Number.isInteger(px)) return String(px);

  const maxDecimals = (isSpot ? MAX_DECIMALS_SPOT : MAX_DECIMALS_PERP) - szDecimals;

  // 5 chiffres significatifs
  const sigFigRounded = parseFloat(px.toPrecision(5));

  // Nombre de décimales du résultat
  const sigFigStr = sigFigRounded.toFixed(20).replace(/\.?0+$/, '');
  const decimalPart = sigFigStr.split('.')[1] ?? '';
  const decimals = Math.min(decimalPart.length, maxDecimals);

  return sigFigRounded.toFixed(decimals);
}
