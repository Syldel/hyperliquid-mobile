export function formatSmartDecimal(value: string | number, locale = 'en-US'): string {
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
