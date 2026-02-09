import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requiredEnvVars = [
  'ANDROID_SIGNING_KEYSTORE',
  'ANDROID_SIGNING_STORE_PASSWORD',
  'ANDROID_SIGNING_KEY_ALIAS',
  'ANDROID_SIGNING_KEY_PASSWORD',
];

// Vérification des variables d'environnement
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

if (missingVars.length > 0) {
  console.warn(
    `⚠️  Attention : Les variables d'environnement suivantes ne sont pas définies :\n  - ${missingVars.join(
      '\n  - ',
    )}\n\n` +
      `Veuillez les ajouter dans votre fichier .env ou dans l'environnement système.\n` +
      `Exemple (.env) :\n` +
      `ANDROID_SIGNING_KEYSTORE=/chemin/vers/keystore.jks\n` +
      `ANDROID_SIGNING_STORE_PASSWORD=motdepasse\n` +
      `ANDROID_SIGNING_KEY_ALIAS=alias\n` +
      `ANDROID_SIGNING_KEY_PASSWORD=motdepasse\n`,
  );
  process.exit(1);
}

const keystoreConfig = {
  storeFile: process.env.ANDROID_SIGNING_KEYSTORE,
  storePassword: process.env.ANDROID_SIGNING_STORE_PASSWORD,
  keyAlias: process.env.ANDROID_SIGNING_KEY_ALIAS,
  keyPassword: process.env.ANDROID_SIGNING_KEY_PASSWORD,
};

const signingConfig = `
    signingConfigs {
        release {
            storeFile file("${keystoreConfig.storeFile}")
            storePassword "${keystoreConfig.storePassword}"
            keyAlias "${keystoreConfig.keyAlias}"
            keyPassword "${keystoreConfig.keyPassword}"
            v1SigningEnabled true
            v2SigningEnabled true
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            shrinkResources false
        }
    }`;

const appGradlePath = path.join(__dirname, '../../android/app/build.gradle');

// Lire le build.gradle existant
let gradleFile = fs.readFileSync(appGradlePath, 'utf-8');

// Vérifier si la section signingConfigs existe déjà
if (!gradleFile.includes('signingConfigs')) {
  gradleFile = gradleFile.replace(/(\bandroid\s*{)/, `$1${signingConfig}`);
  fs.writeFileSync(appGradlePath, gradleFile, 'utf-8');
  console.log('✅ build.gradle mis à jour avec signingConfigs.');
} else {
  console.log('ℹ️ signingConfigs déjà présent dans build.gradle.');
}
