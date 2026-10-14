import type {
  ProtectiveOrderEntry,
  ProtectiveOrderStrategy,
  RuleNode,
} from '@syldel/trading-shared-types';
import {
  DEFAULT_ATR_MULTIPLIER,
  IMPLICIT_ANCHOR,
  migratedAtrMultiplier,
  type StoredProtectiveEntry,
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
      distanceValue: 3,
    });

    expect(saved.anchor).toEqual({
      source: 'EXPRESSION',
      expression: { type: 'indicator', name: 'ema', period: 20 },
    });
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
      distance: { unit: 'ATR', value: 2 },
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
      distance: { unit: 'ATR', value: 1.5 },
      sizePercent: 60,
      label: '',
    };

    expect(toProtectiveEntry(toProtectiveEntryForm(stored))).toEqual({
      tpsl: 'sl',
      distance: { unit: 'ATR', value: 1.5 },
      sizePercent: 60,
      anchor: IMPLICIT_ANCHOR,
      followMode: 'FIXED',
      boundedByEntry: false,
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
      distance: { unit: 'ATR', value: 1.5 },
      sizePercent: 60,
      trailingStep: 3,
    };

    expect(toProtectiveEntry(toProtectiveEntryForm(fromNewerBuild))).toEqual({
      ...fromNewerBuild,
      anchor: IMPLICIT_ANCHOR,
      followMode: 'FIXED',
      boundedByEntry: false,
    });
  });

  it('carries a field a future contract will add', () => {
    // Deuxième angle sur le même invariant, et pas un cas d'école : `distance`
    // tenait ce rôle jusqu'à ce qu'il arrive vraiment, en v0.24. Entre le tag
    // des types et le déploiement de l'app, un mobile resté en arrière ne doit
    // pas rogner ce qu'une version à jour a écrit — un objet, pas seulement un
    // scalaire.
    const fromNewerBuild: Partial<ProtectiveOrderEntry> & {
      trigger: { kind: string; delaySeconds: number };
    } = {
      tpsl: 'sl',
      distance: { unit: 'ATR', value: 1.5 },
      sizePercent: 60,
      trigger: { kind: 'DELAYED', delaySeconds: 30 },
    };

    expect(toProtectiveEntry(toProtectiveEntryForm(fromNewerBuild))).toEqual({
      ...fromNewerBuild,
      anchor: IMPLICIT_ANCHOR,
      followMode: 'FIXED',
      boundedByEntry: false,
    });
  });

  it('turns what a number input really returns into a number', () => {
    // `ion-input type="number"` rend une chaîne dès la première frappe. Écrite
    // telle quelle, elle contredit le type stocké — le défaut qui avait donné
    // `2 / "201"` dans l'éditeur d'opérande.
    const saved = toProtectiveEntry({
      ...toProtectiveEntryForm(HAND_TUNED),
      distanceValue: '2.5',
      sizePercent: '40',
    });

    expect(saved.distance.value).toBe(2.5);
    expect(saved.sizePercent).toBe(40);
  });

  it('gives a brand new entry the documented defaults', () => {
    expect(toProtectiveEntryForm()).toEqual({
      tpsl: 'tp',
      // L'unite qui existait seule avant v0.24 : le defaut ne change pas le
      // comportement de ce que l'app produisait deja.
      distanceUnit: 'ATR',
      distanceValue: 1.5,
      sizePercent: 100,
      anchor: IMPLICIT_ANCHOR,
      followMode: 'FIXED',
      boundedByEntry: false,
      carried: {},
    });
  });
});

/**
 * La règle que ce bloc garde : **une entrée existante ne reçoit jamais une
 * valeur par défaut.** Les défauts sont pour une entrée neuve ; appliqués à une
 * entrée réglée, ils écrasent un choix de l'utilisateur.
 *
 * Mesuré le 2026-10-14 dans le navigateur : les quatre protections du compte de
 * développement portent `atrMultiplier` 1.5 · 2 · 1.5 · 1 et aucun `distance`,
 * et le formulaire affichait **1.5 quatre fois**. Ouvrir la modale puis
 * enregistrer aurait donc remplacé le stop à 2×ATR et le gain à 1×ATR.
 */
describe('migration of the retired atrMultiplier', () => {
  it('reads the stored multiple instead of the default', () => {
    const legacy: StoredProtectiveEntry = { tpsl: 'sl', atrMultiplier: 2, sizePercent: 50 };

    expect(toProtectiveEntryForm(legacy).distanceValue).toBe(2);
    expect(toProtectiveEntryForm(legacy).distanceUnit).toBe('ATR');
  });

  it('keeps each of the four values the account really holds', () => {
    // Le cas tel qu'il dort en base, et non un échantillon : c'est la seule
    // forme qui aurait attrapé le défaut, puisque la première entrée vaut
    // justement 1.5 — la valeur par défaut qui masquait les trois autres.
    const stored: StoredProtectiveEntry[] = [
      { tpsl: 'sl', atrMultiplier: 1.5, sizePercent: 50 },
      { tpsl: 'sl', atrMultiplier: 2, sizePercent: 50 },
      { tpsl: 'tp', atrMultiplier: 1.5, sizePercent: 50 },
      { tpsl: 'tp', atrMultiplier: 1, sizePercent: 50 },
    ];

    expect(stored.map((e) => toProtectiveEntryForm(e).distanceValue)).toEqual([1.5, 2, 1.5, 1]);
  });

  it('writes the translated distance and drops the retired field', () => {
    const legacy: StoredProtectiveEntry = { tpsl: 'tp', atrMultiplier: 1, sizePercent: 50 };

    expect(toProtectiveEntry(toProtectiveEntryForm(legacy))).toEqual({
      tpsl: 'tp',
      distance: { unit: 'ATR', value: 1 },
      sizePercent: 50,
      anchor: IMPLICIT_ANCHOR,
      followMode: 'FIXED',
      boundedByEntry: false,
    });
  });

  it('lets the field in use win when an entry carries both', () => {
    // Une entrée qui porte les deux a déjà été réécrite par un build récent :
    // c'est `distance` qui fait foi, l'ancien n'étant plus qu'un vestige.
    const both: StoredProtectiveEntry = {
      tpsl: 'sl',
      distance: { unit: 'PERCENT', value: 10 },
      atrMultiplier: 2,
      sizePercent: 50,
    };

    expect(migratedAtrMultiplier(both)).toBeNull();
    expect(toProtectiveEntryForm(both).distanceValue).toBe(10);
    expect(toProtectiveEntryForm(both).distanceUnit).toBe('PERCENT');
  });

  it('refuses to translate what cannot be a multiple', () => {
    // Même partition qu'ailleurs : ce dont ce build est certain se tranche, le
    // reste ne s'invente pas. Rien à traduire n'est pas une traduction à zéro.
    expect(migratedAtrMultiplier(undefined)).toBeNull();
    expect(migratedAtrMultiplier({ tpsl: 'sl' })).toBeNull();
    expect(migratedAtrMultiplier({ atrMultiplier: NaN })).toBeNull();
    expect(migratedAtrMultiplier({ atrMultiplier: '2' as unknown as number })).toBeNull();
  });

  it('translates without touching the unit it is given', () => {
    // La traduction est celle que les types partagés dictent dans leur propre
    // message de refus : `atrMultiplier 1.5` vaut `{ unit: 'ATR', value: 1.5 }`.
    expect(migratedAtrMultiplier({ atrMultiplier: 1.5 })).toEqual({ unit: 'ATR', value: 1.5 });
  });

  it('still gives a brand new entry its default', () => {
    // Le défaut garde sa raison d'être : il n'écrase rien sur une entrée qui
    // n'existe pas encore.
    expect(toProtectiveEntryForm(undefined).distanceValue).toBe(DEFAULT_ATR_MULTIPLIER);
  });

  it('⚠️ still defaults an existing entry that carries neither field', () => {
    /**
     * Le résidu assumé du même défaut : sans `distance` **ni** `atrMultiplier`,
     * il n'y a rien à lire, et le formulaire retombe sur 1.5 sans que la modale
     * l'annonce — le bandeau ne compte que les entrées traduisibles. Aucune
     * entrée du compte n'est dans ce cas au 2026-10-14 ; la liste, elle, le dit
     * déjà (`no distance`). Épinglé pour que ce soit un choix et non un oubli.
     */
    expect(toProtectiveEntryForm({ tpsl: 'sl', sizePercent: 50 }).distanceValue).toBe(
      DEFAULT_ATR_MULTIPLIER,
    );
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
