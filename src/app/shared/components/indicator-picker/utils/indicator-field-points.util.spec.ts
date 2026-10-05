import { indicatorFieldPoints } from './indicator-field-points.util';
import type { IndicatorPoint } from '../services/indicator-overlay.service';

/**
 * ============================================================================
 * Ce qui était filtré est désormais un trou.
 *
 * `IndicatorOverlayService` écartait tout point dont la ligne n'était pas un
 * nombre, et son propre commentaire prévenait que ce serait un défaut le jour
 * où un indicateur rendrait `null` au milieu d'une série. Ce jour est arrivé :
 * `bbw` et `bbp` du bot rendent `null` sur une bande plate au lieu d'inventer
 * `0` et `0.5`.
 *
 * Ce que ces tests figent n'est donc pas « les trous sont gérés » mais
 * **l'alignement temporel** : un point écarté décalerait tout ce qui suit et
 * ferait enjamber le trou par une droite.
 * ============================================================================
 */
const at = (time: number, value: number | null | undefined): IndicatorPoint =>
  ({ time, value }) as IndicatorPoint;

describe('indicatorFieldPoints', () => {
  it('keeps a numeric value on its own timestamp', () => {
    expect(indicatorFieldPoints([at(1000, 42)], 'value')).toEqual([{ time: 1000, value: 42 }]);
  });

  // Le cœur : le point reste, sans valeur. Le trait s'interrompt au lieu de
  // relier ses deux bords.
  it('turns a null value into a point without a value', () => {
    expect(indicatorFieldPoints([at(1000, null)], 'value')).toEqual([{ time: 1000 }]);
  });

  it('does the same for an absent value', () => {
    expect(indicatorFieldPoints([at(1000, undefined)], 'value')).toEqual([{ time: 1000 }]);
  });

  /**
   * `NaN` est un nombre pour JavaScript : `typeof NaN === 'number'`. Sans le
   * `Number.isFinite`, il franchirait la frontière et lightweight-charts
   * recevrait un point à tracer sans valeur traçable.
   */
  it('refuses NaN and Infinity, which are numbers to JavaScript', () => {
    expect(indicatorFieldPoints([at(1000, NaN)], 'value')).toEqual([{ time: 1000 }]);
    expect(indicatorFieldPoints([at(2000, Infinity)], 'value')).toEqual([{ time: 2000 }]);
  });

  /**
   * L'invariant qui compte : autant de points en sortie qu'en entrée, aux mêmes
   * instants. Le filtre d'avant rendait trois points pour cinq, et le trait
   * passait tout droit par-dessus le trou.
   */
  it('never drops a point, so a hole stays where it happened', () => {
    const series = [at(1000, 1), at(2000, null), at(3000, null), at(4000, 4), at(5000, 5)];

    const result = indicatorFieldPoints(series, 'value');

    expect(result.map((p) => p.time)).toEqual([1000, 2000, 3000, 4000, 5000]);
    expect(result.map((p) => p.value)).toEqual([1, undefined, undefined, 4, 5]);
  });

  // Une ligne nommée d'un indicateur multi-lignes se lit pareil, et une ligne
  // que cet indicateur n'expose pas rend un trou plutôt qu'une autre ligne.
  it('reads the named line, and holes a line this indicator does not carry', () => {
    const point = { time: 1000, upper: 12, lower: 8 } as IndicatorPoint;

    expect(indicatorFieldPoints([point], 'upper')).toEqual([{ time: 1000, value: 12 }]);
    expect(indicatorFieldPoints([point], 'middle')).toEqual([{ time: 1000 }]);
  });
});
