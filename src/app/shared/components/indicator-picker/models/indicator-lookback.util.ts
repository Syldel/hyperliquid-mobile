import { ActiveIndicator } from '@shared/components/indicator-picker/models/indicator.model';

/** Nombre de bougies de marge nécessaires en amont de la fenêtre affichée,
 *  pour que les indicateurs à longue période (EMA 200, HMA 55...) aient des valeurs
 *  dès le début de cette fenêtre. Marge x1.5 pour la convergence de calcul. */
export function computeLookbackCandles(indicators: ActiveIndicator[]): number {
  if (!indicators.length) return 0;

  const maxPeriod = Math.max(
    0,
    ...indicators.flatMap((i) =>
      Object.entries(i.request)
        .filter(([key, value]) => key !== 'name' && typeof value === 'number')
        .map(([, value]) => value as number),
    ),
  );

  return maxPeriod > 0 ? Math.ceil(maxPeriod * 1.5) : 0;
}
