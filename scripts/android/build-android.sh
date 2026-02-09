#!/bin/bash

# -----------------------------
# Usage:
#   ./build-android.sh [debug|apk|aab] [development|production] [live]
# -----------------------------

# Charger les variables de signature
source scripts/android/signing-config-android.sh

node ./scripts/android/signing-config-android.js

TYPE=${1:-aab}  # default 'aab' if no argument
CONFIGURATION=${2:-production} # default 'production' if no argument
LIVE_RELOAD=${3:-false}

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

# -----------------------------
# Gestion live reload / standalone
# -----------------------------
if [ "$LIVE_RELOAD" = "true" ]; then
  echo "💻 Live reload mode: keeping server.url for dev"
else
  echo "🚀 Standalone mode: removing server.url"
  # Remplace server.url par undefined pour build final
  sed -i.bak "s|url: .*|url: undefined,|" "$CAP_CONFIG"
fi

# -----------------------------
# Angular build
# -----------------------------
echo "🔧 Starting Android build ($TYPE) with configuration ($CONFIGURATION)..."

# 1️⃣ Version bump + Ionic build
#npm run version:android

echo "🚀 NG build with configuration $CONFIGURATION"

npx capacitor-assets generate --android

ng build --configuration $CONFIGURATION

npx cap copy android

# 2️⃣ Gradle build
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

echo "🔍 Checking apiBaseUrl in build output…"
URLS=$(grep -R -o "https\?://[^\"']*hyperliquid\.xyz[^\"']*" dist/ | sort -u)
if [ -z "$URLS" ]; then
  echo "❌ hyperliquid.xyz not found in dist/"
  exit 1
fi
echo "$URLS"

# 3️⃣ Show final file path
echo "✅ Build finished successfully."
echo "👉 File available at: android/$FILE_PATH"
