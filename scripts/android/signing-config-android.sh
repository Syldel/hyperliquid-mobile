#!/bin/bash

# Charge les variables de signature Android depuis .env et les exporte

# Vérifie que .env existe
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    exit 1
fi

# Charger les variables en ignorant les commentaires
export $(grep -v '^#' .env | xargs)

# Vérifier que toutes les variables nécessaires sont définies
: "${ANDROID_SIGNING_KEYSTORE:?Need to set ANDROID_SIGNING_KEYSTORE in .env}"
: "${ANDROID_SIGNING_STORE_PASSWORD:?Need to set ANDROID_SIGNING_STORE_PASSWORD in .env}"
: "${ANDROID_SIGNING_KEY_ALIAS:?Need to set ANDROID_SIGNING_KEY_ALIAS in .env}"
: "${ANDROID_SIGNING_KEY_PASSWORD:?Need to set ANDROID_SIGNING_KEY_PASSWORD in .env}"

echo "✅ Android signing variables loaded."
