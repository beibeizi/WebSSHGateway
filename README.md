# WebSSH Gateway 社区版

> English version: [README.en.md](./README.en.md)

WebSSH Gateway 是一个面向运维和开发场景的浏览器 SSH 网关。你可以在 Web 页面内完成 SSH 连接管理、终端会话、系统监控和文件管理，减少多终端切换带来的成本。

其中一个核心特点是面向长时任务的“持久会话设计”。基于增强会话与 `tmux` 保活能力，即使浏览器关闭、网络抖动或前端页面刷新，后台任务仍可持续运行，适合执行需要保活的部署/巡检脚本、AI Code（自动化编码）长流程开发、定期数据监控与日志采集等场景。

## 项目预览

![WebSSH Gateway 项目总览](./docs/images/preview-overview.png)
![WebSSH Gateway 终端与文件管理](./docs/images/preview-terminal.png)

## 移动端适配

移动端提供专门的触摸友好布局与交互，支持在手机浏览器中完成终端操作、文件管理与系统监控。

![移动端概览](./docs/images/mobile-overview.jpg)
![移动端终端](./docs/images/mobile-terminal.jpg)
![移动端文件管理](./docs/images/mobile-fileManagement.jpg)
![移动端系统状态](./docs/images/mobile-systemStatus.jpg)

## 社区版声明

- 本仓库为 **WebSSH Gateway 社区版（Community Edition）**。
- 社区版将持续开源，聚焦核心 SSH 网关能力。
- 项目后续存在付费开发方向意向（商业版/企业版），但具体功能范围与发布时间 **待定**。
- 社区版与潜在付费版的边界方案 **待定**，社区版仍会保持可独立部署与可持续维护。

## 核心特性

- Web 端 SSH 终端：基于 WebSocket 的实时交互终端。
- 连接资产管理：支持保存主机连接信息，密码/私钥凭据加密存储。
- 会话生命周期管理：会话状态跟踪、断开重连、会话备注。
- 增强会话持久化：支持基于 `tmux` 的持久会话设计、增强保活与自动重试机制。
- 移动端适配：面向手机浏览器的触摸友好操作与布局。
- 系统监控面板：CPU、内存、网络、进程、磁盘等实时查看。
- 文件管理能力：浏览、上传、下载、重命名、删除、权限修改、批量上传。
- 基础安全能力：JWT 鉴权、密码复杂度校验、登录失败锁定、请求追踪 ID 日志。

## 技术栈

- 后端：FastAPI + SQLAlchemy + AsyncSSH + SQLite
- 前端：React + TypeScript + Vite + TailwindCSS + xterm.js
- 部署：Docker / Docker Compose

## 快速开始

> 重要安全提示：部署前务必修改 `.env` 中的 `SECRET_KEY`（不要使用示例值或弱口令），否则会显著降低会话与鉴权安全性。

### 方式 1：本地开发部署

请阅读 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) 中“本地开发部署”章节。

### 方式 2：Docker 镜像部署

Docker Hub 镜像：`https://hub.docker.com/r/beibeizi/websshgateway`

快速启动示例（注意：`SECRET_KEY` 仅为示例，自行部署必须替换，32 位 UUID 即可）：

```bash
docker run -d -p 8080:8080 -e SECRET_KEY="67e457b4eab14012b34382b3d634f297" beibeizi/websshgateway:latest
```

```bash
export DOCKER_IMAGE=beibeizi/websshgateway:latest

# 也可以自行构建本地镜像
docker build -t webssh-gateway:community .
docker run -d \
  --name webssh-gateway \
  -p 8080:8080 \
  --env-file .env \
  -v webssh-data:/data \
  ${DOCKER_IMAGE:-webssh-gateway:community}
```

更完整说明见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

## 文档导航

- 架构说明： [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- 开发与部署： [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
- 贡献指南： [CONTRIBUTING.md](./CONTRIBUTING.md)
- 英文文档： [README.en.md](./README.en.md)

## 目录结构

```text
.
├── backend/                  # FastAPI 后端
├── frontend/                 # React 前端
├── session-transfer-files/   # 增强会话所需二进制文件
├── docs/                     # 项目文档
├── .env.example              # 环境变量示例
├── Dockerfile                # 镜像构建
├── docker-compose.yml        # 本地容器编排
└── LICENSE
```

## 版本路线图（Roadmap）

- 社区版（当前）：单租户、基础鉴权、连接管理、终端与文件能力。
- 付费方向（待定）：仅保留付费开发方向意向，具体能力与里程碑待定。

## License

本项目基于 [Apache-2.0 License](./LICENSE) 开源。
