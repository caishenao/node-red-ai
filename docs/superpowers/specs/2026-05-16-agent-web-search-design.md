# Agent 联网搜索功能设计

## 概述

为 Node-RED AI Agent 添加联网搜索能力，使 Agent 能够在互联网上搜索协议规范、技术文档、API 参考等信息，辅助用户实现 IoT 协议对接流程节点。

## 目标

- Agent 可通过 `search_web` 工具搜索互联网信息
- Agent 可通过 `fetch_url` 工具抓取指定 URL 的网页正文
- 用户在 AI 设置面板中配置搜索 API（兼容 SerpAPI 格式）
- API Key 安全存储，不暴露到浏览器端

## 非目标

- 不实现自动页面抓取（不自动 fetch 搜索结果中的 URL）
- 不绑定特定搜索引擎，支持任意 SerpAPI 兼容服务
- 不修改 Agent loop 核心逻辑

## 架构

```
Frontend (tab-ai.js)                    Backend (ai.js)
┌─────────────────────┐                ┌─────────────────────┐
│ Agent Loop          │                │ POST /ai/search     │
│  ├ search_web ──────┼── /ai/search ──┼→ 调用搜索API        │
│  └ fetch_url ───────┼── /ai/fetch ───┼→ 抓取URL提取正文    │
│                     │                │                     │
│ AI Settings Panel   │                │ 配置: ai-config.json│
│  └ 搜索API配置区域   │                │  search:{...}       │
└─────────────────────┘                └─────────────────────┘
```

## 修改文件清单

| 文件 | 变更 |
|------|------|
| `packages/node_modules/@node-red/editor-api/lib/admin/ai.js` | 新增 `/ai/search` 和 `/ai/fetch-url` 端点；配置读写逻辑 |
| `packages/node_modules/@node-red/editor-api/lib/admin/index.js` | 路由注册 |
| `packages/node_modules/@node-red/editor-client/src/js/ui/tab-ai.js` | 新增工具定义 + 执行逻辑 + 设置面板 UI |
| `packages/node_modules/@node-red/editor-client/src/sass/tab-ai.scss` | 设置面板样式（如需要） |

## 后端设计

### 配置存储

`ai-config.json` 新增 `search` 字段：

```json
{
  "provider": "openai-compatible",
  "baseUrl": "https://...",
  "model": "gpt-5.5",
  "apiKey": "encrypted-xxx",
  "search": {
    "enabled": true,
    "apiUrl": "https://serpapi.com/search",
    "apiKey": "encrypted-xxx",
    "engine": "google"
  }
}
```

- `enabled`: 开关，关闭后 Agent 不加载搜索工具
- `apiUrl`: 搜索 API 端点
- `apiKey`: 搜索 API 密钥（加密存储，复用现有 `encrypt()`/`decrypt()`）
- `engine`: 搜索引擎类型传参

### 端点：POST /ai/search

**请求：**
```json
{ "query": "Modbus TCP 协议规范" }
```

**响应：**
```json
{
  "results": [
    { "title": "...", "snippet": "...", "url": "https://..." },
    { "title": "...", "snippet": "...", "url": "https://..." }
  ]
}
```

**逻辑：**
1. 读取 `ai-config.json` 中 `search` 配置
2. 若未启用或未配置，返回 400 错误
3. 使用 `httpRequest()` 向 `apiUrl` 发请求
4. 解析 SerpAPI 格式响应（`organic_results[]`），映射为统一格式
5. 最多返回 10 条结果
6. 超时 10s

### 端点：POST /ai/fetch-url

**请求：**
```json
{ "url": "https://example.com/protocol-doc" }
```

**响应：**
```json
{ "title": "Protocol Doc", "text": "...", "url": "https://..." }
```

**逻辑：**
1. URL 安全校验（仅 http/https，禁止内网地址）
2. 使用 `httpRequest()` 抓取 HTML
3. 去掉 `<script>`/`<style>` 标签，提取 `<title>` 和正文文本
4. 截断到 50KB
5. 超时 15s

### SSRF 防护

`fetch-url` 禁止抓取以下地址：
- `127.0.0.0/8`、`localhost`
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `169.254.0.0/16`
- `::1`、`[::1]`

### Agent 系统提示

当 `search.enabled === true` 时，在 `AGENT_SYSTEM_PROMPT` 追加：

```
You have access to web search capabilities:
- Use `search_web` to search the internet for protocol specifications, technical documentation, API references
- Use `fetch_url` to read the full content of a specific webpage
- When implementing IoT protocol nodes, search for the protocol specification first
```

## 前端设计

### 工具定义（注入到 Agent tools 数组）

**search_web：**
```javascript
{
  name: "search_web",
  description: "在互联网上搜索信息，用于查找协议规范、技术文档、API参考等",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" }
    },
    required: ["query"]
  }
}
```

**fetch_url：**
```javascript
{
  name: "fetch_url",
  description: "抓取指定URL的网页内容并提取正文文本",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "要抓取的网页URL" }
    },
    required: ["url"]
  }
}
```

### 工具执行

在 `executeToolCall()` 中新增两个 case，调用后端端点，均为只读工具，无需用户审批。

### 工具加载条件

仅当搜索配置已启用时加载。检查逻辑与现有 `initAiConfig` 流程集成。

### 设置面板 UI

在现有 AI 设置对话框中新增「搜索 API」区域：

```
── 搜索 API ─────────────────────────
☐ 启用联网搜索
API 地址:  [________________________]
API 密钥:  [________________________]
搜索引擎:  [▼ Google               ]
[测试连接]
```

- 「测试连接」：调用 `POST /ai/search` 做一次测试搜索
- 保存时加密 apiKey，写入 ai-config.json

## 安全

| 措施 | 说明 |
|------|------|
| SSRF 防护 | fetch-url 禁止内网地址 |
| Key 加密 | 搜索 API Key 与 LLM Key 同等加密保护 |
| 内容截断 | fetch-url 最多 50KB；search 最多 10 条 |
| 超时控制 | 搜索 10s，抓取 15s |
| 协议限制 | 仅允许 http/https |

## 错误处理

| 场景 | 返回给 Agent |
|------|-------------|
| 搜索 API 未配置 | 工具不加载 |
| 搜索 API 错误 | `{"error": "搜索服务暂时不可用: ..."}` |
| 抓取目标不可达 | `{"error": "无法访问该URL: ..."}` |
| 抓取内容为空 | `{"error": "页面内容为空"}` |
| 超时 | `{"error": "请求超时"}` |
| SSRF 拦截 | `{"error": "不允许访问内网地址"}` |
