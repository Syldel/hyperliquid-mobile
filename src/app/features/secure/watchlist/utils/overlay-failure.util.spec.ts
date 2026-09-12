import { overlayFailureReason } from './overlay-failure.util';

describe('overlayFailureReason', () => {
  // Le défaut d'origine : un refus annoncé comme une panne envoyait chercher un
  // problème de réseau là où il était dans la requête.
  it('quotes the issue the bot reported on a refusal', () => {
    const reason = overlayFailureReason({
      status: 400,
      error: {
        message: 'Ambiguous or invalid operand in expressions',
        issues: [{ message: 'Unknown indicator "nope". Known indicators: ema, sma.' }],
      },
    });

    expect(reason).toBe(
      'the bot refused the request: Unknown indicator "nope". Known indicators: ema, sma.',
    );
  });

  it('falls back to the response message when no issue is detailed', () => {
    const reason = overlayFailureReason({ status: 400, error: { message: 'Bad request' } });

    expect(reason).toBe('the bot refused the request: Bad request');
  });

  it('still says something useful when the refusal explains nothing', () => {
    expect(overlayFailureReason({ status: 422 })).toBe(
      'the bot refused the request: invalid request',
    );
  });

  // Un 5xx n'est pas un refus : il n'y a rien à corriger dans la requête, donc
  // la même phrase qu'une absence de réponse.
  it('treats a server fault as an absence of answer', () => {
    expect(overlayFailureReason({ status: 500 })).toBe('the analysis service did not respond.');
    expect(overlayFailureReason({ status: 503, error: { message: 'boom' } })).toBe(
      'the analysis service did not respond.',
    );
  });

  it('treats an unreachable service the same way', () => {
    expect(overlayFailureReason({ status: 0 })).toBe('the analysis service did not respond.');
    expect(overlayFailureReason(new Error('offline'))).toBe(
      'the analysis service did not respond.',
    );
    expect(overlayFailureReason(undefined)).toBe('the analysis service did not respond.');
    expect(overlayFailureReason(null)).toBe('the analysis service did not respond.');
  });
});
