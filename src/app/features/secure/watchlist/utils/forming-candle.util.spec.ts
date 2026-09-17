import type { TimelineSignal } from '@syldel/trading-shared-types';
import { formingCandleOpenTime, strategiesSignallingOnFormingCandle } from './forming-candle.util';

/**
 * La règle tenue ici : **un signal sur une bougie pas encore close se dit
 * provisoire, et seulement celui-là**. Trop de signalement noierait le cas qui
 * compte ; pas assez laisserait lire comme acquis un marqueur qui peut
 * disparaître au rafraîchissement suivant.
 */
const HOUR = 3_600_000;
const OPEN = 1_789_639_200_000; // une bougie 1h ouverte à 17:00

function signal(time: number, kind: TimelineSignal['signal'] = 'ENTER'): TimelineSignal {
  return { time, signal: kind, side: 'LONG', price: 1 };
}

describe('formingCandleOpenTime', () => {
  it('names the last candle while its interval is still running', () => {
    expect(formingCandleOpenTime(OPEN, HOUR, OPEN + 28 * 60_000)).toBe(OPEN);
  });

  // Une bougie couvre [t, t + intervalle[ : à t + intervalle pile, elle est close.
  it('considers the candle closed exactly when its interval has elapsed', () => {
    expect(formingCandleOpenTime(OPEN, HOUR, OPEN + HOUR - 1)).toBe(OPEN);
    expect(formingCandleOpenTime(OPEN, HOUR, OPEN + HOUR)).toBeNull();
  });

  it('is null once the last candle is well in the past', () => {
    expect(formingCandleOpenTime(OPEN, HOUR, OPEN + 5 * HOUR)).toBeNull();
  });

  it('is null without candles', () => {
    expect(formingCandleOpenTime(undefined, HOUR, OPEN)).toBeNull();
  });

  it('depends on the interval, not on a fixed hour', () => {
    const now = OPEN + 20 * 60_000;

    expect(formingCandleOpenTime(OPEN, 15 * 60_000, now)).toBeNull();
    expect(formingCandleOpenTime(OPEN, 4 * HOUR, now)).toBe(OPEN);
  });
});

describe('strategiesSignallingOnFormingCandle', () => {
  const layers = [
    { name: 'EMA cross', signals: [signal(OPEN - 3 * HOUR), signal(OPEN, 'EXIT')] },
    { name: 'Close trend', signals: [signal(OPEN - HOUR)] },
    { name: 'RSI dip', signals: [signal(OPEN)] },
  ];

  it('names every strategy with a signal on the forming candle, in layer order', () => {
    expect(strategiesSignallingOnFormingCandle(layers, OPEN)).toEqual(['EMA cross', 'RSI dip']);
  });

  // Un signal sur une bougie close est acquis : le marquer provisoire serait
  // faux, et apprendrait à ignorer l'avertissement.
  it('leaves out strategies whose signals all sit on closed candles', () => {
    expect(strategiesSignallingOnFormingCandle(layers, OPEN)).not.toContain('Close trend');
  });

  it('says nothing when no candle is forming', () => {
    expect(strategiesSignallingOnFormingCandle(layers, null)).toEqual([]);
  });

  it('says nothing without strategies', () => {
    expect(strategiesSignallingOnFormingCandle([], OPEN)).toEqual([]);
  });
});
