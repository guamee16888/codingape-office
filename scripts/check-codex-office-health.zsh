#!/bin/zsh
set -euo pipefail

LOCAL_URL="${LOCAL_URL:-http://127.0.0.1:4142}"
PUBLIC_URL="${PUBLIC_URL:-https://geoaifactory.com}"

echo "Local:"
/usr/bin/curl -fsSI --max-time 10 "$LOCAL_URL" | /usr/bin/head -n 1

echo "Public:"
/usr/bin/curl -fsSI --max-time 10 "$PUBLIC_URL" | /usr/bin/head -n 1
