import {
  analysisCandlesReadAt,
  FRESH_READ_MAX_AGE_MS,
  formatCandlesAsOf,
  freshReadWasIgnored,
} from './candle-age.util';

describe('analysisCandlesReadAt', () => {
  const receivedAt = 1_800_000_000_000;

  // L'âge du bot, ramené sur l'horloge du téléphone : jamais une heure du bot comparée à la nôtre.
  it('places the read on the phone clock from the age the bot reports', () => {
    expect(analysisCandlesReadAt(receivedAt, 42_000)).toBe(receivedAt - 42_000);
  });

  it('accepts an age of zero', () => {
    expect(analysisCandlesReadAt(receivedAt, 0)).toBe(receivedAt);
  });

  // Un bot d'avant les types partagés 0.35.0 n'envoie rien : l'écran doit le dire, pas inventer.
  it.each([undefined, null, '42000', Number.NaN, Number.POSITIVE_INFINITY])(
    'knows nothing when the bot reports %p',
    (age) => {
      expect(analysisCandlesReadAt(receivedAt, age)).toBeNull();
    },
  );

  it('does not date candles in the future from a negative age', () => {
    expect(analysisCandlesReadAt(receivedAt, -1)).toBeNull();
  });
});

describe('freshReadWasIgnored', () => {
  const receivedAt = 1_800_000_000_000;

  it('accepts a fresh read that is a few seconds old', () => {
    expect(freshReadWasIgnored(true, receivedAt - 2_000, receivedAt)).toBe(false);
  });

  it('accepts one right at the limit', () => {
    expect(freshReadWasIgnored(true, receivedAt - FRESH_READ_MAX_AGE_MS, receivedAt)).toBe(false);
  });

  // 15 min : le cache du bot en 1H. C'est exactement ce que le rafraîchissement devait éviter.
  it('flags a fresh read that came out of a cache', () => {
    expect(freshReadWasIgnored(true, receivedAt - 15 * 60_000, receivedAt)).toBe(true);
  });

  // Une lecture ordinaire a le droit d'être ancienne : c'est le compromis accepté du cache.
  it('never flags an ordinary read, however old', () => {
    expect(freshReadWasIgnored(false, receivedAt - 6 * 3_600_000, receivedAt)).toBe(false);
  });
});

describe('formatCandlesAsOf', () => {
  // Heure locale : les dates se construisent en local, comme l'affichage.
  const at = (day: number, h: number, m: number, s: number) =>
    new Date(2026, 10, day, h, m, s).getTime();

  it('gives the time, to the second, for a read from today', () => {
    expect(formatCandlesAsOf(at(15, 21, 5, 9), at(15, 21, 30, 0))).toBe('as of 21:05:09');
  });

  // Le cache 1D vit 6 h : une lecture d'avant minuit lue après doit dire son jour.
  it('adds the date when the read is from another day', () => {
    expect(formatCandlesAsOf(at(14, 23, 10, 0), at(15, 1, 0, 0))).toBe('as of 14 Nov, 23:10:00');
  });
});
