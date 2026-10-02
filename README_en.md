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
- 🚧Docker container deployment (to be supported)

This project does not have a built-in MCU and must be used with a Linux host computer or NAS server.
If you encounter any problems, please submit issues to me
## software
**LTE&SMS Aggregation Gateway Management Panel:**
https://github.com/JasonYANG170/LTE&SMS-Gateway  
The management backend of this project is developed based on NodeJS and is suitable for use on servers based on Linux systems.
After deployment, open port 5823 on the server to access the management panel.


#### Software deployment
1. Debugging and deployment is relatively simple. First use the `cd` command to enter the project directory.
2. Install the server environment
```
sudo apt update
sudo apt install nodejs
npm install
```
3. Start
```
npm start
```
#### Default configuration

Service port: `5823`
Account: `root`
Password: `password`
For external access, you can configure a reverse proxy with Nginx.

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

