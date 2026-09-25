#!/usr/bin/env bash
# Sinh CA + server cert + client cert cho mTLS (dev).
# Production: dùng smallstep/step-ca hoặc cfssl.
#
# Usage:  bash gen-certs.sh <server_hostname>
# Ví dụ:  bash gen-certs.sh vps.example.com
#         bash gen-certs.sh localhost

set -euo pipefail
HOST="${1:-localhost}"
OUT="$(dirname "$0")/../certs"
mkdir -p "$OUT"; cd "$OUT"

echo "[+] Sinh CA..."
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
    -subj "/CN=deHieu-CA" -out ca.crt

echo "[+] Sinh server cert cho CN=$HOST..."
openssl genrsa -out server.key 2048
openssl req -new -key server.key -subj "/CN=$HOST" -out server.csr
cat > server.ext <<EOF
subjectAltName=DNS:$HOST,DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out server.crt -days 825 -sha256 -extfile server.ext

echo "[+] Sinh client cert..."
openssl genrsa -out client.key 2048
openssl req -new -key client.key -subj "/CN=deHieu-client" -out client.csr
cat > client.ext <<EOF
extendedKeyUsage=clientAuth
EOF
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out client.crt -days 825 -sha256 -extfile client.ext

rm -f *.csr *.ext *.srl
echo
echo "[✓] Cert đã sinh trong: $OUT"
echo "    - server.crt / server.key   → mount vào nginx-mtls container"
echo "    - ca.crt                    → mount vào nginx (verify client)"
echo "    - client.crt / client.key   → copy về máy client, khai báo trong config.yaml"
echo "    - ca.crt                    → cũng cần ở máy client để verify server"
