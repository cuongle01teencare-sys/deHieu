#!/usr/bin/env bash
# Sinh CA + server cert + client cert cho mTLS (dev).
# Production: dùng smallstep/step-ca hoặc cfssl.
#
# Usage:  bash gen-certs.sh <server_hostname>
# Ví dụ:  bash gen-certs.sh vps.example.com
#         bash gen-certs.sh localhost
#
# Portable: chạy được trên Linux/macOS/Git-Bash-Windows/WSL/MSYS/Cygwin.
# Git Bash trên Windows tự dịch bất kỳ arg nào bắt đầu bằng `/` thành
# đường dẫn Windows (VD "/CN=..." → "C:/Program Files/Git/CN=..."),
# làm openssl fail với "subject name is expected to be in the format...".
# Fix: set MSYS_NO_PATHCONV=1 + dùng "//CN=..." (2 slash → MSYS nhả ra 1).
# Trên Linux/macOS, "//CN=..." và MSYS_NO_PATHCONV vô hại.

set -euo pipefail
export MSYS_NO_PATHCONV=1     # tắt path translation của Git Bash / MSYS
export MSYS2_ARG_CONV_EXCL='*' # tắt tương tự cho MSYS2

HOST="${1:-localhost}"
OUT="$(dirname "$0")/../certs"
mkdir -p "$OUT"; cd "$OUT"

# Prefix "//" thay vì "/" cho -subj — Git Bash nhả ra 1 slash, OpenSSL bỏ
# qua slash thừa trên mọi OS khác. Đây là cách chuẩn của community.
SUBJ_CA="//CN=deHieu-CA"
SUBJ_SRV="//CN=$HOST"
SUBJ_CLI="//CN=deHieu-client"

echo "[+] Sinh CA..."
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
    -subj "$SUBJ_CA" -out ca.crt

echo "[+] Sinh server cert cho CN=$HOST..."
openssl genrsa -out server.key 2048
openssl req -new -key server.key -subj "$SUBJ_SRV" -out server.csr
cat > server.ext <<EOF
subjectAltName=DNS:$HOST,DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out server.crt -days 825 -sha256 -extfile server.ext

echo "[+] Sinh client cert..."
openssl genrsa -out client.key 2048
openssl req -new -key client.key -subj "$SUBJ_CLI" -out client.csr
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
