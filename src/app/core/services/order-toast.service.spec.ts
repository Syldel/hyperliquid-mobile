import { orderToastView } from './order-toast.service';

describe('orderToastView', () => {
  // Un ordre limite et son stop : deux toasts empilés, le second masquait le premier (2026-11-18).
  it('shows every line of one send in a single green toast', () => {
    expect(
      orderToastView([
        { text: 'Order placed · OID 608610134032', ok: true },
        { text: 'Stop Loss placed · OID 608610134033', ok: true },
      ]),
    ).toEqual({
      message: 'Order placed · OID 608610134032\nStop Loss placed · OID 608610134033',
      color: 'success',
    });
  });

  it('turns red as soon as one line failed, and marks that line', () => {
    expect(
      orderToastView([
        { text: 'Order placed · OID 1', ok: true },
        { text: 'Stop Loss failed: Order must have minimum value of $10.', ok: false },
      ]),
    ).toEqual({
      message: 'Order placed · OID 1\n✕ Stop Loss failed: Order must have minimum value of $10.',
      color: 'danger',
    });
  });

  it('does not mark a lone failure: the red already says it', () => {
    expect(orderToastView([{ text: 'Cancel failed: x', ok: false }]).message).toBe(
      'Cancel failed: x',
    );
  });
});
