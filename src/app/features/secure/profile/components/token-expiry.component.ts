import { DatePipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonBadge, IonItem, IonLabel, IonText } from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { interval } from 'rxjs';

@Component({
  selector: 'app-token-expiry',
  standalone: true,
  imports: [IonItem, IonLabel, IonText, IonBadge, DatePipe],
  templateUrl: './token-expiry.component.html',
})
export class TokenExpiryComponent {
  readonly exp = input.required<number>(); // timestamp en secondes

  private readonly lifecycle = inject(AppLifecycleService);
  private readonly tick = toSignal(interval(1000));

  readonly remainingMs = computed(() => {
    this.tick();
    this.lifecycle.foregroundCount();
    const ms = this.exp() * 1000 - Date.now();
    return ms > 0 ? ms : null;
  });

  readonly remainingLabel = computed(() => {
    const ms = this.remainingMs();
    if (ms === null) return null;

    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  });

  readonly color = computed(() => {
    const ms = this.remainingMs();
    if (ms === null) return 'danger';
    if (ms < 60_000) return 'danger';
    if (ms < 5 * 60_000) return 'warning';
    return 'success';
  });
}
