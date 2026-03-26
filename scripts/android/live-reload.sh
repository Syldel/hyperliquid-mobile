#!/bin/bash

PORT=8200
CAP_CONFIG="capacitor.config.ts"

# Kill le port si déjà utilisé
echo "🔫 Killing port $PORT if already in use..."
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
echo "✅ Port $PORT libéré"

# Récupère l'IP locale
LOCAL_IP=$(ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -1)
echo "📡 IP détectée : $LOCAL_IP"

# Sauvegarde le fichier original
cp "$CAP_CONFIG" "${CAP_CONFIG}.bak"

if grep -q "url:" "$CAP_CONFIG"; then
  # Cas 1 : url existe déjà → on écrase
  echo "🔄 URL existante détectée, remplacement..."
  perl -i -pe "s|url:.*|url: 'http://$LOCAL_IP:$PORT',|" "$CAP_CONFIG"

elif grep -q "server:" "$CAP_CONFIG"; then
  # Cas 2 : bloc server existe mais pas d'url → on ajoute url dedans
  echo "➕ Bloc server trouvé, ajout de l'URL..."
  perl -i -0pe "s|(server:\s*\{)|\1\n    url: 'http://$LOCAL_IP:$PORT',|" "$CAP_CONFIG"

else
  # Cas 3 : pas de bloc server du tout → on le crée avant le dernier `}`
  echo "🆕 Aucun bloc server, création..."
  perl -i -0pe "s|(\};)$|  server: {\n    url: 'http://$LOCAL_IP:$PORT',\n    cleartext: true,\n  },\n\$1|m" "$CAP_CONFIG"
fi

echo "✅ URL injectée : http://$LOCAL_IP:$PORT"

echo "🚀 Starting ng serve..."
npx ng serve --host 0.0.0.0 --port $PORT &
NG_PID=$!

echo "⏳ Waiting for ng serve to be ready on port $PORT..."
while ! nc -z localhost $PORT; do
  sleep 1
done

echo "✅ ng serve ready!"
echo "📱 Deploying to device..."
npx cap run android --live-reload --port $PORT

# Nettoyage
echo "🧹 Cleaning up..."
kill $NG_PID
mv "${CAP_CONFIG}.bak" "$CAP_CONFIG"
echo "✅ capacitor.config.ts restauré"