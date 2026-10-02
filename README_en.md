[简体中文](README.md) | [English](README_en.md)

<div align="center">
    <h1>LTE&SMS-Gateway 4G multi-channel aggregation gateway </h1>



![Static Badge](https://img.shields.io/badge/License-CC_BY_NC_SA_4.0-green?style=for-the-badge)![Commit Activity](https://img.shields.io/github/commit-activity/w/JasonYANG170/LTE-SMS-Gateway?style=for-the-badge&amp;color=yellow)![Languages Count](https://img.shields.io/github/languages/count/JasonYANG170/LTE-SMS-Gateway?logo=javascript&amp;style=for-the-badge)
[![Discord](https://img.shields.io/discord/978108215499816980?style=social&amp;logo=discord&amp;label=echosec)](https://discord.com/invite/az3ceRmgVe)


<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/28eea641-fe03-4b4b-b582-2b067d470d70" />

An LTE and SMS multi-channel gateway based on Cat.1 modules.

</div>


## Features
- ✅Supports SMS-on-HTTPS forwarding, which can forward SMS content to WeChat or email
- ✅Supports SMS-on-SIM forwarding, which can forward SMS content to commonly used SIMs
- ✅Supports 4G multi-channel Internet access, uses the side USB to connect to the computer, and can automatically identify the RNDIS network card
- ✅Supports security keys and background key encryption processing in the control panel
- ✅Supports intrusion reminder and triggers IP reporting when the background key is entered incorrectly
- ✅Supports SMS sending function and can send SMS to the target SIM
- ✅Supports signal monitoring, can insert SIMs of different operators to monitor base station signal strength
- ✅Supports configuration persistence, module forwarding settings are automatically saved (sensitive information is encrypted and stored)
- ✅Dedicated pages for host information, automatic SIM details, inbox, outbox, favorites, forwarding and communication logs
- ✅Scheduled messages, SIM keep-alive, streaming backup/restore and host/SIM storage cleanup
- ✅Chinese / English, light / dark / system themes, mobile layouts and Release update packages
- 🚧Docker container deployment (to be supported)

This project does not have a built-in MCU and must be used with a Linux host computer or NAS server.
If you encounter any problems, please submit issues to me
## software
**LTE&SMS Aggregation Gateway Management Panel:**
https://github.com/JasonYANG170/LTE-SMS-Gateway
The management backend of this project is developed based on NodeJS and is suitable for use on servers based on Linux systems.
After deployment, open port 5823 on the server to access the management panel.


### Manual deployment (Linux)

Use a Linux host with USB serial access, [Node.js 22 or 24 LTS](https://nodejs.org/en/download), npm and Git.

```bash
git clone https://github.com/JasonYANG170/LTE-SMS-Gateway.git
cd LTE-SMS-Gateway
git checkout v3.1.0
npm install --omit=dev
npm start
```

Open `http://<host>:5823/login.html`. The initial credentials are `root / password`; change them in Settings after signing in. Override the port with `PORT=8080 npm start` or a local, untracked `gateway-config.json`:

```json
{"port":5823}
```

Add the service user to the serial-device group and sign in again. Debian/Ubuntu normally use `dialout`; check `ls -l /dev/ttyACM* /dev/ttyUSB*` and adjust for your NAS distribution.

```bash
sudo usermod -aG dialout "$USER"
```

For systemd, place the application at `/opt/lte-sms-gateway`. The supplied unit expects Node.js in `/usr/local/bin` or `/usr/bin`; adjust `Environment` / `ExecStart` if needed.

```bash
sudo cp -a "$PWD" /opt/lte-sms-gateway
sudo useradd --system --user-group --home-dir /opt/lte-sms-gateway --shell /usr/sbin/nologin lte-sms-gateway
sudo usermod -aG dialout lte-sms-gateway
sudo chown -R lte-sms-gateway:lte-sms-gateway /opt/lte-sms-gateway
sudo chmod 750 /opt/lte-sms-gateway/scripts/restart-systemd.sh
sudo cp /opt/lte-sms-gateway/deploy/lte-sms-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lte-sms-gateway
```

To install backend updates from the UI, configure the restart entry point:

```json
{"port":5823,"restartScript":"/opt/lte-sms-gateway/scripts/restart-systemd.sh"}
```

The helper relies on `Restart=always` in the systemd unit. BaoTa, PM2 and other process managers require their own restart helper.

### One-command installation

For Debian/Ubuntu running systemd, on x86_64 or aarch64/arm64. Requires curl and sudo/root. The installer installs system dependencies, downloads Node.js 24.21.0 from the official site, verifies SHA-256, deploys the selected release and configures serial access and startup.

```bash
curl -fL https://github.com/JasonYANG170/LTE-SMS-Gateway/releases/download/v3.1.0/install.sh -o install.sh
sudo bash install.sh
```

Optional location and port:

```bash
sudo bash install.sh --dir /opt/lte-sms-gateway --port 8080 --ref v3.1.0
```

Defaults: application `/opt/lte-sms-gateway`, dedicated Node.js `/opt/lte-sms-gateway-node`, service `lte-sms-gateway`. Existing application directories, dedicated runtimes and services are never overwritten; use the application's update page for existing installations. `bash install.sh --check` checks basic prerequisites and parameters without changing files.

```bash
sudo systemctl status lte-sms-gateway
sudo journalctl -u lte-sms-gateway -n 100
sudo systemctl restart lte-sms-gateway
```

### Release assets and upgrades

Download assets from [GitHub Releases](https://github.com/JasonYANG170/LTE-SMS-Gateway/releases):

- `LTE-SMS-Gateway-update.json`: import in Application update, or install after checking online updates.
- `LTE-SMS-Gateway-v3.1.0.tar.gz`: source distribution for manual installation; not a UI update package.
- `install.sh`: fresh-install script.
- `SHA256SUMS.txt`: asset checksums; run `sha256sum -c SHA256SUMS.txt` alongside downloaded assets.

Update packages exclude accounts, device configuration, messages, backups and logs. Paths, SHA-256 and JavaScript syntax are verified and a snapshot is saved before installation. A v2.x deployment does not have the new update API: stop it, back it up, replace application source, install dependencies and restart, preserving these runtime files:

```text
credentials.json          notification.json        module-settings.json
gateway-config.json       keep-alive.json          auto-clear-sim.json
disk-sms/                 workspace-data/          ui-backups/
```

The service user must own the application directory. Restrict sensitive file permissions. Downloaded SMS backups contain plaintext. Historical encryption uses a compatible fixed scheme; encryption is not a replacement for host file permissions. Never commit runtime data or expose it through a static file server.

Build and isolated tests:

```bash
npm install
npm run test:workspace
npm run test:ui        # Chrome required; set UI_BROWSER_PATH for a custom executable
npm run package:update
```

Output: `dist/LTE-SMS-Gateway-update.json`. Tests use simulated serial ports and do not send real messages.

#### Backend interface diagram

| Login interface | Home page |
| --- | --- |
|<img width="2217" height="1379" alt="image" src="https://github.com/user-attachments/assets/69941b26-9220-441a-a4b1-2f6c5db4ff80" />|<img width="2316" height="1397" alt="image" src="https://github.com/user-attachments/assets/1d658aa1-c71f-4181-b173-c14aaa24d46b" />|
| Forwarding settings | SMS reception test |
|<img width="2305" height="1384" alt="image" src="https://github.com/user-attachments/assets/12e03d5d-987f-4c05-ad3a-a40a5913d806" />|<img width="1925" height="1214" alt="image" src="https://github.com/user-attachments/assets/1645c3fe-86cf-4bfc-8914-8c1a0a65c169" />|
## hardware
**OSHWLab / JLC Open Source Hardware Platform**
https://oshwhub.com/jasonyang17/sms-receive
#### Project parameters

* This design uses AIR780E module to achieve LTE function support;
* This design uses CH344Q conversion chip to realize 4-way AT transceiver;
* This design uses CH334P chip to realize 4-way RNDIS network card;
* This project uses JW5359 power chip to achieve independent power supply;

The recommended power supply for this project is 12V5A DC power supply

## Open Source Agreement
This project follows the CC BY-NC-SA 4.0 open source license. Please indicate the source when using this program.
This project is for research and study only. Unauthorized commercial profits and illegal use are strictly prohibited.
If you have better suggestions, please PR

## Physical picture of hardware

| Front view | RNDIS test |
| --- | --- |
|<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/ce354ff9-cf8d-4729-8556-6dde2541d38d" />|<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/6b2a8717-c24c-42f0-9671-a836291a1d25" />|
| Inside the case | Finished product |
|<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/dbdcdb87-cc00-4201-a84f-4efd3f3aef0e" />|<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/969658db-7386-47db-b881-036d9f3c5c5c" />|

## If you like this project, please give me a star ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=JasonYANG170/LTE-SMS-Gateway&amp;type=Date)](https://star-history.com/#star-history/star-history&amp;Date)

