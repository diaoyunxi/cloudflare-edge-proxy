/**
 * Relay Server — 中继服务器
 *
 * 部署在 VPS 上，为 Cloudflare Worker 提供中继服务。
 * 当 GitHub、Google 等网站封锁 Cloudflare Worker IP 时，
 * Worker 可通过此服务器中继获取内容。
 *
 * 部署方法：
 *   npm install express
 *   node relay-server.js
 *
 * 然后在 Cloudflare Worker 的环境变量中设置：
 *   RELAY_URL = http://your-vps-ip:3000/fetch?url=
 */

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Original-URL',
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

    const lib = target.protocol === 'https:' ? https : http;

    const options = {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
        'Referer': target.origin + '/',
      },
    };

    const proxyReq = lib.request(options, (proxyRes) => {
      // 如果是重定向，跟随重定向
      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        const redirectUrl = new URL(proxyRes.headers.location, targetUrl).href;
        // 递归跟随重定向（最多 5 次）
        const redirectCount = parseInt(parsedUrl.query._redirect || '0');
        if (redirectCount < 5) {
          const redirectPath = `/fetch?url=${encodeURIComponent(redirectUrl)}&_redirect=${redirectCount + 1}`;
          const redirectReq = http.request({
            hostname: 'localhost',
            port: PORT,
            path: redirectPath,
            method: 'GET',
          }, (redirectRes) => {
            const headers = { ...redirectRes.headers, ...corsHeaders };
            delete headers['content-length'];
            delete headers['transfer-encoding'];
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
  console.log(`Relay server running on port ${PORT}`);
  console.log(`Usage: http://localhost:${PORT}/fetch?url=<target_url>`);
});
