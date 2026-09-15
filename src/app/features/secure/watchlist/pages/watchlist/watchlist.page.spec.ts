import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { signal } from '@angular/core';
import { WatchlistService } from '../../services/watchlist.service';
import { WatchlistPage } from './watchlist.page';

/**
 * La page est testée pour un seul point : ce qu'elle annonce quand l'écriture
 * n'a pas eu lieu.
 *
 * `persist` sortait jadis en silence faute de wallet, et « BTC added to
 * watchlist » s'affichait quand même — sur un ajout qui n'existait nulle part.
 * Maintenant qu'elle lève, ne rien attraper ferait pire : une promesse
 * rejetée, un geste sans effet, et toujours aucun message.
 */
describe('WatchlistPage when the watchlist refuses to write', () => {
  let page: WatchlistPage;
  let toastCtrl: { messages: string[] };
  let writeFails: boolean;

  beforeEach(() => {
    writeFails = false;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: WatchlistService,
          useValue: {
            items: signal([]),
            getByCoin: (coin: string) => ({ coin, interval: '1h', addedAt: 1 }),
            add: async () => {
              if (writeFails) throw new Error('no wallet');
            },
            remove: async () => {
              if (writeFails) throw new Error('no wallet');
            },
            update: async () => {
              if (writeFails) throw new Error('no wallet');
            },
            load: async () => [],
          },
        },
        { provide: AppLifecycleService, useValue: { foregroundCount: signal(0) } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
      ],
    });

    toastCtrl = TestBed.inject(ToastController) as unknown as typeof toastCtrl;
    toastCtrl.messages.length = 0;

    page = TestBed.runInInjectionContext(() => new WatchlistPage());
  });

  it('says so when a pair cannot be removed', async () => {
    writeFails = true;

    await page.onRemove('BTC');

    expect(toastCtrl.messages.at(-1)).toMatch(/nothing was written/i);
  });

  // Le cas qui a motivé le test : le succès s'annonçait avant d'être acquis.
  it('never announces a removal that did not happen', async () => {
    writeFails = true;

    await page.onRemove('BTC');

    expect(toastCtrl.messages.some((message) => /removed/i.test(message))).toBe(false);
  });

  it('says so when a change cannot be saved', async () => {
    writeFails = true;

    await page.onItemUpdated({ coin: 'BTC', interval: '4h' });

    expect(toastCtrl.messages.at(-1)).toMatch(/not saved/i);
  });

  // Le chemin normal ne doit pas se mettre à crier pour autant.
  it('still announces a removal that went through', async () => {
    await page.onRemove('BTC');

    expect(toastCtrl.messages.at(-1)).toMatch(/removed/i);
  });

  it('stays quiet when a change goes through', async () => {
    await page.onItemUpdated({ coin: 'BTC', interval: '4h' });

    expect(toastCtrl.messages).toEqual([]);
  });
});
