/**
 * Cloudflare Worker — Edge Proxy
 *
 * 通过 Cloudflare 边缘节点实现反向代理，
 * 可在 iframe 中嵌入被 X-Frame-Options / CSP 限制的网站。
 *
 * 部署方法：
 *   1. 登录 Cloudflare Dashboard → Workers & Pages
 *   2. 创建新 Worker
 *   3. 粘贴此代码 → 保存并部署
 *   4. 在 Settings → Variables 中配置环境变量
 *   或使用 Wrangler: npx wrangler deploy
 *
 * 环境变量：
 *   RELAY_URL        - 中继服务器地址（可选，当直连失败时回退使用）
 *   CF_API_TOKEN     - Cloudflare API 令牌（用于自动更新）
 *   CF_ACCOUNT_ID    - Cloudflare 账户 ID（用于自动更新）
 *   CF_SCRIPT_NAME   - Worker 脚本名称（用于自动更新）
 */

// ==================== 版本与配置 ====================

const CURRENT_VERSION = 'v1.5.0';
const GITHUB_REPO = 'diaoyunxi/cloudflare-edge-proxy';

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
.brand{display:flex;align-items:center;gap:8px;white-space:nowrap}
.brand-name{color:#e94560;font-weight:700;font-size:18px;letter-spacing:-.5px}
.brand-name span{color:#0f3460}
.brand-ver{color:#555;font-size:11px;font-weight:400}
.brand-star{display:flex;align-items:center;gap:4px;text-decoration:none;color:#888;font-size:12px;transition:color .2s}
.brand-star:hover{color:#e94560}
.brand-star svg{width:14px;height:14px;fill:currentColor}
.search{flex:1;display:flex;background:#16213e;border-radius:8px;overflow:hidden;border:1px solid #1a1a3e;transition:border-color .2s;margin-left:8px}
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
  <div class="brand">
    <span class="brand-name">Edge<span>Proxy</span></span>
    <span class="brand-ver">${CURRENT_VERSION}</span>
    <a class="brand-star" href="https://github.com/diaoyunxi/cloudflare-edge-proxy" target="_blank" title="GitHub 项目地址">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 .25a8 8 0 00-2.53 15.59c.4.07.55-.17.55-.38v-1.34c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.22.83 1.22.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.96 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.13 0 0 .67-.22 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.11.16 1.93.08 2.13.52.56.82 1.28.82 2.15 0 3.08-1.87 3.76-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 008 .25z"/></svg>
      喜欢就给个 star 吧！
    </a>
  </div>
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

/** 检测是否为 Cloudflare 5xx 边缘错误（525 SSL握手失败等） */
function isCloudflareEdgeError(status) {
  return status >= 520 && status <= 526;
}

// ==================== 内容重写 ====================

/**
 * 重写 HTML 中的所有 URL，使其通过代理
 */
function rewriteHtml(html, baseUrl) {
  html = html.replace(/<base\s[^>]*>/gi, '');
  html = html.replace(/<meta\s+charset=["']?[^"'>\s]*/gi, '<meta charset="UTF-8"');
  html = html.replace(
    /(<meta\s+http-equiv=["']Content-Type["']\s+content=["']text\/html;\s*charset=)[^"']*/gi,
    '$1UTF-8'
  );
  html = html.replace(/<link\s+[^>]*rel=["'](preconnect|dns-prefetch)["'][^>]*>/gi, '');
  html = html.replace(/\s+integrity\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\s+crossorigin\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\s+crossorigin(?=[\s>])/gi, '');

  html = html.replace(
    /((?:src|href|action|poster)\s*=\s*["'])([^"']*)(["'])/gi,
    (match, prefix, url, suffix) => {
      if (!url || /^(data:|javascript:|blob:|#|mailto:|tel:)/i.test(url)) return match;
      // 跳过已经是本代理路径的 URL，避免嵌套编码
      if (url.startsWith('/proxy/') || url.startsWith('//proxy/')) return match;
      const resolved = resolveUrl(baseUrl, url);
      if (resolved) return prefix + '/proxy/' + encodeUrl(resolved) + suffix;
      return match;
    }
  );

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

  html = html.replace(
    /(<meta\s+http-equiv=["']refresh["']\s+content=["'][^;]*;\s*url=)([^"']*)(["'])/gi,
    (match, prefix, url, suffix) => {
      const resolved = resolveUrl(baseUrl, url.trim());
      if (resolved) return prefix + '/proxy/' + encodeUrl(resolved) + suffix;
      return match;
    }
  );

  html = html.replace(
    /url\(["']?([^"')]+)["']?\)/gi,
    (match, url) => {
      if (!url || /^(data:|blob:)/i.test(url)) return match;
      if (url.startsWith('/proxy/') || url.startsWith('//proxy/')) return match;
      const resolved = resolveUrl(baseUrl, url);
      if (resolved) return 'url(/proxy/' + encodeUrl(resolved) + ')';
      return match;
    }
  );

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

/** 重写 CSS 中的 url() 引用 */
function rewriteCss(css, baseUrl) {
  return css.replace(
    /url\(["']?([^"')]+)["']?\)/gi,
    (match, url) => {
      if (!url || /^(data:|blob:)/i.test(url)) return match;
      if (url.startsWith('/proxy/') || url.startsWith('//proxy/')) return match;
      const resolved = resolveUrl(baseUrl, url);
      if (resolved) return 'url(/proxy/' + encodeUrl(resolved) + ')';
      return match;
    }
  );
}

/** 生成注入到代理页面的客户端脚本 */
function getInjectedScript(baseUrl) {
  return `<script>
(function(){
  var BASE_URL = ${JSON.stringify(baseUrl)};
  var PROXY = '/proxy/';

  function enc(u){return btoa(u).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
  function dec(u){var s=u.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';try{return atob(s);}catch(e){return null;}}
  function resolve(u){
    try{return new URL(u,BASE_URL).href;}catch(e){return null;}
  }
  function proxy(u){
    if(!u)return u;
    // 已经是本代理路径，不再二次编码
    if(u.indexOf('/proxy/')===0||u.indexOf('//proxy/')===0)return u;
    // 已经是绝对 URL 且包含本代理域名
    if(u.indexOf(location.origin+'/proxy/')===0)return u;
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

  // ---- 拦截 location 赋值（OAuth 登录重定向关键） ----
  // 当 Google JS 执行 window.location.href = 'https://accounts.google.com/...'
  // 时，需要将其转换为代理 URL
  function patchLocation(obj,name){
    var orig=Object.getOwnPropertyDescriptor(obj,name);
    if(orig&&orig.set){
      Object.defineProperty(obj,name,{
        set:function(v){orig.set.call(this,proxy(v));},
        get:orig.get,
        configurable:true
      });
    }
  }
  // 拦截 location.href / location.assign / location.replace
  try{
    var origAssign=window.location.assign;
    window.location.assign=function(u){return origAssign.call(this,proxy(u));};
    var origReplace=window.location.replace;
    window.location.replace=function(u){return origReplace.call(this,proxy(u));};
  }catch(e){}

  // ---- 拦截表单提交 ----
  document.addEventListener('submit',function(e){
    var form=e.target;
    if(form&&form.tagName==='FORM'&&form.action){
      try{
        var action=form.getAttribute('action')||'';
        if(action&&!/^(#|javascript:)/i.test(action)){
          var resolved=resolve(action);
          if(resolved){
            form.action=PROXY+enc(resolved);
          }
        }
      }catch(err){}
    }
  },true);

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
        if(v&&!/^(\\/proxy\\/|\\/\\/proxy\\/|data:|javascript:|blob:|#|mailto:|tel:)/i.test(v)){
          try{
            var r=resolve(v);
            if(r){el.setAttribute(attrs[i],PROXY+enc(r));}
          }catch(e){}
        }
      }
    }
    if(el.hasAttribute&&el.hasAttribute('srcset')){
      var ss=el.getAttribute('srcset');
      var parts=ss.split(',').map(function(p){
        var t=p.trim().split(/\\s+/);
        var u=t[0];
        if(u&&!/^(data:|blob:)/i.test(u)&&u.indexOf('/proxy/')!==0){
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

function cleanHeaders(headers) {
  const h = new Headers(headers);
  h.delete('X-Frame-Options');
  h.delete('Content-Security-Policy');
  h.delete('Content-Security-Policy-Report-Only');
  h.delete('Content-Security');
  h.delete('Transfer-Encoding');
  h.delete('Content-Encoding');
  h.delete('Content-Length');
  h.delete('Set-Cookie');
  h.delete('Set-Cookie2');
  h.delete('Link');
  h.delete('Strict-Transport-Security');
  return h;
}

// ==================== 响应处理 ====================

/**
 * 处理 fetch 返回的响应：重写 URL、清理头部、注入脚本
 */
async function processResponse(response, finalUrl) {
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

  // ---- 其他内容：直接透传 ----
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// ==================== 错误页面 ====================

/**
 * 生成友好的错误页面（面向普通用户，不显示技术细节）
 */
function buildErrorResponse(targetUrl, statusCode, errorMsg, hasRelay) {
  const isEdgeError = isCloudflareEdgeError(statusCode);

  let title = '页面加载失败';
  let desc = '';

  if (isEdgeError) {
    title = '暂时无法访问该网站';
    desc = '目标网站暂时无法连接，可能是网络波动或该网站限制了代理访问。请稍后重试。';
  } else if (statusCode === 0) {
    title = '无法连接到目标网站';
    desc = '网络连接出现问题，请检查网址是否正确后重试。';
  } else if (statusCode === 404) {
    title = '页面不存在';
    desc = '找不到这个页面，可能已被删除或网址有误。';
  } else if (statusCode === 403) {
    title = '访问被拒绝';
    desc = '该网站拒绝了访问请求。';
  } else if (statusCode >= 500) {
    title = '目标网站出错';
    desc = '目标网站服务器出现了问题，请稍后重试。';
  } else {
    desc = '请求出现问题，请稍后重试。';
  }

  return new Response(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>` +
    `body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f0f1a;color:#eee;padding:60px 20px;text-align:center}` +
    `.card{max-width:480px;margin:0 auto;background:#1a1a2e;border-radius:12px;padding:40px;box-shadow:0 4px 20px rgba(0,0,0,.3)}` +
    `h2{color:#e94560;margin-bottom:16px}` +
    `.target{color:#888;background:#0f0f1a;padding:8px 16px;border-radius:6px;display:inline-block;margin:12px 0;word-break:break-all;font-size:13px}` +
    `.desc{color:#aaa;margin:12px 0;line-height:1.6}` +
    `a{color:#e94560;text-decoration:none}a:hover{text-decoration:underline}` +
    `.icon{font-size:48px;margin-bottom:8px}` +
    `.retry{display:inline-block;margin-top:20px;padding:10px 28px;background:#e94560;color:#fff;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:background .2s}` +
    `.retry:hover{background:#c73e54}` +
    `</style></head><body>` +
    `<div class="card">` +
    `<div class="icon">&#128533;</div>` +
    `<h2>${title}</h2>` +
    `<div class="target">${targetUrl}</div>` +
    `<p class="desc">${desc}</p>` +
    `<button class="retry" onclick="location.reload()">&#8635; 重试</button>` +
    `<p style="margin-top:16px"><a href="/">返回首页</a></p>` +
    `</div></body></html>`,
    {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

/**
 * 生成验证页面提示（面向普通用户，不显示技术细节）
 */
function buildCaptchaResponse(targetUrl, hasRelay) {
  return new Response(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>` +
    `body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f0f1a;color:#eee;padding:60px 20px;text-align:center}` +
    `.card{max-width:480px;margin:0 auto;background:#1a1a2e;border-radius:12px;padding:40px;box-shadow:0 4px 20px rgba(0,0,0,.3)}` +
    `h2{color:#e94560;margin-bottom:16px}` +
    `.target{color:#888;background:#0f0f1a;padding:8px 16px;border-radius:6px;display:inline-block;margin:12px 0;word-break:break-all;font-size:13px}` +
    `.desc{color:#aaa;margin:12px 0;line-height:1.6}` +
    `a{color:#e94560;text-decoration:none}a:hover{text-decoration:underline}` +
    `.icon{font-size:48px;margin-bottom:8px}` +
    `.retry{display:inline-block;margin-top:20px;padding:10px 28px;background:#e94560;color:#fff;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:background .2s}` +
    `.retry:hover{background:#c73e54}` +
    `</style></head><body>` +
    `<div class="card">` +
    `<div class="icon">&#9888;&#65039;</div>` +
    `<h2>该网站需要验证</h2>` +
    `<div class="target">${targetUrl}</div>` +
    `<p class="desc">目标网站要求进行人机验证，暂时无法通过代理加载。<br>请稍后重试，或直接访问该网站。</p>` +
    `<button class="retry" onclick="location.reload()">&#8635; 重试</button>` +
    `<p style="margin-top:16px"><a href="/">返回首页</a></p>` +
    `</div></body></html>`,
    {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

// ==================== 代理请求 ====================

/** 真实浏览器请求头模板 */
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

/**
 * 检测响应是否为反爬虫验证页面（Google 等）
 */
function isCaptchaPage(contentType, body) {
  if (!contentType.includes('text/html')) return false;
  // Google 异常流量验证页面的特征
  const signals = [
    '我们的系统检测到您的计算机网络中存在异常流量',
    'unusual traffic from your computer network',
    'detected unusual traffic',
    'captcha',
    'g-recaptcha',
    'sorry/index',
    '/sorry/',
  ];
  const lower = body.toLowerCase();
  return signals.some(s => lower.includes(s.toLowerCase()));
}

/**
 * 直接通过 Cloudflare 边缘节点获取目标内容
 */
async function directFetch(targetUrl, request) {
  const target = new URL(targetUrl);

  const reqHeaders = new Headers();

  // 使用真实浏览器头作为基础
  for (const [key, val] of Object.entries(BROWSER_HEADERS)) {
    reqHeaders.set(key, val);
  }

  // 如果客户端发送了 Accept-Language，优先使用
  const clientLang = request.headers.get('Accept-Language');
  if (clientLang) reqHeaders.set('Accept-Language', clientLang);

  // 传递 Content-Type（POST 等请求需要）
  const contentType = request.headers.get('Content-Type');
  if (contentType && !['GET', 'HEAD'].includes(request.method)) {
    reqHeaders.set('Content-Type', contentType);
  }

  // 设置 Referer 为目标站点自身
  reqHeaders.set('Referer', target.origin + '/');

  return await fetch(targetUrl, {
    method: request.method,
    headers: reqHeaders,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'follow',
  });
}

/**
 * 通过中继服务器获取目标内容
 * 中继服务器需要支持: GET https://your-relay/fetch?url=<encoded_url>
 * 返回原始响应体和 Content-Type 头
 */
async function relayFetch(targetUrl, request, relayUrl) {
  const relayTarget = relayUrl + encodeURIComponent(targetUrl);

  const response = await fetch(relayTarget, {
    method: 'GET',
    headers: {
      'Accept': '*/*',
      'X-Original-URL': targetUrl,
    },
    redirect: 'follow',
  });

  return response;
}

/**
 * 代理请求主处理函数
 * @param {string} targetUrl - 目标 URL
 * @param {Request} request - 原始请求
 * @param {Object} env - 环境变量
 * @returns {Promise<Response>}
 */
async function proxyRequest(targetUrl, request, env) {
  const relayUrl = env?.RELAY_URL || '';

  // 验证 URL
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return new Response('Invalid URL: ' + targetUrl, { status: 400 });
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return new Response('Unsupported protocol', { status: 403 });
  }

  // ---- 第一步：尝试直接获取 ----
  let directResponse = null;
  let directError = null;

  try {
    directResponse = await directFetch(targetUrl, request);
  } catch (err) {
    directError = err;
  }

  // 如果直接获取成功且不是边缘错误
  if (directResponse && !isCloudflareEdgeError(directResponse.status)) {
    const finalUrl = directResponse.url || targetUrl;
    const contentType = directResponse.headers.get('Content-Type') || '';

    // 检测是否为反爬虫验证页面（Google captcha 等）
    if (contentType.includes('text/html')) {
      try {
        const body = await directResponse.text();
        // 即使是验证页面，也直接返回给用户，让用户自己完成验证
        const newHeaders = cleanHeaders(directResponse.headers);
        newHeaders.set('Content-Type', 'text/html; charset=utf-8');
        const rewritten = rewriteHtml(body, finalUrl);
        return new Response(rewritten, {
          status: directResponse.status,
          headers: newHeaders,
        });
      } catch (err) {
        return buildErrorResponse(targetUrl, 0, err.message, !!relayUrl);
      }
    }

    // 非 HTML 内容，直接处理
    try {
      return await processResponse(directResponse, finalUrl);
    } catch (err) {
      return buildErrorResponse(targetUrl, 0, err.message, !!relayUrl);
    }
  }

  // ---- 第二步：直接获取失败（525/521/522 等），尝试中继 ----
  const errorCode = directResponse ? directResponse.status : 0;
  const errorMsg = directError ? directError.message : '';

  if (relayUrl) {
    try {
      const relayResponse = await relayFetch(targetUrl, request, relayUrl);
      if (relayResponse.ok || (relayResponse.status < 520 && relayResponse.status !== 0)) {
        const finalUrl = targetUrl;
        return await processResponse(relayResponse, finalUrl);
      }
    } catch (err) {
      // 中继也失败了
    }
  }

  // ---- 所有方法都失败，返回错误页面 ----
  return buildErrorResponse(targetUrl, errorCode, errorMsg, !!relayUrl);
}

// ==================== 自动更新 ====================

/**
 * 比较版本号（如 v1.5.0 vs v1.6.0）
 * 返回: 1 表示 a 更新, -1 表示 b 更新, 0 表示相同
 */
function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/**
 * 检查并执行自动更新（每天最多一次）
 * 通过 Cache API 缓存检查时间，避免频繁请求 GitHub API
 */
async function checkForUpdate(env) {
  // 检查是否配置了必要的环境变量
  if (!env?.CF_API_TOKEN || !env?.CF_ACCOUNT_ID || !env?.CF_SCRIPT_NAME) {
    return;
  }

  const cache = caches.default;
  const cacheKey = new Request('https://edge-proxy.internal/update-check');

  // 检查今天是否已检查过
  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const data = await cached.json();
      if (data.lastCheck) {
        const lastTime = new Date(data.lastCheck).getTime();
        const now = Date.now();
        if (now - lastTime < 24 * 60 * 60 * 1000) {
          return; // 24 小时内已检查过
        }
      }
    }
  } catch {
    // 缓存读取失败，继续检查
  }

  // 查询 GitHub API 获取最新 Release
  let release;
  try {
    const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'EdgeProxy-SelfUpdate' },
    });
    if (!resp.ok) return;
    release = await resp.json();
  } catch {
    return;
  }

  const latestVersion = release.tag_name;
  if (!latestVersion) return;

  // 比较版本号
  if (compareVersions(latestVersion, CURRENT_VERSION) <= 0) {
    // 当前已是最新版本，更新缓存
    await cache.put(cacheKey, new Response(JSON.stringify({
      lastCheck: new Date().toISOString(),
      latestVersion: latestVersion,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=86400',
      },
    }));
    return;
  }

  // 发现新版本，下载 worker.js
  // 优先从 release assets 下载
  let code = null;
  const asset = release.assets && release.assets.find(a => a.name === 'worker.js');
  if (asset && asset.browser_download_url) {
    try {
      const codeResp = await fetch(asset.browser_download_url, {
        headers: { 'User-Agent': 'EdgeProxy-SelfUpdate' },
        redirect: 'follow',
      });
      if (codeResp.ok) {
        code = await codeResp.text();
      }
    } catch {
      // GitHub 下载可能被封锁，尝试备用方案
    }
  }

  // 如果从 assets 下载失败，尝试从 raw.githubusercontent.com 下载
  if (!code) {
    try {
      const codeResp = await fetch(
        `https://raw.githubusercontent.com/${GITHUB_REPO}/main/worker.js`,
        { headers: { 'User-Agent': 'EdgeProxy-SelfUpdate' } }
      );
      if (codeResp.ok) {
        code = await codeResp.text();
      }
    } catch {
      return;
    }
  }

  if (!code) return;

  // 上传新代码到 Cloudflare Workers
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: '2024-01-01',
    bindings: [
      { name: 'CF_API_TOKEN', type: 'inherit' },
      { name: 'CF_ACCOUNT_ID', type: 'inherit' },
      { name: 'CF_SCRIPT_NAME', type: 'inherit' },
      { name: 'RELAY_URL', type: 'inherit' },
    ],
  };

  try {
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
    formData.append('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');

    const uploadResp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${env.CF_SCRIPT_NAME}`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` },
        body: formData,
      }
    );

    if (uploadResp.ok) {
      // 更新成功，刷新缓存
      await cache.put(cacheKey, new Response(JSON.stringify({
        lastCheck: new Date().toISOString(),
        latestVersion: latestVersion,
        updated: true,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=86400',
        },
      }));
    }
  } catch {
    // 上传失败，静默处理
  }
}

// ==================== 主入口 ====================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 首页
    if (pathname === '/' || pathname === '') {
      // 异步检查更新（不阻塞首页响应）
      ctx.waitUntil(checkForUpdate(env));
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
      // 检查更新缓存状态
      let updateInfo = { current: CURRENT_VERSION };
      try {
        const cached = await caches.default.match(new Request('https://edge-proxy.internal/update-check'));
        if (cached) {
          const data = await cached.json();
          updateInfo.lastCheck = data.lastCheck;
          updateInfo.latest = data.latestVersion;
          updateInfo.updated = data.updated || false;
        }
      } catch {}

      return new Response(JSON.stringify({
        status: 'OK',
        version: CURRENT_VERSION,
        update: updateInfo,
        timestamp: new Date().toISOString(),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
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

      // 追加 query string
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

      return proxyRequest(targetUrl, request, env);
    }

    // 404
    return new Response('Not Found', { status: 404 });
  },
};
