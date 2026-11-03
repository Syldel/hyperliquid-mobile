import { FormControl } from '@angular/forms';
import { isAcceptableServiceUrl, serviceUrlValidator } from './service-url.util';

describe('isAcceptableServiceUrl', () => {
  it.each([
    'https://api.hyperliquid.xyz',
    'https://users.example.com:8443/api',
    'http://localhost:3010',
    'http://app.localhost:4200',
    'http://127.0.0.1:3005',
    'http://[::1]:3001',
    'http://10.0.2.2:3010', // émulateur Android vers le PC
    'http://192.168.1.20:3010', // téléphone sur le Wi-Fi du PC
    'http://172.16.0.5:3010',
    'http://172.31.255.255',
  ])('should accept %s', (url) => {
    expect(isAcceptableServiceUrl(url)).toBe(true);
  });

  // Le mot de passe et le jeton y passeraient en clair.
  it.each([
    'http://users.example.com',
    'http://203.0.113.7:3010',
    'http://172.32.0.1', // hors de 172.16.0.0/12
    'http://192.169.1.1',
    'http://localhost.example.com', // un domaine public qui commence par localhost
    'ftp://localhost',
    'ws://localhost:3010',
    'not a url',
    '',
  ])('should refuse %j', (url) => {
    expect(isAcceptableServiceUrl(url)).toBe(false);
  });
});

describe('serviceUrlValidator', () => {
  it('should flag a plain-http public URL', () => {
    expect(serviceUrlValidator(new FormControl('http://users.example.com'))).toEqual({
      insecureUrl: true,
    });
  });

  // Le vide est l'affaire de Validators.required, qui le nomme déjà.
  it('should leave an empty value to Validators.required', () => {
    expect(serviceUrlValidator(new FormControl(''))).toBeNull();
  });
});
