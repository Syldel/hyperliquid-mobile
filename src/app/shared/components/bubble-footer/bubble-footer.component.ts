import { Component } from '@angular/core';

@Component({
  selector: 'app-bubble-footer',
  standalone: true,
  templateUrl: './bubble-footer.component.html',
  styleUrls: ['./bubble-footer.component.scss'],
})
export class BubbleFooterComponent {
  bubbles = Array.from({ length: 10 }, () => ({
    size: `${5 + Math.random() * 4}rem`,
    distance: `90vh`, //`${50 + Math.random() * 4}rem`,
    position: `${-5 + Math.random() * 110}%`,
    time: `${10 + Math.random() * 2}s`,
    delay: `${-1 * (20 + Math.random() * 4)}s`,
  }));
}
