# 贡献指南

感谢你对 cloudflare-edge-proxy 项目的关注！

## 开发环境

- **运行时：** Cloudflare Workers
- **部署：** Wrangler CLI

## 安全注意事项

- CSP 策略中避免 `unsafe-eval` 和 `unsafe-inline`（CWE-79）
- 请求体大小限制防止 DoS（CWE-770）
- SSRF 防护阻止内网访问（CWE-918）
- URL Token 避免在日志中泄露（CWE-598）
- 安全响应头配置完整

## 提交 Pull Request

1. Fork 并创建功能分支
2. `wrangler dev` 本地测试
3. 遵循 Conventional Commits 规范
