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

// ==================== 配置常量 ====================

/** 默认监听端口 */
const DEFAULT_PORT = 3000;

/** 代理请求超时时间（毫秒） */
const PROXY_TIMEOUT_MS = 15000;

/** 最大重定向次数 */
const MAX_REDIRECTS = 5;

/** 307/308 状态码，重定向时需保持原始请求方法 */
const REDIRECT_PRESERVE_METHOD_CODES = [307, 308];

/** 所有重定向状态码 */
const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];

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

// ==================== 运行时配置 ====================

const PORT = process.env.PORT || DEFAULT_PORT;
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

// ==================== 工具函数 ====================

/**
 * 判断是否为需要保持请求方法的重定向状态码
 * @param {number} statusCode - HTTP 状态码
 * @returns {boolean}
 */
function shouldPreserveMethod(statusCode) {
  return REDIRECT_PRESERVE_METHOD_CODES.includes(statusCode);
}

// ==================== 主服务器 ====================

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS 头（支持 GET/HEAD/OPTIONS，与实际代理能力一致）
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Original-URL, X-Relay-Token, X-Original-Method',
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

    // 透传原始请求方法（由 Worker 通过 X-Original-Method 头传递）
    const originalMethod = req.headers['x-original-method'] || 'GET';
    const needsBody = !['GET', 'HEAD'].includes(originalMethod);

    // 构造完整的浏览器请求头
    const headers = { ...BROWSER_HEADERS };
    headers['Referer'] = target.origin + '/';
    headers['Host'] = target.host;

    // 非默认 GET 方法时，透传 Content-Type
    if (needsBody) {
      const reqContentType = req.headers['content-type'];
      if (reqContentType) {
        headers['Content-Type'] = reqContentType;
      }
    }

    // 缓冲请求体（需要 body 的方法先收集完整 body，防止重定向时流已消耗）
    let bodyBuffer = Buffer.alloc(0);
    if (needsBody) {
      bodyBuffer = await new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', () => resolve(Buffer.alloc(0)));
      });
    }

    const lib = target.protocol === 'https:' ? https : http;

    const options = {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: originalMethod,
      headers: headers,
    };

    const proxyReq = lib.request(options, (proxyRes) => {
      // 如果是重定向，跟随重定向
      if (REDIRECT_STATUS_CODES.includes(proxyRes.statusCode) && proxyRes.headers.location) {
        const redirectUrl = new URL(proxyRes.headers.location, targetUrl).href;
        const redirectCount = parseInt(parsedUrl.query._redirect || '0');

        if (redirectCount >= MAX_REDIRECTS) {
          // 【严重缺陷 3.6 修复】超过最大重定向次数，终止循环并返回 508
          res.writeHead(508, { 'Content-Type': 'text/plain', ...corsHeaders });
          res.end('Loop Detected');
          return;
        }

        // 消耗 proxyRes 响应体（重定向响应体通常为空，但仍需消费）
        proxyRes.resume();

        // 【锦上添花修复】307/308 重定向保持原始请求方法
        const redirectMethod = shouldPreserveMethod(proxyRes.statusCode) ? originalMethod : 'GET';

        let redirectPath = `/fetch?url=${encodeURIComponent(redirectUrl)}&_redirect=${redirectCount + 1}`;
        if (AUTH_TOKEN) redirectPath += `&token=${AUTH_TOKEN}`;
        // 透传原始方法给重定向请求
        if (redirectMethod !== 'GET') {
          redirectPath += `&_method=${redirectMethod}`;
        }
        const redirectReq = http.request({
          hostname: 'localhost',
          port: PORT,
          path: redirectPath,
          method: redirectMethod,
          headers: {
            'Content-Type': req.headers['content-type'] || 'application/octet-stream',
            'X-Original-Method': originalMethod,
          },
        }, (redirectRes) => {
          const respHeaders = { ...redirectRes.headers, ...corsHeaders };
          delete respHeaders['content-length'];
          delete respHeaders['transfer-encoding'];
          delete respHeaders['content-encoding'];
          res.writeHead(redirectRes.statusCode, respHeaders);
          redirectRes.pipe(res);
        });
        redirectReq.on('error', () => {
          res.writeHead(502, { 'Content-Type': 'text/plain', ...corsHeaders });
          res.end('Bad Gateway');
        });

        // 307/308 且有 body 时，从缓冲区写入
        if (shouldPreserveMethod(proxyRes.statusCode) && bodyBuffer.length > 0) {
          redirectReq.write(bodyBuffer);
        }
        redirectReq.end();
        return;
      }

      const respHeaders = { ...proxyRes.headers, ...corsHeaders };
      delete respHeaders['content-length'];
      delete respHeaders['transfer-encoding'];
      delete respHeaders['content-encoding'];

      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res);
    });

    // 【严重缺陷 3.4 修复】添加请求超时控制
    proxyReq.setTimeout(PROXY_TIMEOUT_MS, () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain', ...corsHeaders });
        res.end('Gateway Timeout');
      }
    });

    // 【严重缺陷 3.5 修复】错误信息脱敏，不暴露内部细节
    proxyReq.on('error', (err) => {
      console.error('Proxy fetch failed:', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain', ...corsHeaders });
        res.end('Bad Gateway');
      }
    });

    // 【严重缺陷 3.2 修复】非 GET/HEAD 时从缓冲区写入请求体
    if (needsBody && bodyBuffer.length > 0) {
      proxyReq.write(bodyBuffer);
    }
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
  // 【严重缺陷 3.1 修复】AUTH_TOKEN 脱敏，不打印明文
  if (AUTH_TOKEN) {
    console.log('已启用鉴权，令牌: ***');
  }
});