import { HttpErrorResponse } from '@angular/common/http';
import { readMarketHttpError, readMarketReply } from './market-fill.util';

/** L'enveloppe d'Hyperliquid pour un ordre, relayée telle quelle par le gateway. */
function ok(status: unknown) {
  return { status: 'ok', response: { type: 'order', data: { statuses: [status] } } };
}

describe('readMarketReply', () => {
  it('reads a full fill', () => {
    expect(
      readMarketReply(
        ok({ filled: { totalSz: '0.00011', avgPx: '101250.0', oid: 42 } }),
        '0.00011',
      ),
    ).toEqual({ kind: 'filled', totalSz: '0.00011', avgPx: '101250.0', oid: 42 });
  });

  it('reads a smaller fill as partial, and keeps the size asked for', () => {
    expect(
      readMarketReply(
        ok({ filled: { totalSz: '0.00005', avgPx: '101250.0', oid: 42 } }),
        '0.00011',
      ),
    ).toEqual({
      kind: 'partial',
      totalSz: '0.00005',
      avgPx: '101250.0',
      oid: 42,
      requestedSz: '0.00011',
    });
  });

  it('reads an IOC without counterparty as not filled: nothing executed', () => {
    const outcome = readMarketReply(
      ok({
        error: 'Order could not immediately match against any resting orders. asset=0',
      }),
      '0.00011',
    );
    expect(outcome.kind).toBe('not-filled');
  });

  it('reads any other per-order error as a refusal', () => {
    const outcome = readMarketReply(
      ok({ error: 'Order must have minimum value of $10.' }),
      '0.00005',
    );
    expect(outcome).toEqual({
      kind: 'refused',
      message:
        'Refused by Hyperliquid: Order must have minimum value of $10. Nothing was executed.',
    });
  });

  it('reads a refusal of the whole action as a refusal', () => {
    expect(
      readMarketReply({ status: 'err', response: 'User or API Wallet 0x1 does not exist.' }, '1')
        .kind,
    ).toBe('refused');
  });

  it('never reads an ok without statuses as a success: the order may have executed', () => {
    expect(readMarketReply({ status: 'ok', response: { type: 'default' } }, '1').kind).toBe(
      'unknown',
    );
    expect(readMarketReply(undefined, '1').kind).toBe('unknown');
  });

  it('never reads a resting IOC or an unknown status shape as a success', () => {
    expect(readMarketReply(ok({ resting: { oid: 7 } }), '1').kind).toBe('unknown');
    expect(readMarketReply(ok('waitingForFill'), '1').kind).toBe('unknown');
  });

  it('never reads a fill without a size as a success', () => {
    expect(readMarketReply(ok({ filled: { totalSz: '0.0', avgPx: '1', oid: 1 } }), '1').kind).toBe(
      'unknown',
    );
  });
});

describe('readMarketHttpError', () => {
  it('calls a network failure unknown: the request may have reached the exchange', () => {
    expect(readMarketHttpError(new HttpErrorResponse({ status: 0 })).kind).toBe('unknown');
  });

  it('calls a gateway 5xx unknown', () => {
    expect(readMarketHttpError(new HttpErrorResponse({ status: 502 })).kind).toBe('unknown');
  });

  it('calls a gateway 4xx a refusal: nothing was signed', () => {
    expect(readMarketHttpError(new HttpErrorResponse({ status: 401 })).kind).toBe('refused');
  });

  it('calls an error thrown before the call a refusal', () => {
    expect(readMarketHttpError(new Error('Cannot resolve the asset index')).kind).toBe('refused');
  });
});
