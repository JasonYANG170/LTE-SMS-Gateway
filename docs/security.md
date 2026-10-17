# 安全部署与维护 / Security deployment

## 新安装 / Fresh installation

使用 Node.js 22/24 LTS。从当前源码执行 `npm ci --omit=dev`，再运行 `npm run setup`。初始化要求自选用户名及至少 12 字符、最多 72 个 UTF-8 字节的密码，终端密码输入不回显。不存在默认密码。无人值守初始化可使用 `GATEWAY_INITIAL_USERNAME`、`GATEWAY_INITIAL_PASSWORD` 环境变量，随后应清理这些变量。不要把密码写进命令行参数或 Git 文件。

Use `npm run setup` before exposing a fresh installation. No default password is created. The setup refuses to overwrite existing credentials or encryption keys.

建议专用系统用户、`dialout` 串口权限、systemd 和 `UMask=0077`。`deploy/lte-sms-gateway.service` 为示例。初始化必须以实际服务用户运行，以免产生无法读取的凭据文件。

## 旧部署迁移 / Legacy migration

1. 停止服务，先将代码、凭据、通知设置、模块设置、保号配置、短信、工作台状态及日志完整备份到只有管理员能读取的位置。
2. 安装新代码和依赖，但先不要启动。使用能读写这些文件的账户执行：`node scripts/migrate-security.cjs /实际部署目录 --backup-confirmed`。
3. 为服务用户设置文件所有权，私有目录使用 700、敏感文件使用 600，再启动并验证。

迁移工具仅针对旧版通用密钥/CBC 格式，逐项验证明文一致后才替换。旧公开密钥只存在于离线迁移工具中；正常服务不接受旧格式。若已有 v2 密文而部署密钥丢失，工具拒绝生成替代密钥，必须恢复备份。

Back up and stop the service before migrating. Always back up `.security/secrets.json` together with encrypted data. Losing the key makes new encrypted data unrecoverable. Never commit `.security/`, certificates, private keys, credentials, SMS, logs or backups.

## 登录与 TOTP

在系统设置绑定验证器，以验证码确认后才启用 TOTP。保存一次性恢复码，每条仅可使用一次。允许 30 秒时间步及前后一个时间步，已使用的验证码不能重放。主机及验证器时间应保持同步。启用、关闭 TOTP 或修改凭据会使其他会话失效。

按来源 IP 累计账号/密码或验证码错误，默认 3 次后等待 15 分钟；可设 1–10 次、1–60 分钟。成功登录清零；未锁定错误计数在 15 分钟没有新错误后过期。等待状态跨刷新和服务重启保留。登录失败 IP 审计仅管理员可见，加密保存最近 2000 条，不保存输入的密码或验证码。旧日志导入最多 1000 条，其来源 IP 按历史记录显示。

## HTTPS 与证书管理

系统设置 → 登录安全 → HTTPS 与证书管理。支持启用独立 HTTPS 监听、选择 1024–65535 端口、HTTP 跳转、导入 PEM 证书链与私钥、生成 365 天自签名证书、下载公开证书以及恢复上一份证书。默认 HTTPS 端口为 HTTP 端口加一。自签证书生成依赖主机 OpenSSL，不会调用第三方证书服务。

导入时检查私钥匹配、有效期、密钥强度和证书链签名顺序。TLS 最低版本 1.2；私钥加密保存，接口不返回私钥。更换同端口证书即时生效。私钥导入只允许 HTTPS 或来自回环地址的 SSH 隧道连接。

首次配置可通过 `ssh -N -L 15823:127.0.0.1:5823 USER@HOST`，再访问本机 `http://127.0.0.1:15823`；按部署端口调整。自签名证书不会自动被浏览器信任，需要访问设备手动配置信任；不要将加密等同于身份已验证。证书续期采用导入替换方式，当前没有自动 ACME 续期。管理页面不会代替系统管理员修改防火墙。

Reverse-proxy deployments must explicitly set `trustedProxies` in the private `gateway-config.json`; only loopback proxies are trusted by default. The proxy must set the original scheme/host correctly. Do not configure arbitrary untrusted clients as proxies.

## 官方 GitHub 更新

检查来源固定为 `JasonYANG170/LTE-SMS-Gateway` 正式 Release。升级包附件必须命名为 `LTE-SMS-Gateway-update.json`，并由 GitHub API 提供 `sha256:` 摘要。安装前重新获取发布信息，核对选定版本与完整附件摘要，再检查文件白名单、各文件摘要、版本和 JavaScript 语法。不允许网页安装本地未认证包或降级。

后端升级要求完整代码集合、可用的重启入口、空闲模块和与当前完全相同的运行依赖声明。依赖不同则拒绝网页安装，由管理员先更新依赖。安装前保存加密快照，写入失败时恢复原代码。快照不是独立于该主机的灾难恢复备份。

发布者运行 `npm run package:update`，审核生成内容后将 `dist/LTE-SMS-Gateway-update.json` 作为新版本正式 Release 附件上传。GitHub 自动计算附件摘要。只有推送源码不会产生可供在线安装的 Release；旧版无摘要或不兼容的附件会被拒绝。不要把业务数据或部署密钥加入发布包。该方案信任官方仓库/GitHub HTTPS 与账户权限，不声称具备离线签名或抵御发布者账户失陷。

运行测试：`npm test`；界面测试为 `npm run test:ui`，需要 Playwright 浏览器。HTTPS 测试需要 OpenSSL。测试凭据、保留地址和模拟 SIM 数据均为专用合成数据，与实际部署无关。
