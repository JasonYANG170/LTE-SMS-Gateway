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
- 🚧Docker容器部署（待支持）

本项目无内置MCU，须搭配Linux上位机或NAS服务器使用
如遇问题，请向我提出issues
## 软件
**LTE&SMS聚合网关管理面板：**   
https://github.com/JasonYANG170/LTE&SMS-Gateway  
本项目管理后台基于NodeJS开发，适用于基于Linux系统的服务器使用  
服务器部署后进入本地5823端口打开管理后台


#### 软件部署
1. 调试部署较为简单，先使用`cd`指令进入项目目录  
2. 安装服务器环境  
```
sudo apt update
sudo apt install nodejs
npm install
```
3. 启动  
```
npm start
```
#### 默认配置

服务端口：`5823`  
账户：`root`  
密码：`password`  
如有外部访问需求，可使用Nginx添加反代

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

