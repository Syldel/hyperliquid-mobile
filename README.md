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

## Android Development Guide

### Development Server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

---

### First-Time Android Setup

Run this once to initialize the Android project:

```bash
npx cap add android
```

---

### Available Scripts

| Script                    | Description                        |
| ------------------------- | ---------------------------------- |
| `android:build`           | Build Angular + sync Capacitor     |
| `android:build:apk`       | Generate a release APK             |
| `android:build:apk:debug` | Generate a debug APK               |
| `android:sync`            | Sync Capacitor only                |
| `android:run`             | Launch app on a device or emulator |
| `android:live`            | Live reload on a physical device   |

---

### Standard Build & Run

#### 1. Build + sync

```bash
npm run android:build --configuration=production
```

This command runs the Angular build and `cap sync android` in sequence.

#### 2. Open in Android Studio

```bash
npx cap open android
```

#### 3. Run on a device or emulator

```bash
npx cap run android
```

---

### Android Live Reload – Development Workflow

This project supports **Android live reload** using the Angular dev server and Capacitor.
Multiple build configurations are available (`dev`, `prod`) via npm arguments.

The following command starts:

- Angular dev server (`ng serve`) exposed on the local network
- Capacitor sync
- Android app installation and launch on the connected device

```bash
npm run android:live --configuration=dev
npm run android:live --configuration=prod
```

> The device must be on the same Wi-Fi network as the development machine.

---

### Debugging

Open Chrome DevTools for remote debugging:

```
chrome://inspect/#devices
```

---

### App Assets (Icon & Splash Screen)

Source files:

- `resources/icon.png` (1024×1024)
- `resources/splash.png` (2732×2732)

To regenerate assets:

```bash
npx capacitor-assets generate
```

> This is also automatically run on `npm install` via the `postinstall` script.

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
