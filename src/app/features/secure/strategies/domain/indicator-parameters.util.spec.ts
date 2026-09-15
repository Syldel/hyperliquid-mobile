import type { IndicatorParameter } from '@syldel/trading-shared-types';
import { coerceIndicatorParameter, coerceIndicatorParameters } from './indicator-parameters.util';

/**
 * Ces tests décrivent le contrat que le formulaire d'opérande doit tenir :
 * ce qui est écrit dans un opérande `indicator` porte le type que le catalogue
 * déclare, et rien n'est effacé au passage.
 */
const period: IndicatorParameter = {
  type: 'number',
  name: 'period',
  label: 'Period',
  defaultValue: 9,
};

const pivotType: IndicatorParameter = {
  type: 'select',
  name: 'pivotType',
  label: 'Pivot',
  defaultValue: 'standard',
  options: [
    { label: 'Standard', value: 'standard' },
    { label: 'Fibonacci', value: 'fibonacci' },
  ],
};

/**
 * `SelectIndicatorParameter<T>` admet `string | number`, mais le membre retenu
 * dans l'union `IndicatorParameter` fixe `T = string` : un select numérique
 * n'est pas exprimable à la compilation ici. Il reste exprimable **sur le
 * fil** — `/exchanges/meta` est du JSON non vérifié — d'où ce cas, et d'où le
 * cast qui le rend écrivable.
 */
const numericSelect = {
  type: 'select',
  name: 'deviation',
  label: 'Deviation',
  defaultValue: 2,
  options: [
    { label: '1σ', value: 1 },
    { label: '2σ', value: 2 },
  ],
} as unknown as IndicatorParameter;

const smoothing: IndicatorParameter = {
  type: 'string',
  name: 'smoothing',
  label: 'Smoothing',
  defaultValue: 'wilder',
};

describe('coerceIndicatorParameter', () => {
  describe('a parameter the catalogue declares as a number', () => {
    // Le cas qui a motivé le fichier : c'est ce que rend un `ion-input`.
    it('converts the numeric string a text field hands back', () => {
      expect(coerceIndicatorParameter(period, '20')).toBe(20);
    });

    it('leaves an actual number alone', () => {
      expect(coerceIndicatorParameter(period, 20)).toBe(20);
    });

    it('accepts a decimal, which some parameters legitimately are', () => {
      expect(coerceIndicatorParameter(period, '2.5')).toBe(2.5);
    });

    it('tolerates the spaces a paste can bring along', () => {
      expect(coerceIndicatorParameter(period, ' 20 ')).toBe(20);
    });

    /**
     * `NaN` serait pire qu'un refus : `JSON.stringify({ period: NaN })` donne
     * `{"period":null}`, donc un paramètre *absent* du document — et le bot
     * appliquerait son propre défaut sans que rien ne le signale.
     */
    it('refuses a value it cannot read, rather than writing NaN', () => {
      expect(coerceIndicatorParameter(period, 'abc')).toBeNull();
      expect(coerceIndicatorParameter(period, 'Infinity')).toBeNull();
      expect(coerceIndicatorParameter(period, {})).toBeNull();
    });

    // Un champ vidé en cours de frappe ne doit pas effacer la valeur courante.
    it('refuses an empty field', () => {
      expect(coerceIndicatorParameter(period, '')).toBeNull();
      expect(coerceIndicatorParameter(period, null)).toBeNull();
      expect(coerceIndicatorParameter(period, undefined)).toBeNull();
    });
  });

  describe('a parameter the catalogue declares as a select', () => {
    it('keeps the declared value', () => {
      expect(coerceIndicatorParameter(pivotType, 'fibonacci')).toBe('fibonacci');
    });

    // Le type littéral vient de l'option, pas de l'événement : un select peut
    // rendre `'2'` là où le catalogue dit `2`, et le bot comparerait mal.
    it('restores the literal type the option declares', () => {
      expect(coerceIndicatorParameter(numericSelect, '2')).toBe(2);
    });

    /**
     * Une valeur hors liste vient probablement d'un bot plus récent : la
     * conserver laisse le serveur trancher, l'écraser déciderait à sa place.
     */
    it('passes through a value the declared options do not contain', () => {
      expect(coerceIndicatorParameter(pivotType, 'camarilla')).toBe('camarilla');
    });
  });

  it('keeps a string parameter as text', () => {
    expect(coerceIndicatorParameter(smoothing, 'wilder')).toBe('wilder');
  });

  // Même règle que partout ailleurs : ce que ce build ne connaît pas traverse.
  it('passes through a parameter the catalogue does not declare at all', () => {
    expect(coerceIndicatorParameter(undefined, 'wilder')).toBe('wilder');
    expect(coerceIndicatorParameter(undefined, 7)).toBe(7);
  });
});

describe('coerceIndicatorParameters', () => {
  // Rouvrir un opérande atteint suffit à le réparer.
  it('repairs every declared parameter stored with the wrong type', () => {
    expect(
      coerceIndicatorParameters({ period: '20', pivotType: 'fibonacci' }, [period, pivotType]),
    ).toEqual({ period: 20, pivotType: 'fibonacci' });
  });

  /**
   * On ne répare que le certain. Une valeur illisible est conservée : la
   * supprimer ferait disparaître le paramètre du document, et le bot
   * retomberait sur son défaut — exactement le silence qu'on cherche à éviter.
   */
  it('keeps a value it cannot convert instead of dropping the parameter', () => {
    expect(coerceIndicatorParameters({ period: 'abc' }, [period])).toEqual({ period: 'abc' });
  });

  it('keeps parameters the catalogue does not declare', () => {
    expect(coerceIndicatorParameters({ period: '20', extra: 'kept' }, [period])).toEqual({
      period: 20,
      extra: 'kept',
    });
  });

  // Catalogue pas encore arrivé : on ne tranche sur rien.
  it('changes nothing when no parameter is declared', () => {
    expect(coerceIndicatorParameters({ period: '20' }, undefined)).toEqual({ period: '20' });
  });

  it('returns an empty object for an indicator without parameters', () => {
    expect(coerceIndicatorParameters({}, [])).toEqual({});
  });
});
