#!/usr/bin/env bash
# Fresh installation on Debian/Ubuntu, systemd, x86_64 or aarch64.
set -Eeuo pipefail
INSTALL_DIR=/opt/lte-sms-gateway
APP_PORT=5823
APP_REF=v3.1.0
NODE_VERSION=v24.21.0
SERVICE=lte-sms-gateway
NODE_HOME=/opt/lte-sms-gateway-node
usage() {
  printf '%s\n' 'Usage: sudo bash install.sh [--dir /absolute/path] [--port 5823] [--ref v3.1.0] [--check]'
}
CHECK_ONLY=0
while (($#)); do
  case "$1" in
    --dir|--port|--ref)
      (($# >= 2)) || { usage; exit 2; }
      case "$1" in --dir) INSTALL_DIR=$2;; --port) APP_PORT=$2;; --ref) APP_REF=$2;; esac
      shift 2;;
    --check) CHECK_ONLY=1; shift;;
    --help|-h) usage; exit 0;;
    *) usage; exit 2;;
  esac
done
[[ "$INSTALL_DIR" =~ ^/[a-zA-Z0-9_./-]+$ && "$INSTALL_DIR" != / && "$INSTALL_DIR" != */../* && "$INSTALL_DIR" != */.. && "$INSTALL_DIR" != */./* ]] || { echo 'Invalid installation directory.' >&2; exit 2; }
[[ "$APP_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$APP_PORT >= 1 && 10#$APP_PORT <= 65535)) || { echo 'Invalid port.' >&2; exit 2; }
[[ "$APP_REF" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && "$APP_REF" != *..* ]] || { echo 'Invalid ref.' >&2; exit 2; }
case "$(uname -m)" in x86_64) NODE_ARCH=x64;; aarch64|arm64) NODE_ARCH=arm64;; *) echo 'Only x86_64 / aarch64 is supported.' >&2; exit 1;; esac
[[ "$(uname -s)" == Linux ]] || { echo 'Linux is required.' >&2; exit 1; }
command -v apt-get >/dev/null && command -v systemctl >/dev/null || { echo 'Debian/Ubuntu with systemd is required.' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo 'systemd must be running.' >&2; exit 1; }
[[ ! -e "$INSTALL_DIR" ]] || { echo 'Directory already exists. Use the application upgrade page; no files were changed.' >&2; exit 1; }
[[ ! -L "$NODE_HOME" ]] || { echo 'Node runtime directory must not be a symlink.' >&2; exit 1; }
if ((CHECK_ONLY)); then printf 'Preflight passed: %s, port %s, ref %s, %s\n' "$INSTALL_DIR" "$APP_PORT" "$APP_REF" "$NODE_ARCH"; exit 0; fi
((EUID == 0)) || { echo 'Run with sudo.' >&2; exit 1; }
# A fresh installation must not overwrite an existing service/runtime.
if systemctl cat "$SERVICE.service" >/dev/null 2>&1 || [[ -e "$NODE_HOME" ]]; then
  echo 'Service or dedicated Node runtime already exists; no files were changed.' >&2; exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git xz-utils build-essential python3
STAGE=$(mktemp -d /tmp/lte-gateway-install.XXXXXXXX)
trap 'rm -rf -- "$STAGE"' EXIT
NODE_ARCHIVE="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}"
curl --fail --location --retry 3 "$NODE_URL/$NODE_ARCHIVE" -o "$STAGE/$NODE_ARCHIVE"
curl --fail --location --retry 3 "$NODE_URL/SHASUMS256.txt" -o "$STAGE/SHASUMS256.txt"
(cd "$STAGE"; awk -v file="$NODE_ARCHIVE" '$2 == file { print }' SHASUMS256.txt > selected.sha256; test -s selected.sha256; sha256sum --check selected.sha256)
git clone --depth 1 --branch "$APP_REF" https://github.com/JasonYANG170/LTE-SMS-Gateway.git "$STAGE/app"
# Extract into a dedicated runtime without replacing global Node.js.
mkdir -p -m 0755 "$NODE_HOME"
tar -xJf "$STAGE/$NODE_ARCHIVE" --strip-components=1 -C "$NODE_HOME"
getent group dialout >/dev/null || groupadd --system dialout
if ! id "$SERVICE" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE"
fi
usermod -aG dialout "$SERVICE"
mkdir -p "$(dirname "$INSTALL_DIR")"
mv "$STAGE/app" "$INSTALL_DIR"
chmod 0750 "$INSTALL_DIR"
chmod 0750 "$INSTALL_DIR/scripts/restart-systemd.sh"
printf '{"port":%d,"restartScript":"%s/scripts/restart-systemd.sh"}\n' "$((10#$APP_PORT))" "$INSTALL_DIR" > "$INSTALL_DIR/gateway-config.json"
chown -R "$SERVICE:$SERVICE" "$INSTALL_DIR"
chmod 0600 "$INSTALL_DIR/gateway-config.json"
runuser -u "$SERVICE" -- env PATH="$NODE_HOME/bin:/usr/bin:/bin" bash -c 'cd "$1"; npm install --omit=dev' _ "$INSTALL_DIR"
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=LTE SMS Gateway
After=network.target
[Service]
Type=simple
User=$SERVICE
Group=$SERVICE
SupplementaryGroups=dialout
WorkingDirectory=$INSTALL_DIR
Environment=PATH=$NODE_HOME/bin:/usr/bin:/bin
ExecStart=$NODE_HOME/bin/node server.js
Restart=always
RestartSec=3
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now "$SERVICE.service"
for attempt in $(seq 1 30); do
  if curl --silent --fail "http://127.0.0.1:$((10#$APP_PORT))/login.html" >/dev/null; then
    printf 'Installed. Open http://<host>:%d/login.html\n' "$((10#$APP_PORT))"
    printf '%s\n' 'Initial login: root / password. Change it in Settings after signing in.'
    exit 0
  fi
  sleep 1
done
echo 'Service did not become ready. Run: journalctl -u lte-sms-gateway -n 100' >&2
exit 1
