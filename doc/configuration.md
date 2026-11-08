> [← 返回文档目录](../README.md)

# 环境变量（`worker.js` / `relay-server.js`）

| 变量 | 读取位置 | 说明 |
|---|---|---|
| `RELAY_URL` | `worker.js` | 中继服务器地址，直连失败（525/521/522）时回退 |
| `RATE_LIMIT` | `worker.js` | 单 IP 每分钟请求上限，默认 `60` |
| `CF_API_TOKEN` | `worker.js` | Cloudflare API 令牌（自动更新用） |
| `CF_ACCOUNT_ID` | `worker.js` | Cloudflare 账户 ID（自动更新用） |
| `CF_SCRIPT_NAME` | `worker.js` | Worker 脚本名（自动更新用） |
| `PORT` | `relay-server.js` | 中继监听端口，默认 `3000` |
| `AUTH_TOKEN` | `relay-server.js` | 中继访问令牌，`?token=` 或 `X-Relay-Token` 头 |
| `RELAY_ALLOWED_ORIGIN` | `relay-server.js` | 中继 CORS 允许来源，默认 `*` |

`/health` 响应会回显当前 `relay` 配置，可用于验证 `RELAY_URL` 是否生效。

> `.env.example` 早期版本中的 `PROXY_AUTH_TOKEN`、`TARGET_ORIGIN`、`ALLOWED_ORIGINS`
> 为通用模板占位，当前 `worker.js` / `relay-server.js` 均未读取，已同步修正。
