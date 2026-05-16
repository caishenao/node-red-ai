# Agent 联网搜索功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI Agent 添加 `search_web` 和 `fetch_url` 两个工具，使其能搜索互联网协议文档并抓取网页内容。

**Architecture:** 后端代理方案——新增两个后端端点 (`/ai/search`, `/ai/fetch-url`)，前端工具通过后端代理调用搜索 API。搜索配置存储在 `ai-config.json` 中，与 LLM 配置统一管理。工具定义条件注入：仅当搜索已启用时才加载。

**Tech Stack:** Node.js (http/https), jQuery (前端), SerpAPI 兼容格式, AES-256-GCM 加密（复用现有 scramble/unscramble）

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/node_modules/@node-red/editor-api/lib/admin/ai.js` | 修改 | 新增搜索工具定义、搜索/抓取端点、配置 helper、系统提示更新 |
| `packages/node_modules/@node-red/editor-api/lib/admin/index.js` | 修改 | 注册两个新路由 |
| `packages/node_modules/@node-red/editor-client/src/js/ui/tab-ai.js` | 修改 | 新增工具执行逻辑、设置面板 UI、配置保存/加载 |

---

### Task 1: 后端 - 搜索配置 helper (`ai.js`)

**Files:**
- Modify: `packages/node_modules/@node-red/editor-api/lib/admin/ai.js`

**Changes:**

- [ ] **Step 1: 添加 `getSearchConfig()` helper**

在 `getResolvedConfig()` 函数（约 line 195）之后添加：

```javascript
function getSearchConfig() {
    var cfg = loadConfig();
    var search = cfg.search || {};
    return {
        enabled: search.enabled === true,
        apiUrl: search.apiUrl || "",
        apiKey: unscramble(search.apiKey || ""),
        engine: search.engine || "google"
    };
}
```

- [ ] **Step 2: 修改 `maskedConfig()` 返回搜索配置 hint**

在 `maskedConfig()` 函数（约 line 177）的 return 对象中，在 `apiKeyHint` 之后添加：

```javascript
// 在 return { ... } 对象末尾、provider/model/hasApiKey/apiKeyHint 之后添加:
searchEnabled: (cfg.search || {}).enabled === true,
searchApiUrl: (cfg.search || {}).apiUrl || "",
searchEngine: (cfg.search || {}).engine || "google",
searchApiKeyHint: (function() {
    var sak = unscramble((cfg.search || {}).apiKey || "");
    if (sak && sak.length > 4) { return "****" + sak.slice(-4); }
    if (sak) { return "****"; }
    return "";
})()
```

- [ ] **Step 3: 修改 `postConfig` handler 保存搜索配置**

找到 `postConfig` handler（约 line 1060-1090），在现有的 `cfg.apiKey = scramble(body.apiKey)` 逻辑之后，添加搜索配置保存：

```javascript
// 在 postConfig handler 中，保存 provider/baseUrl/model/apiKey 之后添加:
// Search config
if (body.search) {
    cfg.search = cfg.search || {};
    if (typeof body.search.enabled === "boolean") {
        cfg.search.enabled = body.search.enabled;
    }
    if (body.search.apiUrl !== undefined) {
        cfg.search.apiUrl = body.search.apiUrl;
    }
    if (body.search.engine !== undefined) {
        cfg.search.engine = body.search.engine;
    }
    if (body.search.apiKey) {
        cfg.search.apiKey = scramble(body.search.apiKey);
    }
}
```

- [ ] **Step 4: 验证 — 检查 `postConfig` 的返回值确保包含搜索配置**

确认 `postConfig` handler 最终调用 `res.json(maskedConfig())`，这样前端保存后能收到搜索配置状态。

- [ ] **Step 5: Commit**

```bash
git add packages/node_modules/@node-red/editor-api/lib/admin/ai.js
git commit -m "feat(ai): add search config helpers to backend"
```

---

### Task 2: 后端 - `/ai/search` 端点 (`ai.js`)

**Files:**
- Modify: `packages/node_modules/@node-red/editor-api/lib/admin/ai.js`

**Changes:**

- [ ] **Step 1: 添加 `SEARCH_TOOL_DEFS` 数组**

在 `AGENT_TOOL_DEFS` 数组（约 line 666）之后、`SKILL_TOOL_DEFS`（约 line 891）之前添加：

```javascript
var SEARCH_TOOL_DEFS = [
    {
        name: "search_web",
        description: "Search the internet for protocol specifications, technical documentation, API references, and implementation guides. Use this when the user needs information about IoT protocols (Modbus, MQTT, OPC-UA, BACnet, etc.), device APIs, or any technical standard.",
        parameters: {
            type: "object",
            required: ["query"],
            properties: {
                query: { type: "string", description: "Search keywords. Combine protocol name with terms like 'specification', 'register map', 'communication protocol', 'Node-RED' for best results." }
            }
        }
    },
    {
        name: "fetch_url",
        description: "Fetch and extract the text content of a webpage. Use this to read protocol documentation, datasheets, or technical articles found via search_web. Returns the page title and extracted text (up to 50KB).",
        parameters: {
            type: "object",
            required: ["url"],
            properties: {
                url: { type: "string", description: "HTTP or HTTPS URL to fetch." }
            }
        }
    }
];
```

- [ ] **Step 2: 添加 `searchWeb` handler**

在 `ai.js` 的 module.exports 对象中，在 `parseProtocol` handler 之后添加：

```javascript
    searchWeb: function(req, res) {
        var body = req.body || {};
        var query = body.query;
        if (!query || typeof query !== "string") {
            return res.status(400).json({ error: "query is required" });
        }
        var searchCfg = getSearchConfig();
        if (!searchCfg.enabled || !searchCfg.apiUrl) {
            return res.status(400).json({ error: "搜索功能未配置或未启用" });
        }
        var sep = searchCfg.apiUrl.indexOf("?") === -1 ? "?" : "&";
        var url = searchCfg.apiUrl + sep + "q=" + encodeURIComponent(query) + "&engine=" + encodeURIComponent(searchCfg.engine);
        if (searchCfg.apiKey) {
            url += "&api_key=" + encodeURIComponent(searchCfg.apiKey);
        }
        var headers = { "Accept": "application/json" };
        httpRequest(url, "GET", headers).then(function(result) {
            var data;
            try { data = JSON.parse(result.body); } catch (e) {
                return res.status(502).json({ error: "搜索API返回了非JSON响应" });
            }
            var organic = data.organic_results || data.results || [];
            var results = organic.slice(0, 10).map(function(item) {
                return {
                    title: item.title || "",
                    snippet: item.snippet || item.description || "",
                    url: item.link || item.url || ""
                };
            });
            res.json({ ok: true, query: query, count: results.length, results: results });
        }).catch(function(err) {
            res.status(502).json({ error: "搜索服务暂时不可用: " + err.message });
        });
    },
```

- [ ] **Step 3: Commit**

```bash
git add packages/node_modules/@node-red/editor-api/lib/admin/ai.js
git commit -m "feat(ai): add /ai/search endpoint with SerpAPI-compatible proxy"
```

---

### Task 3: 后端 - `/ai/fetch-url` 端点 (`ai.js`)

**Files:**
- Modify: `packages/node_modules/@node-red/editor-api/lib/admin/ai.js`

**Changes:**

- [ ] **Step 1: 添加 SSRF 防护 helper**

在 `httpRequest()` 函数（约 line 233）之后添加：

```javascript
var BLOCKED_HOSTS = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|localhost$|::1$|\[::1\])/i;

function isBlockedUrl(targetUrl) {
    try {
        var parsed = url.parse(targetUrl);
        var host = parsed.hostname || "";
        return BLOCKED_HOSTS.test(host);
    } catch (e) {
        return true;
    }
}
```

- [ ] **Step 2: 添加 `fetchUrl` handler**

在 module.exports 中，在 `searchWeb` handler 之后添加：

```javascript
    fetchUrl: function(req, res) {
        var body = req.body || {};
        var targetUrl = body.url;
        if (!targetUrl || typeof targetUrl !== "string") {
            return res.status(400).json({ error: "url is required" });
        }
        if (!/^https?:\/\//i.test(targetUrl)) {
            return res.status(400).json({ error: "仅支持 http/https 协议" });
        }
        if (isBlockedUrl(targetUrl)) {
            return res.status(400).json({ error: "不允许访问内网地址" });
        }
        var MAX_SIZE = 50 * 1024; // 50KB
        var parsed = url.parse(targetUrl);
        var lib = parsed.protocol === "http:" ? http : https;
        var reqObj = lib.request({
            method: "GET",
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.path,
            headers: { "User-Agent": "Mozilla/5.0 (Node-RED-AI-Bot)", "Accept": "text/html" }
        }, function(fetchRes) {
            // Follow redirects (3xx)
            if (fetchRes.statusCode >= 300 && fetchRes.statusCode < 400 && fetchRes.headers.location) {
                var redirectUrl = fetchRes.headers.location;
                if (/^https?:\/\//i.test(redirectUrl) && !isBlockedUrl(redirectUrl)) {
                    req.body.url = redirectUrl;
                    return module.exports.fetchUrl(req, res);
                }
                return res.status(502).json({ error: "重定向目标不允许访问" });
            }
            if (fetchRes.statusCode !== 200) {
                return res.status(502).json({ error: "目标服务器返回状态码: " + fetchRes.statusCode });
            }
            var chunks = [];
            var totalSize = 0;
            fetchRes.on("data", function(chunk) {
                totalSize += chunk.length;
                if (totalSize <= MAX_SIZE) { chunks.push(chunk); }
            });
            fetchRes.on("end", function() {
                var html = Buffer.concat(chunks).toString("utf8");
                var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                var title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
                // Strip script/style tags
                var text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
                text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
                text = text.replace(/<[^>]+>/g, " ");
                text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
                text = text.replace(/\s+/g, " ").trim();
                if (text.length > MAX_SIZE) { text = text.slice(0, MAX_SIZE); }
                if (!text) {
                    return res.status(502).json({ error: "页面内容为空" });
                }
                res.json({ ok: true, title: title, text: text, url: targetUrl });
            });
        });
        reqObj.on("error", function(err) {
            res.status(502).json({ error: "无法访问该URL: " + err.message });
        });
        reqObj.setTimeout(15000, function() {
            reqObj.abort();
            res.status(504).json({ error: "请求超时" });
        });
        reqObj.end();
    },
```

- [ ] **Step 3: Commit**

```bash
git add packages/node_modules/@node-red/editor-api/lib/admin/ai.js
git commit -m "feat(ai): add /ai/fetch-url endpoint with SSRF protection"
```

---

### Task 4: 后端 - 路由注册 + Agent 系统提示更新

**Files:**
- Modify: `packages/node_modules/@node-red/editor-api/lib/admin/index.js` (route registration)
- Modify: `packages/node_modules/@node-red/editor-api/lib/admin/ai.js` (agent handler + system prompt)

**Changes:**

- [ ] **Step 1: 在 `index.js` 中注册两个新路由**

在 `adminApp.post("/ai/tap", ...)` 那行（约 line 114）之后添加：

```javascript
        adminApp.post("/ai/search", needsPermission("settings.read"), ai.searchWeb, apiUtil.errorHandler);
        adminApp.post("/ai/fetch-url", needsPermission("settings.read"), ai.fetchUrl, apiUtil.errorHandler);
```

- [ ] **Step 2: 更新 `AGENT_SYSTEM_PROMPT` 中的工具列表**

在 `AGENT_SYSTEM_PROMPT` 数组（约 line 459-496）中，在 `search_palette` 那行之后、Write 类工具之前，插入搜索工具描述：

```javascript
// 在 "    search_palette             - browse flows.nodered.org for installable modules," 之后添加:
// 注意：以下两行仅在搜索已启用时有意义，但 system prompt 是静态的。
// 工具的条件注入在 agent handler 中处理。
"    search_web                 - search the internet for protocol specs, technical docs, API references",
"    fetch_url                  - fetch and read the text content of a webpage",
```

- [ ] **Step 3: 修改 `agent` handler 条件注入搜索工具**

在 `agent` handler（约 line 1179-1206）中，找到这一行：

```javascript
            tools: AGENT_TOOL_DEFS.concat(SKILL_TOOL_DEFS),
```

替换为：

```javascript
            tools: AGENT_TOOL_DEFS.concat(
                getSearchConfig().enabled ? SEARCH_TOOL_DEFS : [],
                SKILL_TOOL_DEFS
            ),
```

- [ ] **Step 4: Commit**

```bash
git add packages/node_modules/@node-red/editor-api/lib/admin/index.js packages/node_modules/@node-red/editor-api/lib/admin/ai.js
git commit -m "feat(ai): register search routes and conditionally inject search tools"
```

---

### Task 5: 前端 - 工具执行逻辑 (`tab-ai.js`)

**Files:**
- Modify: `packages/node_modules/@node-red/editor-client/src/js/ui/tab-ai.js`

**Changes:**

- [ ] **Step 1: 在 `runOneTool()` 中添加 `search_web` 工具处理**

在 `runOneTool()` 的 `execute` 函数中，在 `if (name === "search_palette")` 块（约 line 790）之后、`if (name === "install_palette_module")` 之前，添加：

```javascript
                if (name === "search_web") {
                    if (!args.query || !args.query.trim()) {
                        return Promise.resolve({ ok: false, error: "query required" });
                    }
                    return $.ajax({
                        url: "ai/search",
                        method: "POST",
                        contentType: "application/json",
                        data: JSON.stringify({ query: args.query.trim() })
                    }).catch(function (xhr) {
                        return { ok: false, error: (xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText };
                    });
                }
```

- [ ] **Step 2: 在 `runOneTool()` 中添加 `fetch_url` 工具处理**

紧接在 `search_web` 块之后添加：

```javascript
                if (name === "fetch_url") {
                    if (!args.url || !args.url.trim()) {
                        return Promise.resolve({ ok: false, error: "url required" });
                    }
                    return $.ajax({
                        url: "ai/fetch-url",
                        method: "POST",
                        contentType: "application/json",
                        data: JSON.stringify({ url: args.url.trim() })
                    }).catch(function (xhr) {
                        return { ok: false, error: (xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText };
                    });
                }
```

- [ ] **Step 3: Commit**

```bash
git add packages/node_modules/@node-red/editor-client/src/js/ui/tab-ai.js
git commit -m "feat(ai): add search_web and fetch_url tool handlers in frontend"
```

---

### Task 6: 前端 - 设置面板 UI (`tab-ai.js`)

**Files:**
- Modify: `packages/node_modules/@node-red/editor-client/src/js/ui/tab-ai.js`

**Changes:**

- [ ] **Step 1: 添加模块级变量声明**

在现有变量声明区域（约 line 230 附近，`var providerSelect`, `var modelInput` 等之后）添加：

```javascript
    var searchEnabledCheckbox;
    var searchApiUrlInput;
    var searchApiKeyInput;
    var searchEngineSelect;
    var searchTestBtn;
```

- [ ] **Step 2: 在 `buildSettingsPanel()` 中添加搜索配置区域**

在 `buildSettingsPanel()` 函数中，在 `clearCfgBtn.on("click", onClearConfig);` 之前（约 line 270），添加搜索配置 UI：

```javascript
        // --- 搜索 API 配置区域 ---
        $('<hr>').appendTo(form);
        $('<h4></h3>').text(RED._("sidebar.ai.searchTitle", { defaultValue: "搜索 API" })).appendTo(form);

        var searchEnabledRow = $('<div class="red-ui-sidebar-ai-settings-row"></div>').appendTo(form);
        searchEnabledCheckbox = $('<input type="checkbox" id="red-ui-sidebar-ai-search-enabled">').appendTo(searchEnabledRow);
        $('<label for="red-ui-sidebar-ai-search-enabled"></label>')
            .text(RED._("sidebar.ai.searchEnabled", { defaultValue: "启用联网搜索" }))
            .appendTo(searchEnabledRow);

        var searchUrlRow = $('<div class="red-ui-sidebar-ai-settings-row"></div>').appendTo(form);
        $('<label></label>').text(RED._("sidebar.ai.searchApiUrl", { defaultValue: "API 地址" })).appendTo(searchUrlRow);
        searchApiUrlInput = $('<input type="text" placeholder="https://serpapi.com/search">').appendTo(searchUrlRow);

        var searchKeyRow = $('<div class="red-ui-sidebar-ai-settings-row"></div>').appendTo(form);
        $('<label></label>').text(RED._("sidebar.ai.searchApiKey", { defaultValue: "API 密钥" })).appendTo(searchKeyRow);
        searchApiKeyInput = $('<input type="password" placeholder="留空表示沿用已有值">').appendTo(searchKeyRow);

        var searchEngineRow = $('<div class="red-ui-sidebar-ai-settings-row"></div>').appendTo(form);
        $('<label></label>').text(RED._("sidebar.ai.searchEngine", { defaultValue: "搜索引擎" })).appendTo(searchEngineRow);
        searchEngineSelect = $('<select><option value="google">Google</option><option value="bing">Bing</option><option value="baidu">Baidu</option><option value="searxng">SearXNG</option></select>').appendTo(searchEngineRow);

        var searchActions = $('<div class="red-ui-sidebar-ai-settings-actions"></div>').appendTo(form);
        searchTestBtn = $('<button type="button" class="red-ui-button"></button>')
            .html('<i class="fa fa-plug"></i> ' + RED._("sidebar.ai.searchTest", { defaultValue: "测试连接" }))
            .appendTo(searchActions);
        searchTestBtn.on("click", onTestSearch);
```

- [ ] **Step 3: 添加 `onTestSearch` 测试连接函数**

在 `onSaveSettings` 函数之前添加：

```javascript
    function onTestSearch() {
        var url = searchApiUrlInput.val().trim();
        if (!url) {
            RED.notify("请先填写 API 地址", "error");
            return;
        }
        searchTestBtn.prop("disabled", true).text("测试中...");
        $.ajax({
            url: "ai/search",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({ query: "test" })
        }).done(function (data) {
            RED.notify("搜索 API 连接成功，返回 " + (data.count || 0) + " 条结果", "success");
        }).fail(function (xhr) {
            RED.notify("连接失败: " + ((xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText), "error");
        }).always(function () {
            searchTestBtn.prop("disabled", false).html('<i class="fa fa-plug"></i> ' + RED._("sidebar.ai.searchTest", { defaultValue: "测试连接" }));
        });
    }
```

- [ ] **Step 4: 修改 `onSaveSettings()` 保存搜索配置**

修改 `onSaveSettings()` 函数（约 line 443），在 `body` 对象中添加搜索字段：

```javascript
    function onSaveSettings() {
        var body = {
            provider: providerSelect.val(),
            baseUrl: baseUrlInput.val().trim(),
            model: modelInput.val().trim(),
            search: {
                enabled: searchEnabledCheckbox.is(":checked"),
                apiUrl: searchApiUrlInput.val().trim(),
                engine: searchEngineSelect.val()
            }
        };
        var keyVal = apiKeyInput.val();
        if (keyVal !== "") {
            body.apiKey = keyVal;
        }
        var searchKeyVal = searchApiKeyInput.val();
        if (searchKeyVal !== "") {
            body.search.apiKey = searchKeyVal;
        }
        // ... rest of existing save logic unchanged
        saveBtn.prop("disabled", true);
        $.ajax({
            url: "ai/config",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify(body)
        }).done(function (cfg) {
            configCache = cfg;
            RED.notify(RED._("sidebar.ai.savedNotice", { defaultValue: "AI 设置已保存" }), "success");
            showChat();
        }).fail(function (xhr) {
            RED.notify("保存失败：" + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText), "error");
        }).always(function () {
            saveBtn.prop("disabled", false);
        });
    }
```

- [ ] **Step 5: 修改 `showSettings()` 填充搜索配置**

找到 `showSettings()` 函数（约 line 470-495），在现有填充逻辑之后添加搜索字段填充：

```javascript
        // 在现有的 providerSelect.val(cfg.provider || "openai") ... 之后添加:
        // 填充搜索配置
        searchEnabledCheckbox.prop("checked", !!cfg.searchEnabled);
        searchApiUrlInput.val(cfg.searchApiUrl || "");
        searchEngineSelect.val(cfg.searchEngine || "google");
        searchApiKeyInput.val(""); // 不回显密钥
        if (cfg.searchApiKeyHint) {
            searchApiKeyInput.attr("placeholder", "当前: " + cfg.searchApiKeyHint);
        } else {
            searchApiKeyInput.attr("placeholder", "留空表示沿用已有值");
        }
```

- [ ] **Step 6: Commit**

```bash
git add packages/node_modules/@node-red/editor-client/src/js/ui/tab-ai.js
git commit -m "feat(ai): add search API settings panel with test connection"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 启动 Node-RED 验证无启动错误**

```bash
cd D:/work/self/node-red && node packages/node_modules/node-red/red.js --userDir /tmp/nr-test
```

确认控制台无报错，按 Ctrl+C 停止。

- [ ] **Step 2: 打开浏览器访问 AI 设置面板**

启动 Node-RED，打开浏览器 → 打开 AI 侧边栏 → 进入设置 → 确认搜索 API 配置区域显示正确。

- [ ] **Step 3: 测试搜索功能**

在 AI 设置中填写搜索 API 配置并保存。在 AI 聊天中输入："搜索 Modbus TCP 协议规范"。确认 Agent 调用 `search_web` 工具并返回搜索结果。

- [ ] **Step 4: 测试抓取功能**

在搜索结果中找到一个 URL，让 Agent 抓取该页面。确认 `fetch_url` 工具返回页面正文。

- [ ] **Step 5: 测试未启用时工具不加载**

在 AI 设置中关闭搜索功能。刷新页面，发起对话，确认 Agent 工具列表中没有 `search_web` 和 `fetch_url`。

- [ ] **Step 6: 测试 SSRF 防护**

让 Agent 抓取 `http://127.0.0.1:1880`，确认返回"不允许访问内网地址"错误。

- [ ] **Step 7: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix(ai): web search edge cases and validation"
```
