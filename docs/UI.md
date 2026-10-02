# UI

当前版本为通信工作台 3.1，详见 [功能与验证说明](WORKSPACE.md)。

README 使用 `screenshots/` 下经过检查的演示截图，手机号为掩码、SIM 标识为 `DEMO`、短信为示例。其他本地测试截图不随源码发布。

安装开发依赖并准备 Chrome 后，可执行 `node scripts/capture-docs.mjs` 重新生成截图。生成器只连接本地模拟服务，不连接真实网关、不发送短信，截图前检查未遮罩的号码、卡片标识及 IP 地址。
