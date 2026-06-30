/**
 * Relay Server — 中继服务器
 *
 * 部署在 VPS 上，为 Cloudflare Worker 提供中继服务。
 * 当 GitHub、Google 等网站封锁 Cloudflare Worker IP 时，
 * Worker 可通过此服务器中继获取内容。
 *
 * 部署方法：
 *   node relay-server.js
 *
 * 然后在 Cloudflare Worker 的环境变量中设置：
 *   RELAY_URL = http://your-vps-ip:3000/fetch?url=
 *
 * 可选环境变量：
 *   PORT - 监听端口（默认 3000）
 *   AUTH_TOKEN - 访问令牌（防止被滥用，如设置为 abc123，
 *                则请求需携带 ?token=abc123 或 X-Relay-Token 头）
 */

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

// ==================== 真实浏览器请求头 ====================

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

// ==================== 主服务器 ====================

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Original-URL, X-Relay-Token',
  };

  // 处理 OPTIONS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // 健康检查
  if (parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ status: 'OK', service: 'relay-server' }));
    return;
  }

  // 鉴权检查
  if (AUTH_TOKEN) {
    const token = parsedUrl.query.token || req.headers['x-relay-token'];
    if (token !== AUTH_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'text/plain', ...corsHeaders });
      res.end('Forbidden: invalid token');
      return;
    }
  }

  // 中继获取
  if (parsedUrl.pathname === '/fetch') {
    const targetUrl = parsedUrl.query.url;

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain', ...corsHeaders });
      res.end('Missing url parameter');
      return;
    }

    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain', ...corsHeaders });
      res.end('Invalid URL');
      return;
    }

    if (!['http:', 'https:'].includes(target.protocol)) {
      res.writeHead(403, { 'Content-Type': 'text/plain', ...corsHeaders });
      res.end('Unsupported protocol');
      return;
    }

    // 构造完整的浏览器请求头
    const headers = { ...BROWSER_HEADERS };
    headers['Referer'] = target.origin + '/';
    headers['Host'] = target.host;

    const lib = target.protocol === 'https:' ? https : http;

    const options = {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: 'GET',
      headers: headers,
    };

    const proxyReq = lib.request(options, (proxyRes) => {
      // 如果是重定向，跟随重定向
      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        const redirectUrl = new URL(proxyRes.headers.location, targetUrl).href;
        // 递归跟随重定向（最多 5 次）
        const redirectCount = parseInt(parsedUrl.query._redirect || '0');
        if (redirectCount < 5) {
          let redirectPath = `/fetch?url=${encodeURIComponent(redirectUrl)}&_redirect=${redirectCount + 1}`;
          if (AUTH_TOKEN) redirectPath += `&token=${AUTH_TOKEN}`;
          const redirectReq = http.request({
            hostname: 'localhost',
            port: PORT,
            path: redirectPath,
            method: 'GET',
          }, (redirectRes) => {
            const headers = { ...redirectRes.headers, ...corsHeaders };
            delete headers['content-length'];
            delete headers['transfer-encoding'];
            delete headers['content-encoding'];
            res.writeHead(redirectRes.statusCode, headers);
            redirectRes.pipe(res);
          });
          redirectReq.on('error', () => {
            res.writeHead(502, { 'Content-Type': 'text/plain', ...corsHeaders });
            res.end('Redirect failed');
          });
          redirectReq.end();
          return;
        }
      }

      const headers = { ...proxyRes.headers, ...corsHeaders };
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      delete headers['content-encoding'];

      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain', ...corsHeaders });
      res.end('Fetch failed: ' + err.message);
    });

    proxyReq.end();
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain', ...corsHeaders });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`中继服务器已启动，端口: ${PORT}`);
  console.log(`使用方法: http://localhost:${PORT}/fetch?url=<目标网址>`);
  if (AUTH_TOKEN) {
    console.log(`已启用鉴权，令牌: ${AUTH_TOKEN}`);
  }
});
