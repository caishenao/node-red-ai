# node-red-ai

> 在 Node-RED 编辑器侧边栏内嵌入 AI 助手（Agent + Skills），让 AI 直接读取和操作画布、安装节点、根据自然语言修改流程。

这是一个 **Node-RED 的 fork**，在保留原有功能与构建流程的基础上，新增了一整套 AI 协作能力。上游 README 保留在 [README-upstream.md](./README-upstream.md)。

## 功能概览

### 1. 侧边栏 AI 对话（每个 flow 一个 session）
- 工具栏「AI」标签，进入对话面板
- 每个流程 tab 维持独立会话，切换 tab 自动 swap 历史
- 删除流程 tab 会自动清理对应 session
- 顶部显示当前对话所属的 flow 名称
- 右上角操作：清空当前会话 / 技能管理 / AI 设置

### 2. 多 Provider 接入
- **OpenAI 兼容**（OpenAI、DeepSeek、Moonshot、SiliconFlow 等）
- **Anthropic Claude**（claude-sonnet-4-6、claude-opus-4-7 等）
- API Key 用 AES-256-GCM 加密存储在 `<userDir>/ai-config.json`，前端只能看到尾部 hint

### 3. Agent 模式（Cursor 风格的工具调用）
AI 不再贴 JSON，而是通过工具直接读写画布：

| 工具 | 作用 | 是否需审批 |
|------|------|------|
| `list_installed_node_types` | 列出已注册节点类型 | 否 |
| `get_node_info` | 读取节点 help / metadata | 否 |
| `list_flows` | 列出所有 flow tab | 否 |
| `get_current_flow` | 取当前 flow 的所有节点 | 否 |
| `get_selection` | 读取用户当前选中的节点 | 否 |
| `get_node_config` | 取某节点完整配置 | 否 |
| `search_palette` | 搜索 palette 市场 | 否 |
| `install_palette_module` | 安装节点模块 | ✅ |
| `add_subflow` | 新建子流程 | ✅ |
| `add_nodes` | 在画布添加节点 | ✅ |
| `wire_nodes` | 连接节点 | ✅ |
| `update_node` | 修改节点配置（最小补丁） | ✅ |
| `delete_node` | 删除节点 | ✅ |
| `list_skills` / `read_skill` | 查阅 / 读取已安装技能 | 否 |
| `install_skill_from_url` | 下载安装技能 | ✅ |

需审批的操作会通过 toast 弹出「同意 / 拒绝」按钮，用户确认后才执行。

### 4. 选区上下文注入
- 在画布上选中节点后，输入框上方显示节点 chip：`name [type·idShort]`
- 点击 chip 可在画布定位节点；点 × 把该节点从此次上下文移除
- 发送时把选中节点 id 列表注入到用户消息，提示 AI 「先 `get_node_config` 读取再 `update_node` 修改」

### 5. 文件附件
- 输入框旁回形针按钮，支持上传 ≤ 200 KB 的文本 / Markdown / 协议文档
- 多个附件并入同一条用户消息发给 AI
- AI 可基于附件回答或生成子流程

### 6. 技能（Skills）系统
- **技能 = 带 YAML frontmatter 的 Markdown 操作手册**
- 启用的技能会被注入到 Agent 系统提示，AI 看到匹配描述会自动 `read_skill` 阅读全文再行动

支持三种安装方式：

```text
1. 直接 URL：https://example.com/skill.md
2. npx 命令：npx skills add <name>     ← 启动子进程到临时目录抓取
3. 内置技能名：superpower               ← 项目内置
```

#### 默认安装：superpower
首次启动会自动安装 `superpower` 技能，内容是 Node-RED IoT 接入与画布编排心法（节点选择策略、工具调用顺序、复杂度门槛等）。删除后下次启动会再次 seed。

技能存储位置：`<userDir>/ai-skills/`

## 快速开始

### 本地运行

```bash
git clone https://github.com/caishenao/node-red-ai.git
cd node-red-ai
npm install
npx grunt build
node packages/node_modules/node-red/red.js --userDir .userdir --port 1880
```

打开 `http://127.0.0.1:1880`，在右侧栏切换到「AI」标签，点齿轮图标配置 API Key，开始对话。

### Docker 运行

#### 快速启动（推荐）

镜像已发布到 Docker Hub：`caishenao11/node-red-ai:latest`。直接拉取并启动：

```bash
docker pull caishenao11/node-red-ai:latest
docker volume create node-red-ai-data

docker run -d --name node-red-ai \
  --restart unless-stopped \
  -p 1880:1880 \
  -v node-red-ai-data:/data \
  caishenao11/node-red-ai:latest
```

启动后打开 `http://127.0.0.1:1880`，在右侧栏切换到「AI」标签，点齿轮图标配置 API Key。

常用维护命令：

```bash
docker logs -f node-red-ai       # 查看日志
docker restart node-red-ai       # 重启服务
docker rm -f node-red-ai         # 删除容器（保留数据卷）
docker volume rm node-red-ai-data # 如需清空 flows / AI 配置 / 技能，再删除数据卷
```

数据目录 `/data` 与上游 `nodered/node-red` 镜像保持一致：`flows.json`、`ai-config.json`（AES-GCM 加密的 API Key）、`ai-skills/` 都落在该卷里，重启不丢。容器以非 root 用户 `node` (UID 1000) 运行，并使用 `tini` 做 PID 1 处理 SIGTERM。

健康检查内置：`HEALTHCHECK` 每 30s 探测 `http://127.0.0.1:1880/`，失败 3 次置为 unhealthy。

#### docker compose

仓库根目录还提供 `docker-compose.yml`，一行起停：

```bash
docker compose up -d        # 第一次会自动拉取 caishenao11/node-red-ai:latest
docker compose logs -f      # 跟随日志
docker compose down         # 停止（保留数据卷 node-red-ai-data）
docker compose down -v      # 连同数据卷一起删除（清空 flows / AI 配置 / 技能）
```

如需把数据放到宿主机目录，把 `docker-compose.yml` 里 `volumes` 改成 `- ./userdir:/data`，并 `mkdir -p userdir && chown 1000:1000 userdir`（容器内是 UID 1000 的 `node` 用户）。

#### 本地构建（可选）

仓库根目录提供了完整的 fork 自构建 `Dockerfile`（多阶段：builder 跑 `npm install + grunt build`，runtime 仅保留运行时产物）。需要从当前源码重新构建时：

```bash
docker build -t caishenao11/node-red-ai:latest .
```

### 配置 AI 服务

| 字段 | 示例 |
|------|------|
| 服务商 | OpenAI 兼容 / Anthropic Claude |
| 模型 | `gpt-4o-mini`、`deepseek-chat`、`claude-sonnet-4-6` |
| Base URL | `https://api.openai.com`、`https://api.deepseek.com`、`https://api.anthropic.com` |
| API Key | sk-... |

## 目录结构

```
packages/node_modules/@node-red/
├── editor-api/
│   └── lib/admin/
│       ├── ai.js                  # 后端 AI 服务（chat / agent / skills）
│       ├── index.js               # /ai/* 路由注册
│       └── skills-builtin/
│           └── superpower.md      # 内置技能
└── editor-client/
    ├── src/js/ui/
    │   └── tab-ai.js              # 前端 AI 侧边栏（agent loop / skills UI）
    ├── src/sass/
    │   └── tab-ai.scss            # 样式
    └── locales/
        ├── en-US/editor.json      # 英文文案
        └── zh-CN/editor.json      # 中文文案
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/ai/config` | 读取配置（API Key 已脱敏） |
| POST | `/ai/config` | 保存配置 |
| POST | `/ai/chat` | 普通对话 |
| POST | `/ai/agent` | Agent 模式（带工具调用） |
| POST | `/ai/parse-protocol` | 解析协议文档 |
| POST | `/ai/generate-subflow` | 从协议生成子流程 |
| GET  | `/ai/skills` | 列出已安装技能 |
| GET  | `/ai/skills/:id` | 读取技能完整内容 |
| POST | `/ai/skills` | 安装技能（spec / content） |
| PUT  | `/ai/skills/:id` | 启用/停用 |
| DELETE | `/ai/skills/:id` | 删除 |

## 安全

- API Key 用 AES-256-GCM 加密存储，前端永远收不到原文
- 所有写入类工具（`update_node` / `delete_node` / `install_palette_module` / `install_skill_from_url` 等）必须用户 toast 确认
- URL 安装的技能限制 ≤ 512 KB、仅 http(s)、最多 5 次重定向
- `npx skills add` 在临时目录执行，不影响项目 node_modules

## 编写自定义技能

```markdown
---
name: my-mqtt-bridge
description: 把 MQTT 主题映射成 HTTP webhook
tags: mqtt, http
---

# 步骤
1. ...
2. ...
```

把上面这种 `.md` 文件放到 `<userDir>/ai-skills/` 或通过技能面板上传即可。

## 许可

继承上游 Node-RED 项目的 Apache-2.0 协议，详见 [LICENSE](./LICENSE)。

## 致谢

- [Node-RED](https://github.com/node-red/node-red) — 上游项目
- [Anthropic Claude](https://www.anthropic.com/) / [OpenAI](https://openai.com/) — LLM 服务
