# Hyperliquid Mobile

<p style="display: flex; justify-content: center; gap: 24px;">
  <a href="https://capacitorjs.com/" target="_blank"><img src="images/capacitor-icon.png" alt="Capacitor" height="120" /></a>
  <a href="https://ionicframework.com/" target="_blank"><img src="images/ionic-icon.png" alt="Ionic" height="120" /></a>
  <a href="https://angular.io/" target="_blank"><img src="images/angular-icon.png" alt="Angular" height="120" /></a>
</p>

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.0.4.

## Hyperliquid API documentation

<p style="display: flex; justify-content: center; gap: 24px;">
  <a href="https://app.hyperliquid.xyz/" target="_blank"><img src="https://i.postimg.cc/prPKc0cg/HL-symbol-mint-green.png" alt="Hyperliquid" height="120" /></a>
</p>

https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Android Live Reload – Development Workflow

This project supports **Android live reload** using Angular dev server and Capacitor.
Multiple build configurations can be used (`dev`, `prod`) via npm arguments.

### Available Commands

#### ▶️ Android Live Reload (External Dev Server)

The following command starts:

- Angular dev server (`ng serve`) exposed on the local network
- Capacitor sync
- Android app installation and launch on the connected device

```bash
npm run android:live --configuration=dev
npm run android:live --configuration=prod
```

### Chrome DevTools

Open:

```
chrome://inspect/#devices
```

### App assets (icon & splash)

Source files:

- resources/icon.png (1024x1024)
- resources/splash.png (2732x2732)

To regenerate assets:

```bash
npx capacitor-assets generate
```

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
