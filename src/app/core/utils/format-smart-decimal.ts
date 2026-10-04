/**
 * `null` et `undefined` sont acceptés parce que l'exchange en envoie :
 * `liquidationPx` vaut `null` quand aucun prix de liquidation n'est atteignable
 * (relevé le 2026-09-22, 14 positions sur 22). La signature l'ignorait, et
 * seul `strictTemplates` du compilateur Angular l'a signalé — `tsc` ne vérifie
 * pas les gabarits.
 *
 * Le corps, lui, le traitait déjà : le tiret cadratin est le trou visible que
 * `CLAUDE.md` réclame, et non un `0` interpolé.
 */
export function formatSmartDecimal(
  value: string | number | null | undefined,
  locale = 'en-US',
): string {
  if (!value) return '—';

  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';

  const abs = Math.abs(num);

  let decimals: number;
  if (abs === 0) decimals = 2;
  else if (abs >= 1000) decimals = 2;
  else if (abs >= 100) decimals = 3;
  else if (abs >= 10) decimals = 4;
  else if (abs >= 1) decimals = 5;
  else decimals = 6;

  return num.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}
