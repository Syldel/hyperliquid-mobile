#!/bin/bash

# -----------------------------
# Usage:
#   ./build-android.sh [debug|apk|aab] [development|production] [cleartext]
#
# Exemples:
#   ./build-android.sh aab production           → build prod classique
#   ./build-android.sh apk development cleartext → build dev avec cleartext
# -----------------------------

TYPE=${1:-aab}            # default 'aab'
CONFIGURATION=${2:-production} # default 'production'
CLEARTEXT=${3:-false}

# Charger les variables de signature (uniquement en production)
if [ "$CONFIGURATION" = "production" ]; then
  source scripts/android/signing-config-android.sh
  node ./scripts/android/signing-config-android.js
fi

CAP_CONFIG="capacitor.config.ts"

# -----------------------------
# Fonction pour restaurer le config original
# -----------------------------
restore_config() {
  if [ -f "${CAP_CONFIG}.bak" ]; then
    echo "♻️  Restoring original capacitor.config.ts"
    mv "${CAP_CONFIG}.bak" "$CAP_CONFIG"
  fi
}
# S'assure que restore_config est appelé en cas d'erreur ou CTRL+C
trap restore_config EXIT

# -----------------------------
# Backup du capacitor.config.ts
# -----------------------------
cp "$CAP_CONFIG" "${CAP_CONFIG}.bak"
echo "💾 Backup créé : ${CAP_CONFIG}.bak"

echo "📄 Bloc server :"
perl -0777 -ne 'print $1 if /(server:\s*\{[^}]*\})/s' "$CAP_CONFIG"
echo ""

# -----------------------------
# Patch cleartext (optionnel)
# -----------------------------
if [ "$CLEARTEXT" = "cleartext" ]; then
  echo "🔓 Applying cleartext patch..."

  # Si pas de bloc server → on le crée vide
  if ! grep -q "server:" "$CAP_CONFIG"; then
    perl -i -0pe "s|(\};)$|  server: {},\n\$1|m" "$CAP_CONFIG"
    echo "✅ Bloc server créé"
  fi

  # Gestion cleartext
  if grep -q "cleartext:" "$CAP_CONFIG"; then
    perl -i -pe "s|cleartext:.*|cleartext: true,|" "$CAP_CONFIG"
    echo "🔄 cleartext mis à jour"
  else
    perl -i -0pe "s|(server:\s*\{[^}]*)(})|\1    cleartext: true,\n  \2|s" "$CAP_CONFIG"
    echo "✅ cleartext ajouté"
  fi

  # Gestion allowNavigation
  if grep -q "allowNavigation:" "$CAP_CONFIG"; then
    perl -i -pe "s|allowNavigation:.*|allowNavigation: ['*'],|" "$CAP_CONFIG"
    echo "🔄 allowNavigation mis à jour"
  else
    # Insère avant la fermeture du bloc server
    perl -i -0pe "s|(server:\s*\{[^}]*)(})|  \1    allowNavigation: ['*'],\n  \2|s" "$CAP_CONFIG"
    echo "✅ allowNavigation ajouté"
  fi
else
  # Sépare server: { et cleartext si sur la même ligne
  perl -i -0pe "s|(server:\s*\{)\s*(cleartext:)|\1\n    \2|" "$CAP_CONFIG"

  # Retire cleartext si présent
  if grep -q "cleartext:" "$CAP_CONFIG"; then
    perl -i -pe "s/.*cleartext:.*\n//" "$CAP_CONFIG"
    echo "✅ cleartext retiré"
  fi

  # Retire allowNavigation si présent
  if grep -q "allowNavigation:" "$CAP_CONFIG"; then
    perl -i -pe "s/.*allowNavigation:.*\n//" "$CAP_CONFIG"
    echo "✅ allowNavigation retiré"
  fi
fi

# -----------------------------
# Nettoyage URL
# -----------------------------

# Supprime l'url si présente
if grep -q "url:" "$CAP_CONFIG"; then
  perl -i -pe "s/.*url:.*\n//" "$CAP_CONFIG"
  echo "✅ url supprimée du bloc server"
fi

# Supprime le bloc server seulement s'il est vide
if perl -0777 -ne 'exit 0 if /server:\s*\{[\s\n]*\}/; exit 1' "$CAP_CONFIG"; then
  perl -i -0pe "s/\s*server:\s*\{[\s\n]*\},\n?/\n/" "$CAP_CONFIG"
  echo "✅ Bloc server vide supprimé"
fi

echo "📄 Bloc server :"
perl -0777 -ne 'print $1 if /(server:\s*\{[^}]*\})/s' "$CAP_CONFIG"
echo ""

# -----------------------------
# Angular build
# -----------------------------
echo "🔧 Starting Android build ($TYPE) with configuration ($CONFIGURATION)..."

npx capacitor-assets generate --android

npx ng build --configuration $CONFIGURATION

npx cap copy android

# -----------------------------
# Gradle build
# -----------------------------
pushd android > /dev/null
if [ "$TYPE" = "apk" ]; then
    FILE_PATH="app/build/outputs/apk/release/"
    APK_PATH="${FILE_PATH}app-release.apk"

    if [ -f "$APK_PATH" ]; then
        echo "🧹 Removing previous APK: $APK_PATH"
        rm "$APK_PATH"
    fi

    ./gradlew assembleRelease
    echo "📦 APK generated"

elif [ "$TYPE" = "debug" ]; then
    FILE_PATH="app/build/outputs/apk/debug/"
    APK_PATH="${FILE_PATH}app-debug.apk"

    if [ -f "$APK_PATH" ]; then
        echo "🧹 Removing previous Debug APK: $APK_PATH"
        rm "$APK_PATH"
    fi

    ./gradlew assembleDebug
    echo "🐛 Debug APK generated"

elif [ "$TYPE" = "aab" ]; then
    FILE_PATH="app/build/outputs/bundle/release/"
    AAB_PATH="${FILE_PATH}app-release.aab"

    if [ -f "$AAB_PATH" ]; then
        echo "🧹 Removing previous AAB: $AAB_PATH"
        rm "$AAB_PATH"
    fi

    ./gradlew bundleRelease
    echo "📦 AAB generated"

else
    echo "❌ Unknown build type: $TYPE. Please use 'apk', 'debug', or 'aab'."
    popd > /dev/null
    exit 1
fi
popd > /dev/null

# -----------------------------
# Vérification URL dans le build
# -----------------------------
echo "🔍 Checking apiBaseUrl in build output…"
URLS=$(grep -R -o "https\?://[^\"']*hyperliquid\.xyz[^\"']*" dist/ | sort -u)
if [ -z "$URLS" ]; then
  echo "❌ hyperliquid.xyz not found in dist/"
  exit 1
fi
echo "$URLS"

echo "✅ Build finished successfully."
echo "👉 File available at: android/$FILE_PATH"