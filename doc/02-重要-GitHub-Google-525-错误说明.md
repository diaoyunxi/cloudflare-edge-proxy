> [← 返回文档目录](../README.md) ｜ 本分册由 `README.md` 的「重要：GitHub/Google 525 错误说明」章节拆分而来。

## 重要：GitHub/Google 525 错误说明

GitHub、Google 等网站会**主动拒绝 Cloudflare Worker IP 的 TLS 连接**，导致 `525 SSL Handshake Failed` 错误。这不是代码问题，而是这些网站在网络层面封锁了 Cloudflare 的 IP 段。

**解决方案**：部署一台 VPS 作为中继服务器，配置 `RELAY_URL` 环境变量。Worker 在直连失败时会自动回退到中继服务器获取内容。

详见下方[中继服务器部署](#中继服务器部署可选)章节。
