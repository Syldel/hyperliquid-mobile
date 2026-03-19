import { inject, Pipe, PipeTransform } from '@angular/core';
import { PreferencesService } from '@services/preferences.service';
import { formatSmartDecimal } from '../utils/format-smart-decimal';

@Pipe({ name: 'smartDecimal', standalone: true, pure: false })
export class SmartDecimalPipe implements PipeTransform {
  private readonly preferences = inject(PreferencesService);

  transform(value: string | number): string {
    return formatSmartDecimal(value, this.preferences.locale());
  }
}
