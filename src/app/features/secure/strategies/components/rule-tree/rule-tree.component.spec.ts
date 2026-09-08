import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BotService } from '@services/bot.service';
import type { RuleNode, StrategyRules } from '@syldel/trading-shared-types';
import {
  STRATEGY_DOCUMENT_SCHEMA_VERSION,
  type StrategyDocument,
} from '../../models/strategy-document.model';
import { StrategyBuilderStore } from '../../services/strategy-builder.store';
import { RuleTreeComponent } from './rule-tree.component';

/**
 * Ce composant est testé alors que les composants ne le sont généralement pas
 * ici : il se rend **récursivement** en se référençant lui-même dans son propre
 * template. Si cette auto-référence cessait de se résoudre, rien n'échouerait
 * bruyamment — les sous-conditions disparaîtraient simplement de l'écran. C'est
 * exactement le genre de régression silencieuse qui justifie un test.
 */
function comparison(value: number): RuleNode {
  return {
    type: 'comparison',
    left: { type: 'price', field: 'close' },
    operator: 'GT',
    right: { type: 'number', value },
  };
}

function document(rules: StrategyRules): StrategyDocument {
  return {
    id: 'st_1',
    name: 'Test',
    rules,
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: STRATEGY_DOCUMENT_SCHEMA_VERSION,
  };
}

describe('RuleTreeComponent', () => {
  let fixture: ComponentFixture<RuleTreeComponent>;
  let store: StrategyBuilderStore;

  function mount(rules: StrategyRules, path = 'rules.long.entry', maxInlineDepth = 2): void {
    fixture = TestBed.createComponent(RuleTreeComponent);
    store = TestBed.inject(StrategyBuilderStore);
    store.open(document(rules));

    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('depth', 0);
    fixture.componentRef.setInput('maxInlineDepth', maxInlineDepth);
    fixture.detectChanges();
  }

  function text(): string {
    return fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RuleTreeComponent],
      providers: [
        StrategyBuilderStore,
        { provide: BotService, useValue: { ruleBuilderGrammar: signal(null) } },
      ],
    });
  });

  it('renders each condition of a group', () => {
    mount({
      long: {
        entry: {
          type: 'logical',
          operator: 'AND',
          conditions: [comparison(10), comparison(20)],
        },
      },
    });

    expect(text()).toContain('close > 10');
    expect(text()).toContain('close > 20');
  });

  // Le vrai objet du test : la descente récursive.
  it('renders a nested group and its children', () => {
    mount({
      long: {
        entry: {
          type: 'logical',
          operator: 'AND',
          conditions: [
            comparison(1),
            {
              type: 'logical',
              operator: 'OR',
              conditions: [comparison(2), comparison(3)],
            },
          ],
        },
      },
    });

    const rendered = text();
    expect(rendered).toContain('close > 1');
    expect(rendered).toContain('close > 2');
    expect(rendered).toContain('close > 3');
    expect(fixture.nativeElement.querySelectorAll('app-rule-tree').length).toBeGreaterThan(1);
  });

  it('renders the condition wrapped by a negation', () => {
    mount({
      long: {
        entry: {
          type: 'logical',
          operator: 'AND',
          conditions: [{ type: 'not', condition: comparison(7) }],
        },
      },
    });

    expect(text()).toContain('NOT');
    expect(text()).toContain('close > 7');
  });

  it('collapses a group deeper than maxInlineDepth into a summary', () => {
    mount(
      {
        long: {
          entry: {
            type: 'logical',
            operator: 'AND',
            conditions: [
              {
                type: 'logical',
                operator: 'OR',
                conditions: [comparison(4), comparison(5)],
              },
            ],
          },
        },
      },
      'rules.long.entry',
      1,
    );

    // Le sous-groupe est résumé, pas déplié : ses conditions ne sont pas rendues.
    expect(text()).toContain('2 conditions');
    expect(text()).not.toContain('close > 4');
  });

  it('shows an unknown node read-only, without hiding its siblings', () => {
    const alien = { type: 'quantum' } as unknown as RuleNode;
    mount({
      long: {
        entry: { type: 'logical', operator: 'AND', conditions: [alien, comparison(9)] },
      },
    });

    expect(text()).toContain('Unsupported');
    expect(text()).toContain('newer version');
    expect(text()).toContain('close > 9');
  });

  it('renders an empty group without crashing', () => {
    mount({ long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } });

    expect(text()).toContain('No condition yet');
  });
});
