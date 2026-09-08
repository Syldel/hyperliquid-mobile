import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import type {
  IExchangeStrategy,
  LogicalGroup,
  StrategyRules,
  StrategyValidationResult,
} from '@syldel/trading-shared-types';
import { of, throwError } from 'rxjs';
import {
  STRATEGY_DOCUMENT_SCHEMA_VERSION,
  type StrategyDocument,
} from '../../models/strategy-document.model';
import { StrategyLibraryService } from '../../services/strategy-library.service';
import { StrategyBuilderModalComponent } from './strategy-builder-modal.component';

/**
 * Le composant est testé pour son seul enchaînement à risque : enregistrer,
 * puis demander le verdict du bot. C'est le point où une stratégie part vers
 * l'extérieur, et où « enregistrer un brouillon » ne doit jamais dépendre d'une
 * validation — deux règles faciles à casser sans que rien ne le signale.
 */
const filledGroup: LogicalGroup = {
  type: 'logical',
  operator: 'AND',
  conditions: [
    {
      type: 'comparison',
      left: { type: 'price', field: 'close' },
      operator: 'GT',
      right: { type: 'number', value: 1 },
    },
  ],
};

function document(rules: StrategyRules): StrategyDocument {
  return {
    id: 'st_1',
    name: 'Breakout',
    rules,
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: STRATEGY_DOCUMENT_SCHEMA_VERSION,
  };
}

describe('StrategyBuilderModalComponent save flow', () => {
  let fixture: ComponentFixture<StrategyBuilderModalComponent>;
  let component: StrategyBuilderModalComponent;
  let modalCtrl: { dismissed: { data: unknown; role?: string }[] };
  let validated: IExchangeStrategy[];
  let saved: StrategyDocument[];
  let validationResult: StrategyValidationResult;
  let validationFails: boolean;

  function mount(rules: StrategyRules): void {
    fixture = TestBed.createComponent(StrategyBuilderModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('initialDocument', document(rules));
    fixture.detectChanges();
  }

  beforeEach(() => {
    validated = [];
    saved = [];
    validationResult = { valid: true, issues: [] };
    validationFails = false;

    TestBed.configureTestingModule({
      imports: [StrategyBuilderModalComponent],
      providers: [
        {
          provide: BotService,
          useValue: {
            ruleBuilderGrammar: signal(null),
            indicators: signal([]),
            getExchangeFormMetadata: () => of({}),
            validateStrategy: (strategy: IExchangeStrategy) => {
              validated.push(strategy);
              return validationFails
                ? throwError(() => new Error('offline'))
                : of(validationResult);
            },
          },
        },
        {
          provide: StrategyLibraryService,
          useValue: {
            save: async (doc: StrategyDocument) => {
              saved.push(doc);
              return doc;
            },
          },
        },
      ],
    });

    modalCtrl = TestBed.inject(ModalController) as unknown as typeof modalCtrl;
    modalCtrl.dismissed.length = 0;
  });

  // Décision « brouillon autorisé » : enregistrer ne dépend jamais du verdict.
  it('saves an incomplete draft and closes, without asking the bot', async () => {
    mount({ long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } });

    await component.save();

    expect(saved).toHaveLength(1);
    expect(validated).toEqual([]);
    expect(modalCtrl.dismissed.at(-1)?.role).toBe('confirm');
  });

  it('asks the bot once the strategy has something to evaluate, then closes', async () => {
    mount({ long: { entry: filledGroup } });

    await component.save();

    expect(saved).toHaveLength(1);
    expect(validated).toHaveLength(1);
    expect(modalCtrl.dismissed.at(-1)?.role).toBe('confirm');
  });

  // `shortname` est la clé sur laquelle le bot aiguille : toute autre valeur
  // lui ferait ignorer l'arbre de règles en silence.
  it('sends the strategy under the shortname the bot dispatches on', async () => {
    mount({ long: { entry: filledGroup } });

    await component.save();

    expect(validated[0].shortname).toBe('advanced-rules');
    expect(validated[0].name).toBe('Breakout');
    expect(validated[0].rules).toEqual({ long: { entry: filledGroup } });
  });

  it('keeps the modal open and surfaces the issues when the bot disagrees', async () => {
    validationResult = {
      valid: false,
      issues: [
        {
          code: 'MISSING_SUBFIELD',
          path: 'strategy.rules.long.entry.conditions[0].left',
          message: 'Indicator "adx" requires an explicit subField.',
        },
      ],
    };
    mount({ long: { entry: filledGroup } });

    await component.save();

    expect(saved).toHaveLength(1);
    expect(component.serverIssues()).toHaveLength(1);
    expect(modalCtrl.dismissed).toEqual([]);
  });

  it('still saves and closes when the bot cannot be reached', async () => {
    validationFails = true;
    mount({ long: { entry: filledGroup } });

    await component.save();

    expect(saved).toHaveLength(1);
    expect(modalCtrl.dismissed.at(-1)?.role).toBe('confirm');
  });

  it('does nothing without a name', async () => {
    mount({ long: { entry: filledGroup } });
    component.store.setName('   ');

    await component.save();

    expect(saved).toEqual([]);
    expect(modalCtrl.dismissed).toEqual([]);
  });
});
