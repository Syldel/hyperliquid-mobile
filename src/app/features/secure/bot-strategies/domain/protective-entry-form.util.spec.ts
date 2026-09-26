import type {
  ProtectiveOrderEntry,
  ProtectiveOrderStrategy,
  RuleNode,
} from '@syldel/trading-shared-types';
import {
  IMPLICIT_ANCHOR,
  toProtectiveEntry,
  toProtectiveEntryForm,
  toProtectiveStrategy,
} from './protective-entry-form.util';

/**
 * Le contrat tient en une phrase : la modale ne peut effacer que ce qu'elle
 * affiche.
 *
 * Chaque champ transporté ci-dessous a été vérifié dans le bot avant d'être
 * testé ici — `condition` est évaluée avant de poser la protection, `enabled`
 * est lu `!== false`. Ce ne sont pas des champs décoratifs.
 */

/** Ce qu'une entrée réglée à la main peut porter, et que le formulaire ignore. */
const ENTRY_CONDITION: RuleNode = {
  type: 'comparison',
  left: { type: 'price', field: 'close' },
  operator: 'GT',
  right: { type: 'number', value: 30000 },
};

const HAND_TUNED: ProtectiveOrderEntry = {
  tpsl: 'sl',
  anchor: { source: 'INDICATOR', name: 'ema', period: 20 },
  atrMultiplier: 1.2,
  sizePercent: 60,
  followMode: 'TIGHTEN_ONLY',
  boundedByEntry: true,
  condition: ENTRY_CONDITION,
};

describe('toProtectiveEntryForm / toProtectiveEntry', () => {
  it('returns an untouched entry after a round trip', () => {
    // L'invariant le plus fort : ouvrir puis sauver sans rien toucher ne doit
    // rien changer du tout. Un champ ajouté aux types partagés le vérifie ici
    // sans qu'on ait à écrire un test de plus.
    expect(toProtectiveEntry(toProtectiveEntryForm(HAND_TUNED))).toEqual(HAND_TUNED);
  });

  it('keeps the condition the bot evaluates before placing the protection', () => {
    const saved = toProtectiveEntry({
      ...toProtectiveEntryForm(HAND_TUNED),
      sizePercent: 40,
    });

    expect(saved.condition).toEqual(ENTRY_CONDITION);
    expect(saved.sizePercent).toBe(40);
  });

  it('keeps the anchor, the follow mode and the bound while size is edited', () => {
    const saved = toProtectiveEntry({
      ...toProtectiveEntryForm(HAND_TUNED),
      atrMultiplier: 3,
    });

    expect(saved.anchor).toEqual({ source: 'INDICATOR', name: 'ema', period: 20 });
    expect(saved.followMode).toBe('TIGHTEN_ONLY');
    expect(saved.boundedByEntry).toBe(true);
  });

  it('lets the edited fields win over the stored ones', () => {
    const saved = toProtectiveEntry({ ...toProtectiveEntryForm(HAND_TUNED), tpsl: 'tp' });

    expect(saved.tpsl).toBe('tp');
  });

  it('writes the anchor the bot was already applying when none was stored', () => {
    // `resolveAnchorPrice` fait `entry.anchor?.source || 'ENTRY'` : l'écrire
    // ne déplace aucun prix, ça rend seulement explicite ce qui se passait —
    // et ça honore un type où `anchor` est obligatoire.
    const legacy: Partial<ProtectiveOrderEntry> = {
      tpsl: 'tp',
      atrMultiplier: 2,
      sizePercent: 100,
    };

    expect(toProtectiveEntry(toProtectiveEntryForm(legacy)).anchor).toEqual(IMPLICIT_ANCHOR);
  });

  it('drops a field this build has deliberately retired', () => {
    // Mesuré le 2026-09-26 sur le compte de développement : les entrées
    // stockées portent un `label: ''` qu'aucun type ne déclare et qu'aucun des
    // cinq dépôts ne lit — `nest-mongo-user` compris, qui stocke
    // `tradingSettings` sans schéma par champ. Sa suppression est arbitrée, pas
    // subie : c'est ce qui la distingue de l'effacement que ce fichier répare.
    // Le type dit ce que c'est : une entrée incomplète, plus un champ que ce
    // build ne modélise pas. Un cast le tairait.
    const stored: Partial<ProtectiveOrderEntry> & { label: string } = {
      tpsl: 'sl',
      atrMultiplier: 1.5,
      sizePercent: 60,
      label: '',
    };

    expect(toProtectiveEntry(toProtectiveEntryForm(stored))).toEqual({
      tpsl: 'sl',
      atrMultiplier: 1.5,
      sizePercent: 60,
      anchor: IMPLICIT_ANCHOR,
    });
  });

  it('still passes through a field this build knows nothing about', () => {
    // L'invariant que le retrait ci-dessus ne doit pas emporter avec lui. Un
    // champ inconnu vient peut-être d'un build plus récent : le jeter
    // reviendrait à ce qu'un mobile en retard rogne la configuration écrite par
    // une app à jour. Retirer se décide champ par champ ; ne pas connaître
    // n'autorise rien.
    const fromNewerBuild: Partial<ProtectiveOrderEntry> & { trailingStep: number } = {
      tpsl: 'sl',
      atrMultiplier: 1.5,
      sizePercent: 60,
      trailingStep: 3,
    };

    expect(toProtectiveEntry(toProtectiveEntryForm(fromNewerBuild))).toEqual({
      ...fromNewerBuild,
      anchor: IMPLICIT_ANCHOR,
    });
  });

  it('carries a field a future contract will add, such as the coming distance', () => {
    // Deuxième angle sur le même invariant, et pas un cas d'école : `distance`
    // remplacera `atrMultiplier` à l'étape suivante. Entre le tag des types et
    // le déploiement de l'app, un mobile resté en arrière ne doit pas rogner ce
    // qu'une version à jour a écrit — un objet, pas seulement un scalaire.
    const fromNewerBuild: Partial<ProtectiveOrderEntry> & {
      distance: { unit: string; value: number };
    } = {
      tpsl: 'sl',
      atrMultiplier: 1.5,
      sizePercent: 60,
      distance: { unit: 'PERCENT', value: 2 },
    };

    expect(toProtectiveEntry(toProtectiveEntryForm(fromNewerBuild))).toEqual({
      ...fromNewerBuild,
      anchor: IMPLICIT_ANCHOR,
    });
  });

  it('turns what a number input really returns into a number', () => {
    // `ion-input type="number"` rend une chaîne dès la première frappe. Écrite
    // telle quelle, elle contredit le type stocké — le défaut qui avait donné
    // `2 / "201"` dans l'éditeur d'opérande.
    const saved = toProtectiveEntry({
      ...toProtectiveEntryForm(HAND_TUNED),
      atrMultiplier: '2.5',
      sizePercent: '40',
    });

    expect(saved.atrMultiplier).toBe(2.5);
    expect(saved.sizePercent).toBe(40);
  });

  it('gives a brand new entry the documented defaults', () => {
    expect(toProtectiveEntryForm()).toEqual({
      tpsl: 'tp',
      atrMultiplier: 1.5,
      sizePercent: 100,
      carried: { anchor: IMPLICIT_ANCHOR },
    });
  });
});

describe('toProtectiveStrategy', () => {
  it('keeps a disabled block disabled', () => {
    // Le bot lit `protective?.enabled !== false`. Perdre ce champ rallumait
    // des protections que l'utilisateur avait éteintes.
    const previous: ProtectiveOrderStrategy = { enabled: false, entries: [HAND_TUNED] };

    const saved = toProtectiveStrategy([toProtectiveEntryForm(HAND_TUNED)], previous);

    expect(saved.enabled).toBe(false);
  });

  it('replaces the entries rather than merging them', () => {
    const previous: ProtectiveOrderStrategy = { entries: [HAND_TUNED, HAND_TUNED] };

    const saved = toProtectiveStrategy([toProtectiveEntryForm(HAND_TUNED)], previous);

    expect(saved.entries).toHaveLength(1);
  });

  it('builds a block from nothing when the pair had none', () => {
    expect(toProtectiveStrategy([])).toEqual({ entries: [] });
  });
});
