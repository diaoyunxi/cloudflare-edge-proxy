# Edge Proxy — Cloudflare Worker 边缘代理

通过 Cloudflare 边缘节点实现反向代理，可在 iframe 中嵌入被 `X-Frame-Options` / `Content-Security-Policy` 限制的网站（如 GitHub、Google 等）。

## 功能特性

- **地址栏嵌入** — 输入网址即可在页面内嵌入目标网站
- **边缘代理** — 利用 Cloudflare 全球边缘节点进行请求转发
- **绕过嵌入限制** — 自动移除 `X-Frame-Options`、`CSP` 等阻止 iframe 嵌入的响应头
- **URL 重写** — 自动重写 HTML/CSS 中的资源链接，使所有请求经过代理
- **动态请求拦截** — 注入脚本拦截 `fetch`、`XMLHttpRequest`、`window.open`、`history.pushState` 等
- **MutationObserver** — 监听动态添加的 DOM 元素并重写其 URL
- **多内容类型支持** — HTML、CSS、JavaScript、JSON、图片、视频、字体等

## 快速部署

### 方式一：Cloudflare Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages
2. 点击 **Create application** → **Create Worker**
3. 命名你的 Worker，点击 **Deploy**
4. 点击 **Edit code**，粘贴 `worker.js` 的全部内容
5. 点击 **Save and deploy**

### 方式二：Wrangler CLI

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录
wrangler login

# 克隆仓库
git clone https://github.com/你的用户名/cloudflare-edge-proxy.git
cd cloudflare-edge-proxy

# 部署
wrangler deploy
```

## 使用方法

1. 访问你的 Worker 域名（如 `https://your-worker.your-subdomain.workers.dev`）
2. 在地址栏输入目标网址（如 `github.com`）
3. 按回车或点击「前往」按钮
4. 目标网站将嵌入到页面下方的 iframe 中

也支持通过 URL 参数直接访问：

```
https://your-worker.workers.dev/?url=github.com
```

## 工作原理

```
用户浏览器 → Cloudflare 边缘节点 (Worker) → 目标网站
                ↑
         移除 X-Frame-Options / CSP
         重写 HTML/CSS 中的 URL
         注入客户端脚本拦截动态请求
```

1. 用户在地址栏输入 URL
2. Worker 将 URL 进行 Base64 编码，作为路径参数（`/proxy/<encoded>`）
3. iframe 加载该代理 URL
4. Worker 在边缘节点获取目标网站内容
5. 移除阻止嵌入的响应头（X-Frame-Options、CSP 等）
6. 重写 HTML/CSS 中的所有 URL，使资源请求也经过代理
7. 注入客户端脚本，拦截 `fetch`/`XHR`/`window.open`/`history` 等动态请求

## 已知限制

- **登录/会话** — 不转发 Cookie，需要登录的网站可能无法正常使用
- **WebSocket** — 暂不支持 WebSocket 代理
- **Service Worker** — 目标网站的 Service Worker 注册会被忽略
- **`window.location`** — 页面内 JavaScript 读取的 `location` 为代理 URL，非原始 URL
- **部分 SPA** — 高度依赖 `window.location` 的单页应用可能出现导航异常
- **CORS 预检** — 复杂的 CORS 预检请求可能不被正确处理

## 文件结构

```
cloudflare-edge-proxy/
├── worker.js        # Worker 主脚本（可直接粘贴到 Dashboard 使用）
├── wrangler.toml    # Wrangler 配置文件
├── package.json     # npm 包配置
└── README.md        # 说明文档
```

## 技术栈

- **运行时**：Cloudflare Workers（V8 引擎）
- **语言**：原生 JavaScript（ES Modules）
- **无依赖** — 不需要任何 npm 包

## License

MIT
