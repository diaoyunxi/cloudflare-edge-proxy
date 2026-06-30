# Edge Proxy — Cloudflare Worker 边缘代理

通过 Cloudflare 边缘节点实现反向代理，可在 iframe 中嵌入被 `X-Frame-Options` / `Content-Security-Policy` 限制的网站。

## 功能特性

- **地址栏嵌入** — 输入网址即可在页面内嵌入目标网站
- **边缘代理** — 利用 Cloudflare 全球边缘节点进行请求转发
- **绕过嵌入限制** — 自动移除 `X-Frame-Options`、`CSP` 等阻止 iframe 嵌入的响应头
- **URL 重写** — 自动重写 HTML/CSS 中的资源链接，使所有请求经过代理
- **动态请求拦截** — 注入脚本拦截 `fetch`、`XMLHttpRequest`、`window.open`、`history.pushState` 等
- **MutationObserver** — 监听动态添加的 DOM 元素并重写其 URL
- **多内容类型支持** — HTML、CSS、JavaScript、JSON、图片、视频、字体等
- **中继服务器支持** — 当目标网站封锁 Cloudflare IP 时，自动回退到中继服务器

## 重要：GitHub/Google 525 错误说明

GitHub、Google 等网站会**主动拒绝 Cloudflare Worker IP 的 TLS 连接**，导致 `525 SSL Handshake Failed` 错误。这不是代码问题，而是这些网站在网络层面封锁了 Cloudflare 的 IP 段。

**解决方案**：部署一台 VPS 作为中继服务器，配置 `RELAY_URL` 环境变量。Worker 在直连失败时会自动回退到中继服务器获取内容。

详见下方[中继服务器部署](#中继服务器部署可选)章节。

## 快速部署

### 方式一：Cloudflare Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages
2. 点击 **Create application** → **Create Worker**
3. 命名你的 Worker，点击 **Deploy**
4. 点击 **Edit code**，粘贴 `worker.js` 的全部内容
5. 点击 **Save and deploy**

### 方式二：Wrangler CLI

```bash
npm install -g wrangler
wrangler login

git clone https://github.com/diaoyunxi/cloudflare-edge-proxy.git
cd cloudflare-edge-proxy
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

## 中继服务器部署（可选）

当需要代理 GitHub、Google 等封锁 Cloudflare IP 的网站时，需要部署中继服务器。

### 步骤一：部署中继服务器

在一台 VPS 上运行 `relay-server.js`：

```bash
# 在 VPS 上
git clone https://github.com/diaoyunxi/cloudflare-edge-proxy.git
cd cloudflare-edge-proxy

# 直接运行（需要 Node.js）
node relay-server.js

# 或使用 PM2 守护进程
npm install -g pm2
pm2 start relay-server.js --name relay
```

中继服务器默认运行在 `3000` 端口，可通过 `PORT` 环境变量修改。

### 步骤二：配置 Worker 环境变量

在 Cloudflare Dashboard 中：

1. 进入 Workers & Pages → 选择你的 Worker
2. Settings → Variables
3. 添加环境变量：
   - 变量名：`RELAY_URL`
   - 变量值：`http://your-vps-ip:3000/fetch?url=`
4. 保存并重新部署

### 步骤三：验证

访问 `https://your-worker.workers.dev/health`，确认 `relay` 字段已显示你的中继服务器地址。

## 工作原理

```
用户浏览器 → Cloudflare 边缘节点 (Worker) → 目标网站
                    ↓ (如果 525/被封锁)
                中继服务器 (VPS) → 目标网站
```

1. Worker 首先尝试直接获取目标网站
2. 如果返回 525/521/522 等 Cloudflare 边缘错误，自动回退到中继服务器
3. 中继服务器（部署在普通 VPS 上，IP 不被封锁）获取内容并返回给 Worker
4. Worker 对内容进行 URL 重写、头部清理、脚本注入后返回给用户

## 已知限制

- **登录/会话** — 不转发 Cookie，需要登录的网站可能无法正常使用
- **WebSocket** — 暂不支持 WebSocket 代理
- **GitHub/Google 直连** — 这些网站封锁 Cloudflare Worker IP，需配置中继服务器
- **部分 SPA** — 高度依赖 `window.location` 的单页应用可能出现导航异常

## 文件结构

```
cloudflare-edge-proxy/
├── worker.js          # Worker 主脚本（可直接粘贴到 Dashboard）
├── relay-server.js    # 中继服务器脚本（部署在 VPS 上）
├── wrangler.toml      # Wrangler 配置文件
├── package.json       # npm 包配置
└── README.md          # 说明文档
```

## 环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `RELAY_URL` | 中继服务器地址（直连失败时回退使用） | `http://your-vps:3000/fetch?url=` |

## 技术栈

- **Worker 运行时**：Cloudflare Workers（V8 引擎，ES Modules，无依赖）
- **中继服务器**：Node.js（无第三方依赖）

## License

MIT
