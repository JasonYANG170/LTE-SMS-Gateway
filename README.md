<div align="center">
    <h1>LTE&amp;SMS-Gateway 4G多路聚合网关</h1>



![Static Badge](https://img.shields.io/badge/License-CC_BY_NC_SA_4.0-green?style=for-the-badge)![Commit Activity](https://img.shields.io/github/commit-activity/w/JasonYANG170/LTE&amp;SMS-Gateway?style=for-the-badge&amp;color=yellow)![Languages Count](https://img.shields.io/github/languages/count/JasonYANG170/LTE&amp;SMS-Gateway?logo=c&amp;style=for-the-badge)
[![Discord](https://img.shields.io/discord/978108215499816980?style=social&amp;logo=discord&amp;label=echosec)](https://discord.com/invite/az3ceRmgVe)


![0ef1fe201f54697f66c67139923d5d60.jpg](https://image.lceda.cn/oshwhub/pullImage/53cce9ab3de744f28ccdb2b11234bf31.jpg)
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
|![image.png](https://image.lceda.cn/oshwhub/pullImage/87133ac95b8e41398f765b9f1a331639.png)|![image.png](https://image.lceda.cn/oshwhub/pullImage/e537a8b323284c21be24d5058ff1bcb3.png)|
| 转发设置 | 收件测试 |
|![image.png](https://image.lceda.cn/oshwhub/pullImage/279bd42fb4904d08a53b4ef2bb79a78f.png)|![image.png](https://image.lceda.cn/oshwhub/pullImage/668c1cf2c9694143a3adacfb7e6c0cbe.png)|
## 硬件
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
|![7f645753615a6345927f9b2dd5b5d8d8.jpg](https://image.lceda.cn/oshwhub/pullImage/3d491ea0a2ce439183a94aa67f02ae6f.jpg)|![0b15aaa6dd7369cf497c72ba46678eb4.jpg](https://image.lceda.cn/oshwhub/pullImage/86e36b73dbaa41cc8f1aa0d1dbac2ab5.jpg)|
| 外壳内部 | 成品 |
|![0ef1fe201f54697f66c67139923d5d60.jpg](https://image.lceda.cn/oshwhub/pullImage/556e15e476d24ac4a686f3f2df596faa.jpg)|![a5851492efcea274ff404c2faea9e9c4.jpg](https://image.lceda.cn/oshwhub/pullImage/861699cd3bed4281a44ce03cee17b3e2.jpg)|

## 喜欢这个项目，请为我点个Star ⭐

[![Star History Chart](https://api.star-history.com/svg?JasonYANG170/LTE&amp;SMS-Gateway&amp;type=Date)](https://star-history.com/#star-history/star-history&amp;Date)

