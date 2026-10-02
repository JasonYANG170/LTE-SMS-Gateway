[简体中文](README.md) | [English](README_en.md)

<div align="center">
    <h1>LTE&amp;SMS-Gateway 4G多路聚合网关</h1>



![Static Badge](https://img.shields.io/badge/License-CC_BY_NC_SA_4.0-green?style=for-the-badge)![Commit Activity](https://img.shields.io/github/commit-activity/w/JasonYANG170/LTE-SMS-Gateway?style=for-the-badge&amp;color=yellow)![Languages Count](https://img.shields.io/github/languages/count/JasonYANG170/LTE-SMS-Gateway?logo=javascript&amp;style=for-the-badge)
[![Discord](https://img.shields.io/discord/978108215499816980?style=social&amp;logo=discord&amp;label=echosec)](https://discord.com/invite/az3ceRmgVe)


<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/28eea641-fe03-4b4b-b582-2b067d470d70" />

这是一项基于Cat.1模组的LTE&amp;SMS多路聚合网关

</div>


## 功能
- ✅支持SMS-on-HTTPS转发，可将SMS内容转发至微信或邮箱
- ✅支持SMS-on-SIM转发，可将SMS内容转发至常用SIM中
- ✅支持4G多路上网，使用侧面USB接入电脑，可自动识别RNDIS网卡
- ✅支持安全密钥，控制面板后台密钥加密处理
- ✅支持入侵提醒，当后台密钥输入错误时触发IP上报
- ✅支持SMS发送功能，可向目标SIM发送SMS
- ✅支持信号监测，可插入不同运营商SIM，监测基站信号强度
- ✅支持配置持久化，模块转发设置自动保存（敏感信息加密存储）
- ✅独立页面管理主机信息、SIM 概览 / 自动解析详情、收件箱、发件箱、收藏夹、转发和通讯日志
- ✅定时发件、周期保号、短信流式备份与恢复、主机 / SIM 存储清理及自动转存
- ✅中文 / English、浅色 / 深色 / 跟随系统主题、移动端布局与 Release 升级包
- 🚧Docker容器部署（待支持）

本项目无内置MCU，须搭配Linux上位机或NAS服务器使用
如遇问题，请向我提出issues
## 软件
**LTE&SMS聚合网关管理面板：**   
https://github.com/JasonYANG170/LTE-SMS-Gateway
本项目管理后台基于NodeJS开发，适用于基于Linux系统的服务器使用  
服务器部署后进入本地5823端口打开管理后台


### 手动部署（Linux）

需要 Linux 主机、USB 串口访问权限，以及 [Node.js 22 或 24 LTS](https://nodejs.org/en/download)、npm、Git。以下以安装目录 `/opt/lte-sms-gateway` 为例。普通用户调试也可使用自己的目录。

```bash
git clone https://github.com/JasonYANG170/LTE-SMS-Gateway.git
cd LTE-SMS-Gateway
git checkout v3.1.0
npm install --omit=dev
npm start
```

打开 `http://<主机IP>:5823/login.html`。首次登录为 `root / password`，登录后在“系统设置”中修改账号和密码。自定义端口可以使用 `PORT=8080 npm start`，或创建不提交到 Git 的 `gateway-config.json`：

```json
{"port":5823}
```

Linux 串口通常属于 `dialout` 组；为运行服务的用户添加该组，然后重新登录。可使用 `ls -l /dev/ttyACM* /dev/ttyUSB*` 检查模块和权限。部分 NAS 使用其他串口组，按系统实际配置调整。

```bash
sudo usermod -aG dialout "$USER"
```

长期运行建议使用 systemd。下面配置使用专用服务用户；请将项目复制到 `/opt/lte-sms-gateway`，并确保 `node` 在 `/usr/local/bin` 或 `/usr/bin` 中。其他位置需要修改 service 文件中的 `Environment` / `ExecStart`。

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

若要使用网页安装含后端的升级包，`gateway-config.json` 还需配置重启入口：

```json
{"port":5823,"restartScript":"/opt/lte-sms-gateway/scripts/restart-systemd.sh"}
```

此脚本配合 service 的 `Restart=always` 工作。使用宝塔、PM2 或其他进程管理器时，需要提供对应的重启脚本，不应直接使用此 systemd 配置。

### 一键脚本部署

适用于运行 systemd 的 Debian / Ubuntu，支持 x86_64 和 aarch64 / arm64。首次执行需要 `curl` 和 sudo / root 权限。脚本自动安装系统依赖，从 Node.js 官方下载 Node.js 24.21.0 并校验 SHA-256，部署指定版本，配置串口权限和 systemd 开机自启动。

```bash
curl -fL https://github.com/JasonYANG170/LTE-SMS-Gateway/releases/download/v3.1.0/install.sh -o install.sh
sudo bash install.sh
```

可选安装位置和端口：

```bash
sudo bash install.sh --dir /opt/lte-sms-gateway --port 8080 --ref v3.1.0
```

默认安装路径 `/opt/lte-sms-gateway`，专用 Node.js 路径 `/opt/lte-sms-gateway-node`，服务名 `lte-sms-gateway`。脚本不替换系统原有 Node.js；已有目标目录、专用运行时或同名服务时拒绝覆盖，旧部署请使用网页升级功能。`bash install.sh --check` 仅检查基础环境和参数，不安装或修改文件。

```bash
sudo systemctl status lte-sms-gateway
sudo journalctl -u lte-sms-gateway -n 100
sudo systemctl restart lte-sms-gateway
```

### Release 升级包与数据保留

在 [GitHub Releases](https://github.com/JasonYANG170/LTE-SMS-Gateway/releases) 下载：

- `LTE-SMS-Gateway-update.json`：工作台升级包，在侧边栏“应用升级”中本地导入，或通过在线检查更新安装。
- `LTE-SMS-Gateway-v3.1.0.tar.gz`：源码部署包，适用于手动安装；不是网页升级包。
- `install.sh`：一键部署脚本。
- `SHA256SUMS.txt`：上述附件的完整性校验值；在下载目录执行 `sha256sum -c SHA256SUMS.txt`。

升级包不包含账号、设备配置、短信、备份或日志。安装前校验文件路径、SHA-256 和 JavaScript 语法并保存快照。已有 v2.x 安装没有新升级接口，需要停服后备份并手动替换应用源码、安装依赖、启动服务；保留以下数据，不要用新安装目录覆盖它们：

```text
credentials.json          notification.json        module-settings.json
gateway-config.json       keep-alive.json          auto-clear-sim.json
disk-sms/                 workspace-data/          ui-backups/
```

运行目录应由服务用户拥有，敏感文件限制读取权限。备份下载包含短信明文。历史版本使用兼容的固定加密方案，文件加密不能替代主机文件权限；不要提交运行数据或将运行目录暴露为静态文件服务。

源码打包和隔离测试：

```bash
npm install
npm run test:workspace
npm run test:ui        # 需要本机 Chrome，可用 UI_BROWSER_PATH 指定可执行文件
npm run package:update
```

升级包生成于 `dist/LTE-SMS-Gateway-update.json`。测试使用模拟串口，不发送真实短信。

#### 后台界面图

| 登录界面 | 主页 |
| --- | --- |
|<img width="2217" height="1379" alt="image" src="https://github.com/user-attachments/assets/69941b26-9220-441a-a4b1-2f6c5db4ff80" />|<img width="2316" height="1397" alt="image" src="https://github.com/user-attachments/assets/1d658aa1-c71f-4181-b173-c14aaa24d46b" />|
| 转发设置 | 收件测试 |
|<img width="2305" height="1384" alt="image" src="https://github.com/user-attachments/assets/12e03d5d-987f-4c05-ad3a-a40a5913d806" />|<img width="1925" height="1214" alt="image" src="https://github.com/user-attachments/assets/1645c3fe-86cf-4bfc-8914-8c1a0a65c169" />|
## 硬件
**立创硬件开源平台**
https://oshwhub.com/jasonyang17/sms-receive
#### 项目参数

* 本设计采用AIR780E模组，以实现LTE功能支持；
* 本设计采用CH344Q转换芯片，以实现4路AT收发；
* 本设计采用CH334P芯片，以实现4路RNDIS网卡；
* 本项目采用JW5359电源芯片，以实现独立供电；

本项目建议电源供应12V5A DC电源

## 开源协议
本项目遵循CC BY-NC-SA 4.0开源协议，使用本程序时请注明出处  
本项目仅供研究与学习，严禁非授权的商业获利，严禁用于违法违规用途    
如果您有更好的建议，欢迎PR

## 硬件实物图

| 正面 | RNDIS测试 |
| --- | --- |
|<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/ce354ff9-cf8d-4729-8556-6dde2541d38d" />|<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/6b2a8717-c24c-42f0-9671-a836291a1d25" />|
| 外壳内部 | 成品 |
|<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/dbdcdb87-cc00-4201-a84f-4efd3f3aef0e" />|<img width="1700" height="1280" alt="image" src="https://github.com/user-attachments/assets/969658db-7386-47db-b881-036d9f3c5c5c" />|

## 喜欢这个项目，请为我点个Star ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=JasonYANG170/LTE-SMS-Gateway&amp;type=Date)](https://star-history.com/#star-history/star-history&amp;Date)

