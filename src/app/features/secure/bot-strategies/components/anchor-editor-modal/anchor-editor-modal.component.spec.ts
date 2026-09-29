import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import type { AnchorSourceMeta, PriceAnchor } from '@syldel/trading-shared-types';
import { AnchorEditorModalComponent } from './anchor-editor-modal.component';

/**
 * ============================================================================
 * CE QU'UNE ANCRE A LE DROIT DE DEVENIR
 *
 * Trois règles, et chacune protège un prix d'ordre :
 *
 * - les sources viennent du **serveur**, filtrées par contexte. Une liste
 *   compilée dans l'app proposerait une origine que le bot ne sait pas
 *   résoudre, ou en cacherait une qu'il sait résoudre ;
 * - une source qui réclame une expression ne se confirme pas sans elle ;
 * - changer de source ne laisse pas traîner l'expression précédente : un champ
 *   que le bot ignore est un champ qui ment sur ce qui est configuré.
 * ============================================================================
 */

const SOURCES: AnchorSourceMeta[] = [
  {
    value: 'MARKET',
    label: 'Market Price (Orderbook)',
    allowedContexts: ['latent', 'protective'],
  },
  {
    value: 'ENTRY',
    label: 'Average Entry Price (PRU)',
    allowedContexts: ['protective'],
  },
  {
    value: 'EXPRESSION',
    label: 'Expression',
    allowedContexts: ['latent', 'protective'],
  },
];

describe('AnchorEditorModalComponent', () => {
  let fixture: ComponentFixture<AnchorEditorModalComponent>;
  let component: AnchorEditorModalComponent;
  let modalCtrl: { dismissed: { data: unknown; role?: string }[] };

  function mount(
    anchor: PriceAnchor | null,
    context: 'latent' | 'protective' = 'protective',
  ): void {
    fixture = TestBed.createComponent(AnchorEditorModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('initialAnchor', anchor);
    fixture.componentRef.setInput('context', context);
    fixture.detectChanges();
  }

  const confirmed = () => {
    component.confirm();
    return modalCtrl.dismissed.at(-1)?.data as PriceAnchor;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AnchorEditorModalComponent],
      providers: [{ provide: BotService, useValue: { anchorSources: signal(SOURCES) } }],
    });

    modalCtrl = TestBed.inject(ModalController) as unknown as typeof modalCtrl;
    modalCtrl.dismissed.length = 0;
  });

  it('offers only the sources the bot allows in this context', () => {
    // `ENTRY` n'a aucun sens pour un ordre latent : il n'y a pas encore de
    // position dont ce serait le prix d'entrée. C'est le bot qui le dit.
    mount({ source: 'MARKET' }, 'latent');

    expect(component.sources().map((s) => s.value)).toEqual(['MARKET', 'EXPRESSION']);
  });

  it('offers the entry price on a protective order', () => {
    mount({ source: 'ENTRY' }, 'protective');

    expect(component.sources().map((s) => s.value)).toContain('ENTRY');
  });

  it('offers nothing at all while the bot has not answered', () => {
    // Plutôt qu'une liste inventée : un sélecteur vide se voit, une liste
    // fausse ne se voit pas.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AnchorEditorModalComponent],
      providers: [{ provide: BotService, useValue: { anchorSources: signal([]) } }],
    });
    modalCtrl = TestBed.inject(ModalController) as unknown as typeof modalCtrl;

    mount({ source: 'ENTRY' });

    expect(component.sources()).toEqual([]);
  });

  it('reopens on the anchor it was given', () => {
    const expression = { type: 'indicator', name: 'ema', period: 20 } as const;
    mount({ source: 'EXPRESSION', expression });

    expect(component.source()).toBe('EXPRESSION');
    expect(component.expression()).toEqual(expression);
  });

  it('refuses to confirm an expression that was never written', () => {
    mount({ source: 'ENTRY' });

    component.source.set('EXPRESSION');

    expect(component.canConfirm()).toBe(false);
  });

  it('confirms a plain source without asking for anything else', () => {
    mount({ source: 'ENTRY' });

    component.source.set('MARKET');

    expect(component.canConfirm()).toBe(true);
    expect(confirmed()).toEqual({ source: 'MARKET' });
  });

  it('drops the expression when the source no longer carries one', () => {
    // Le champ resterait invisible à l'écran et le bot l'ignorerait : la
    // configuration stockée dirait alors autre chose que ce qui est appliqué.
    mount({
      source: 'EXPRESSION',
      expression: { type: 'indicator', name: 'ema', period: 20 },
    });

    component.source.set('ENTRY');

    expect(confirmed()).toEqual({ source: 'ENTRY' });
  });

  it('writes nothing when dismissed', () => {
    mount({ source: 'ENTRY' });

    component.dismiss();

    expect(modalCtrl.dismissed.at(-1)).toEqual({ data: null, role: 'cancel' });
  });
});
