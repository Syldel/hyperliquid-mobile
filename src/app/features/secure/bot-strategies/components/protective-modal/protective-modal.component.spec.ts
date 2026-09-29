import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/standalone';
import type { TradingPair } from '@models/user.interface';
import type { PriceAnchor, ProtectiveOrderEntry, RuleNode } from '@syldel/trading-shared-types';
import { ProtectiveModalComponent, type ProtectiveModalResult } from './protective-modal.component';

/**
 * ============================================================================
 * OUVRIR PUIS SAUVER NE DOIT RIEN DÉTRUIRE
 *
 * La conversion elle-même est éprouvée dans
 * `domain/protective-entry-form.util.spec.ts`. Ce qui est éprouvé **ici**, c'est
 * le câblage : que le formulaire transporte réellement ce qu'il n'affiche pas,
 * et que `save()` passe par la conversion au lieu de recopier ses trois champs.
 *
 * C'est la leçon des mutations : une fonction pure juste, branchée à moitié,
 * donne exactement le même défaut qu'avant.
 * ============================================================================
 */

const ENTRY_CONDITION: RuleNode = {
  type: 'comparison',
  left: { type: 'price', field: 'close' },
  operator: 'GT',
  right: { type: 'number', value: 30000 },
};

/** Une protection réglée à la main, comme seule l'édition directe permet. */
const HAND_TUNED: ProtectiveOrderEntry = {
  tpsl: 'sl',
  anchor: {
    source: 'EXPRESSION',
    expression: { type: 'indicator', name: 'ema', period: 20 },
  },
  distance: { unit: 'ATR', value: 1.2 },
  sizePercent: 60,
  followMode: 'TIGHTEN_ONLY',
  boundedByEntry: true,
  condition: ENTRY_CONDITION,
};

const pairWith = (entries: ProtectiveOrderEntry[], enabled?: boolean): TradingPair => ({
  name: 'BTC',
  ratio: 1,
  enabled: true,
  interval: '15',
  strategy: {
    name: 'Advanced Logical Rules',
    shortname: 'advanced-rules',
    protective: { ...(enabled === undefined ? {} : { enabled }), entries },
  },
});

describe('ProtectiveModalComponent — ce que sauver préserve', () => {
  let fixture: ComponentFixture<ProtectiveModalComponent>;
  let component: ProtectiveModalComponent;
  let modalCtrl: { dismissed: { data: unknown; role?: string }[] };

  function mount(pair: TradingPair): void {
    fixture = TestBed.createComponent(ProtectiveModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('pair', pair);
    fixture.detectChanges();
  }

  /** La paire telle qu'elle partirait vers le compte utilisateur. */
  function saved(): TradingPair {
    component.save();
    return (modalCtrl.dismissed.at(-1)?.data as ProtectiveModalResult).pair;
  }

  const savedEntries = () => saved().strategy?.protective?.entries ?? [];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProtectiveModalComponent] });

    modalCtrl = TestBed.inject(ModalController) as unknown as typeof modalCtrl;
    modalCtrl.dismissed.length = 0;
  });

  it('gives back an untouched entry when nothing is edited', () => {
    mount(pairWith([HAND_TUNED]));

    expect(savedEntries()[0]).toEqual(HAND_TUNED);
  });

  it('keeps the anchor while the multiplier is edited', () => {
    mount(pairWith([HAND_TUNED]));

    component.entryGroup(0).controls.distanceValue.setValue('3.5');

    expect(savedEntries()[0].anchor).toEqual({
      source: 'EXPRESSION',
      expression: { type: 'indicator', name: 'ema', period: 20 },
    });
    expect(savedEntries()[0].distance?.value).toBe(3.5);
  });

  it('keeps the condition the bot evaluates before placing the protection', () => {
    mount(pairWith([HAND_TUNED]));

    component.entryGroup(0).controls.sizePercent.setValue(45);

    expect(savedEntries()[0].condition).toEqual(ENTRY_CONDITION);
  });

  it('keeps the follow mode and the bound', () => {
    mount(pairWith([HAND_TUNED]));

    expect(savedEntries()[0].followMode).toBe('TIGHTEN_ONLY');
    expect(savedEntries()[0].boundedByEntry).toBe(true);
  });

  it('leaves a disabled protective block disabled', () => {
    // Le bot lit `protective?.enabled !== false` : le rallumer en passant
    // remettrait des ordres sur une position que l'utilisateur laissait nue.
    mount(pairWith([HAND_TUNED], false));

    expect(saved().strategy?.protective?.enabled).toBe(false);
  });

  it('leaves an explicitly enabled block explicitly enabled', () => {
    // `enabled: true` et `enabled` absent se comportent pareil pour le bot,
    // mais effacer le champ réécrit le document de l'utilisateur sans le dire.
    mount(pairWith([HAND_TUNED], true));

    expect(saved().strategy?.protective?.enabled).toBe(true);
  });

  it('does not invent an enabled flag the pair never had', () => {
    mount(pairWith([HAND_TUNED]));

    expect(saved().strategy?.protective?.enabled).toBeUndefined();
  });

  it('tells two entries apart instead of carrying one onto the other', () => {
    // Le transporté voyage dans la ligne : si l'indice glissait, la deuxième
    // protection hériterait de l'ancre de la première.
    const other: ProtectiveOrderEntry = {
      tpsl: 'tp',
      anchor: { source: 'MARKET' },
      distance: { unit: 'ATR', value: 4 },
      sizePercent: 100,
      followMode: 'FREE',
      boundedByEntry: false,
    };
    mount(pairWith([HAND_TUNED, other]));

    expect(savedEntries()[0]).toEqual(HAND_TUNED);
    expect(savedEntries()[1]).toEqual(other);
  });

  it('keeps the remaining entry intact when the first is removed', () => {
    const other: ProtectiveOrderEntry = {
      tpsl: 'tp',
      anchor: { source: 'MARKET' },
      distance: { unit: 'ATR', value: 4 },
      sizePercent: 100,
      followMode: 'FREE',
      boundedByEntry: false,
    };
    mount(pairWith([HAND_TUNED, other]));

    component.removeEntry(0);

    expect(savedEntries()).toEqual([other]);
  });

  it('writes the anchor the bot was already applying on a legacy entry', () => {
    // Une entrée écrite par un build précédent n'a pas d'ancre. Le bot lui
    // applique `ENTRY` ; l'écrire ne déplace rien et honore le type.
    const legacy = {
      tpsl: 'tp',
      distance: { unit: 'ATR', value: 2 },
      sizePercent: 100,
    } as ProtectiveOrderEntry;
    mount(pairWith([legacy]));

    expect(savedEntries()[0].anchor).toEqual({ source: 'ENTRY' });
  });

  it('drops the retired label field on the way out', () => {
    // Le vestige réellement trouvé sur le compte. Aucun cast : le type dit
    // qu'une entrée stockée peut porter davantage que ce que ce build modélise.
    const vestige: ProtectiveOrderEntry & { label: string } = {
      tpsl: 'sl',
      anchor: { source: 'ENTRY' },
      distance: { unit: 'ATR', value: 1.5 },
      sizePercent: 60,
      label: '',
    };
    mount(pairWith([vestige]));

    expect(savedEntries()[0]).not.toHaveProperty('label');
    expect(savedEntries()[0].sizePercent).toBe(60);
  });

  it('writes a number for what a number input hands back as a string', () => {
    mount(pairWith([HAND_TUNED]));

    component.entryGroup(0).controls.sizePercent.setValue('40');

    expect(savedEntries()[0].sizePercent).toBe(40);
  });

  it('refuses to save an emptied multiplier rather than writing a broken entry', () => {
    mount(pairWith([HAND_TUNED]));

    component.entryGroup(0).controls.distanceValue.setValue('');
    component.save();

    expect(modalCtrl.dismissed).toHaveLength(0);
  });

  it('refuses to save a size outside its bounds', () => {
    // Deuxième angle sur le même garde-fou : un champ rempli mais hors bornes
    // ne se détecte pas comme un champ vide.
    mount(pairWith([HAND_TUNED]));

    component.entryGroup(0).controls.sizePercent.setValue(250);
    component.save();

    expect(modalCtrl.dismissed).toHaveLength(0);
  });

  describe("le retour de la modale d'ancre", () => {
    /** Une modale qui rend ce qu'on lui dit de rendre, sans rien afficher. */
    function anchorModalReturning(data: PriceAnchor | null, role: string) {
      vi.spyOn(
        TestBed.inject(ModalController) as unknown as {
          create: () => Promise<unknown>;
        },
        'create',
      ).mockResolvedValue({
        present: async () => {},
        onDidDismiss: async () => ({ data, role }),
      });
    }

    it('applies the anchor the modal hands back', async () => {
      mount(pairWith([HAND_TUNED]));
      anchorModalReturning({ source: 'MARKET' }, 'confirm');

      await component.openAnchorEditor(0);

      expect(savedEntries()[0].anchor).toEqual({ source: 'MARKET' });
    });

    it('keeps the anchor untouched when the modal is dismissed', async () => {
      mount(pairWith([HAND_TUNED]));
      anchorModalReturning(null, 'cancel');

      await component.openAnchorEditor(0);

      expect(savedEntries()[0].anchor).toEqual(HAND_TUNED.anchor);
    });
  });

  describe('ce que la modale dit de la configuration saisie', () => {
    // Le verdict n'est pas recalcule ici : c'est `adviseProtection`, la meme
    // fonction dont le bot journalise la sortie. Ce qui est eprouve, c'est le
    // branchement — et surtout qu'il juge **chaque** entree, pas la premiere.
    it('grades a ratcheting stop as standard, in green', () => {
      mount(pairWith([HAND_TUNED]));

      expect(component.advice(0)!.level).toBe('standard');
      expect(component.adviceColor(0)).toBe('success');
    });

    it('grades a stop that can only loosen as runaway, in red', () => {
      mount(pairWith([HAND_TUNED]));

      component.entryGroup(0).controls.followMode.setValue('WIDEN_ONLY');
      component.entryGroup(0).controls.boundedByEntry.setValue(false);

      expect(component.advice(0)!.level).toBe('runaway');
      expect(component.adviceColor(0)).toBe('danger');
      expect(component.advice(0)!.message).toContain('loosen');
    });

    it('grades a free stop as caution, in amber', () => {
      mount(pairWith([HAND_TUNED]));

      component.entryGroup(0).controls.followMode.setValue('FREE');
      component.entryGroup(0).controls.boundedByEntry.setValue(false);

      expect(component.advice(0)!.level).toBe('caution');
      expect(component.adviceColor(0)).toBe('warning');
    });

    it('judges each entry on its own, never the first one twice', () => {
      const runaway: ProtectiveOrderEntry = {
        tpsl: 'sl',
        anchor: { source: 'ENTRY' },
        distance: { unit: 'ATR', value: 1 },
        sizePercent: 100,
        followMode: 'WIDEN_ONLY',
        boundedByEntry: false,
      };
      mount(pairWith([HAND_TUNED, runaway]));

      expect(component.adviceColor(0)).toBe('success');
      expect(component.adviceColor(1)).toBe('danger');
    });

    it('follows the anchor as well as the mode', () => {
      // `MARKET` + `WIDEN_ONLY` a sa propre phrase : c'est l'ancre qui fuit,
      // pas seulement le mode.
      mount(pairWith([HAND_TUNED]));

      component.entryGroup(0).controls.anchor.setValue({ source: 'MARKET' });
      component.entryGroup(0).controls.followMode.setValue('WIDEN_ONLY');
      component.entryGroup(0).controls.boundedByEntry.setValue(false);

      expect(component.advice(0)!.code).toBe('MARKET_ANCHOR_RUNS_AWAY');
    });
  });

  it('adds a new entry carrying the default anchor', () => {
    mount(pairWith([]));

    component.addEntry('sl');

    // Les trois defauts sont ecrits noir sur blanc : une configuration doit
    // continuer a produire le meme prix si les defauts du bot changent.
    expect(savedEntries()[0]).toEqual({
      tpsl: 'sl',
      anchor: { source: 'ENTRY' },
      distance: { unit: 'ATR', value: 1.5 },
      sizePercent: 100,
      followMode: 'FIXED',
      boundedByEntry: false,
    });
  });
});
