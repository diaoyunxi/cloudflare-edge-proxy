/**
 * Cloudflare Worker — Edge Proxy
 *
 * 通过 Cloudflare 边缘节点实现反向代理，
 * 可在 iframe 中嵌入被 X-Frame-Options / CSP 限制的网站（如 GitHub）。
 *
 * 部署方法：
 *   1. 登录 Cloudflare Dashboard → Workers & Pages
 *   2. 创建新 Worker
 *   3. 粘贴此代码 → 保存并部署
 *   或使用 Wrangler: npx wrangler deploy
 */

// ==================== 主页面 ====================

const MAIN_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edge Proxy · 边缘代理</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f1a;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.bar{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#1a1a2e;box-shadow:0 2px 12px rgba(0,0,0,.3);z-index:10}
.brand{color:#e94560;font-weight:700;font-size:18px;white-space:nowrap;letter-spacing:-.5px}
.brand span{color:#0f3460}
.search{flex:1;display:flex;background:#16213e;border-radius:8px;overflow:hidden;border:1px solid #1a1a3e;transition:border-color .2s}
.search:focus-within{border-color:#e94560}
.search input{flex:1;background:none;border:none;outline:none;color:#eee;padding:10px 16px;font-size:14px}
.search input::placeholder{color:#555}
.search button{background:#e94560;color:#fff;border:none;padding:0 20px;font-size:14px;font-weight:600;cursor:pointer;transition:background .2s}
.search button:hover{background:#c73e54}
.home{background:none;border:1px solid #333;color:#888;width:36px;height:36px;border-radius:8px;cursor:pointer;font-size:16px;transition:all .2s}
.home:hover{border-color:#e94560;color:#e94560}
.frame-wrap{flex:1;position:relative;background:#fff}
iframe{width:100%;height:100%;border:none}
.loading{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#0f0f1a;color:#666;font-size:15px}
.loading.show{display:flex}
.loading .spin{width:28px;height:28px;border:3px solid #333;border-top-color:#e94560;border-radius:50%;animation:sp .6s linear infinite;margin-right:12px}
@keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="bar">
  <div class="brand">&#9889;<span>Edge</span>Proxy</div>
  <div class="search">
    <input id="u" placeholder="输入网址，如 github.com" autocomplete="off" spellcheck="false">
    <button id="g">前往</button>
  </div>
  <button class="home" id="h" title="首页">&#8962;</button>
</div>
<div class="frame-wrap">
  <div class="loading" id="ld"><div class="spin"></div>加载中…</div>
  <iframe id="f" referrerpolicy="no-referrer" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"></iframe>
</div>
<script>
const I=document.getElementById('u'),G=document.getElementById('g'),F=document.getElementById('f'),L=document.getElementById('ld'),H=document.getElementById('h');
function norm(s){s=s.trim();if(!s)return null;if(!/^https?:\\/\\//i.test(s))s='https://'+s;try{return new URL(s).href}catch{return null}}
function enc(u){return btoa(u).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')}
function go(){const u=norm(I.value);if(!u)return;L.classList.add('show');F.src='/proxy/'+enc(u)}
G.onclick=go;
I.onkeydown=function(e){if(e.key==='Enter')go()};
F.onload=function(){L.classList.remove('show')};
H.onclick=function(){location.href='/'};
const p=new URLSearchParams(location.search);
if(p.get('url')){I.value=p.get('url');go()}
</script>
</body>
</html>`;

// ==================== 工具函数 ====================

/** URL 安全的 Base64 编码 */
function encodeUrl(url) {
  return btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL 安全的 Base64 解码 */
function decodeUrl(encoded) {
  let str = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

/** 解析相对 URL 为绝对 URL */
function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return null;
  }
}

// ==================== 内容重写 ====================

/**
 * 重写 HTML 中的所有 URL，使其通过代理
 * @param {string} html - 原始 HTML
 * @param {string} baseUrl - 基础 URL（用于解析相对路径）
 * @returns {string} 重写后的 HTML
 */
function rewriteHtml(html, baseUrl) {
  // 移除已有的 <base> 标签（我们自行处理 URL）
  html = html.replace(/<base\s[^>]*>/gi, '');

  // 更新 <meta charset> 为 UTF-8（因为我们以 UTF-8 返回）
  html = html.replace(/<meta\s+charset=["']?[^"'>\s]*/gi, '<meta charset="UTF-8"');
  html = html.replace(
    /(<meta\s+http-equiv=["']Content-Type["']\s+content=["']text\/html;\s*charset=)[^"']*/gi,
    '$1UTF-8'
  );

  // 移除 preconnect / dns-prefetch 链接（直接连接原始域名无意义）
  html = html.replace(/<link\s+[^>]*rel=["'](preconnect|dns-prefetch)["'][^>]*>/gi, '');

  // 移除 integrity 和 crossorigin 属性（代理后内容可能被修改，校验会失败）
  html = html.replace(/\s+integrity\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\s+crossorigin\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\s+crossorigin(?=[\s>])/gi, '');

  // 重写 src / href / action / poster 属性中的 URL
  html = html.replace(
    /((?:src|href|action|poster)\s*=\s*["'])([^"']*)(["'])/gi,
    (match, prefix, url, suffix) => {
      if (!url || /^(data:|javascript:|blob:|#|mailto:|tel:)/i.test(url)) return match;
      const resolved = resolveUrl(baseUrl, url);
      if (resolved) return prefix + '/proxy/' + encodeUrl(resolved) + suffix;
      return match;
    }
  );

  // 重写 srcset 属性
  html = html.replace(
    /(srcset\s*=\s*["'])([^"']*)(["'])/gi,
    (match, prefix, srcset, suffix) => {
      const newSrcset = srcset.split(',').map(part => {
        const trimmed = part.trim();
        const [url, ...descriptor] = trimmed.split(/\s+/);
        if (!url || /^(data:|blob:)/i.test(url)) return part;
        const resolved = resolveUrl(baseUrl, url);
        if (resolved) return '/proxy/' + encodeUrl(resolved) + (descriptor.length ? ' ' + descriptor.join(' ') : '');
        return part;
      }).join(', ');
      return prefix + newSrcset + suffix;
    }
  );

  // 重写 meta refresh 跳转
  html = html.replace(
    /(<meta\s+http-equiv=["']refresh["']\s+content=["'][^;]*;\s*url=)([^"']*)(["'])/gi,
    (match, prefix, url, suffix) => {
      const resolved = resolveUrl(baseUrl, url.trim());
      if (resolved) return prefix + '/proxy/' + encodeUrl(resolved) + suffix;
      return match;
    }
  );

  // 重写 CSS url() 引用（包括 <style> 标签和 inline style）
  html = html.replace(
    /url\(["']?([^"')]+)["']?\)/gi,
    (match, url) => {
      if (!url || /^(data:|blob:)/i.test(url)) return match;
      const resolved = resolveUrl(baseUrl, url);
      if (resolved) return 'url(/proxy/' + encodeUrl(resolved) + ')';
      return match;
    }
  );

  // 注入客户端脚本，处理动态请求
  const injectScript = getInjectedScript(baseUrl);
  if (html.includes('</body>')) {
    html = html.replace('</body>', injectScript + '\n</body>');
  } else if (html.includes('</html>')) {
    html = html.replace('</html>', injectScript + '\n</html>');
  } else {
    html += injectScript;
  }

  return html;
}

/**
 * 重写 CSS 中的 url() 引用
 */
function rewriteCss(css, baseUrl) {
  return css.replace(
    /url\(["']?([^"')]+)["']?\)/gi,
    (match, url) => {
      if (!url || /^(data:|blob:)/i.test(url)) return match;
      const resolved = resolveUrl(baseUrl, url);
      if (resolved) return 'url(/proxy/' + encodeUrl(resolved) + ')';
      return match;
    }
  );
}

/**
 * 生成注入到代理页面的客户端脚本
 * 拦截 fetch / XHR / window.open / 链接点击 / history 等
 */
function getInjectedScript(baseUrl) {
  return `<script>
(function(){
  var BASE_URL = ${JSON.stringify(baseUrl)};
  var PROXY = '/proxy/';

  function enc(u){return btoa(u).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
  function resolve(u){
    try{return new URL(u,BASE_URL).href;}catch(e){return null;}
  }
  function proxy(u){
    var r=resolve(u);
    return r?PROXY+enc(r):u;
  }

  // ---- 拦截 fetch ----
  var origFetch=window.fetch;
  window.fetch=function(input,init){
    try{
      if(typeof input==='string'){input=proxy(input);}
      else if(input instanceof Request){
        var u=proxy(input.url);
        if(u!==input.url){input=new Request(u,input);}
      }
    }catch(e){}
    return origFetch.call(this,input,init);
  };

  // ---- 拦截 XMLHttpRequest ----
  var origOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    try{arguments[1]=proxy(url);}catch(e){}
    return origOpen.apply(this,arguments);
  };

  // ---- 拦截 window.open ----
  var origOpen2=window.open;
  window.open=function(){
    try{if(arguments[0]){arguments[0]=proxy(arguments[0]);}}catch(e){}
    return origOpen2.apply(this,arguments);
  };

  // ---- 拦截 history.pushState / replaceState ----
  var origPush=history.pushState;
  history.pushState=function(state,title,url){
    if(url){try{arguments[2]=proxy(url);}catch(e){}}
    return origPush.apply(this,arguments);
  };
  var origReplace=history.replaceState;
  history.replaceState=function(state,title,url){
    if(url){try{arguments[2]=proxy(url);}catch(e){}}
    return origReplace.apply(this,arguments);
  };

  // ---- 链接点击处理 ----
  document.addEventListener('click',function(e){
    var link=e.target.closest&&e.target.closest('a[href]');
    if(link){
      var href=link.getAttribute('href');
      if(href&&!/^(#|javascript:|data:|mailto:|tel:)/i.test(href)){
        try{link.href=proxy(href);}catch(err){}
      }
    }
  },true);

  // ---- MutationObserver: 动态元素 URL 重写 ----
  function rewriteEl(el){
    var attrs=['src','href','action','poster'];
    for(var i=0;i<attrs.length;i++){
      if(el.hasAttribute&&el.hasAttribute(attrs[i])){
        var v=el.getAttribute(attrs[i]);
        if(v&&!/^(\\/proxy\\/|data:|javascript:|blob:|#|mailto:|tel:)/i.test(v)){
          try{
            var r=resolve(v);
            if(r){el.setAttribute(attrs[i],PROXY+enc(r));}
          }catch(e){}
        }
      }
    }
    // 处理 srcset
    if(el.hasAttribute&&el.hasAttribute('srcset')){
      var ss=el.getAttribute('srcset');
      var parts=ss.split(',').map(function(p){
        var t=p.trim().split(/\\s+/);
        var u=t[0];
        if(u&&!/^(data:|blob:)/i.test(u)){
          var r=resolve(u);
          if(r){t[0]=PROXY+enc(r);}
        }
        return t.join(' ');
      });
      el.setAttribute('srcset',parts.join(', '));
    }
  }

  var observer=new MutationObserver(function(mutations){
    for(var i=0;i<mutations.length;i++){
      var added=mutations[i].addedNodes;
      for(var j=0;j<added.length;j++){
        var node=added[j];
        if(node.nodeType===1){
          rewriteEl(node);
          if(node.querySelectorAll){
            node.querySelectorAll('[src],[href],[action],[poster],[srcset]').forEach(rewriteEl);
          }
        }
      }
    }
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});

})();
</script>`;
}

// ==================== 响应头处理 ====================

/**
 * 清理响应头，移除阻止嵌入的头部
 */
function cleanHeaders(headers) {
  const h = new Headers(headers);

  // 移除阻止 iframe 嵌入的头
  h.delete('X-Frame-Options');
  h.delete('Content-Security-Policy');
  h.delete('Content-Security-Policy-Report-Only');
  h.delete('Content-Security');

  // 移除可能引起问题的头
  h.delete('Transfer-Encoding');
  h.delete('Content-Encoding');
  h.delete('Content-Length');

  // 移除 cookie（避免在代理域上设置）
  h.delete('Set-Cookie');
  h.delete('Set-Cookie2');

  // 移除预连接/预加载链接
  h.delete('Link');

  // 移除 HSTS（避免影响代理域）
  h.delete('Strict-Transport-Security');

  return h;
}

// ==================== 代理请求 ====================

/**
 * 代理请求处理
 * @param {string} targetUrl - 目标 URL
 * @param {Request} request - 原始请求
 * @returns {Promise<Response>}
 */
async function proxyRequest(targetUrl, request) {
  try {
    // 验证 URL
    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response('Invalid URL: ' + targetUrl, { status: 400 });
    }

    // 只允许 http/https 协议
    if (!['http:', 'https:'].includes(target.protocol)) {
      return new Response('Unsupported protocol', { status: 403 });
    }

    // 构造请求头
    const reqHeaders = new Headers();
    const forwardHeaders = [
      'Accept',
      'Accept-Language',
      'Content-Type',
      'Content-Disposition',
    ];
    for (const name of forwardHeaders) {
      const val = request.headers.get(name);
      if (val) reqHeaders.set(name, val);
    }
    reqHeaders.set('User-Agent',
      request.headers.get('User-Agent') ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    reqHeaders.set('Referer', target.origin + '/');

    // 发起请求
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: reqHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });

    // 使用最终 URL（跟随重定向后）作为基准
    const finalUrl = response.url || targetUrl;
    const contentType = response.headers.get('Content-Type') || '';
    const newHeaders = cleanHeaders(response.headers);

    // ---- HTML ----
    if (contentType.includes('text/html')) {
      let html = await response.text();
      html = rewriteHtml(html, finalUrl);
      newHeaders.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // ---- CSS ----
    if (contentType.includes('text/css')) {
      let css = await response.text();
      css = rewriteCss(css, finalUrl);
      newHeaders.set('Content-Type', 'text/css; charset=utf-8');
      return new Response(css, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // ---- JavaScript ----
    if (contentType.includes('javascript')) {
      const js = await response.text();
      newHeaders.set('Content-Type', 'application/javascript; charset=utf-8');
      return new Response(js, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // ---- JSON ----
    if (contentType.includes('json')) {
      const json = await response.text();
      newHeaders.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(json, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // ---- 其他内容（图片/视频/字体等）：直接透传 ----
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });

  } catch (error) {
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>` +
      `<body style="font-family:sans-serif;padding:40px;text-align:center">` +
      `<h2 style="color:#e94560">代理请求失败</h2>` +
      `<p>目标: ${targetUrl}</p>` +
      `<p style="color:#999">${error.message}</p>` +
      `<a href="/" style="color:#e94560">返回首页</a></body></html>`,
      {
        status: 502,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}

// ==================== 主入口 ====================

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 首页
    if (pathname === '/' || pathname === '') {
      return new Response(MAIN_PAGE, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // favicon
    if (pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    // robots.txt
    if (pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // 健康检查
    if (pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // 代理请求
    if (pathname.startsWith('/proxy/')) {
      const encoded = pathname.substring('/proxy/'.length);
      if (!encoded) {
        return new Response('Missing target URL', { status: 400 });
      }

      let targetUrl;
      try {
        targetUrl = decodeUrl(encoded);
      } catch {
        return new Response('Invalid URL encoding', { status: 400 });
      }

      // 追加 query string（如果有额外参数）
      if (url.search) {
        try {
          const targetObj = new URL(targetUrl);
          const params = new URLSearchParams(url.search);
          params.forEach((value, key) => {
            targetObj.searchParams.append(key, value);
          });
          targetUrl = targetObj.href;
        } catch {
          // ignore
        }
      }

      return proxyRequest(targetUrl, request);
    }

    // 404
    return new Response('Not Found', { status: 404 });
  },
};
