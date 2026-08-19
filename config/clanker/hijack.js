import Module from 'module';
import WebSocket from 'ws';
import signature from 'cookie-signature';
import fs from 'fs';
import path from 'path';

const CLANKER_USER_ID = process.env.CLANKER_USER_ID || '';
const SESSION_SECRET = process.env.OVERLEAF_SESSION_SECRET || '';
const CLANKER_SESSION_ID = 'clanker_session_key_1234';

const signedSessionCookie = 's:' + encodeURIComponent(signature.sign(CLANKER_SESSION_ID, SESSION_SECRET));
const cookieHeader = `overleaf.sid=${signedSessionCookie}`;

// Patch xmlhttprequest library on disk to bypass unsafe header check
const originalXhrPath = '/app/node_modules/xmlhttprequest/lib/XMLHttpRequest.js';
const patchedXhrPath = '/app/patched-xmlhttprequest.cjs';

try {
  let content = fs.readFileSync(originalXhrPath, 'utf8');
  // Allow all forbidden request headers (including Cookie)
  content = content.replace('forbiddenRequestHeaders.indexOf(header.toLowerCase()) === -1', 'true');
  fs.writeFileSync(patchedXhrPath, content);
  console.log('[Hijack] Successfully generated patched xmlhttprequest library');
} catch (e) {
  console.error('[Hijack] Failed to patch xmlhttprequest library:', e.message);
}

function WrappedWebSocket(address, protocols, options) {
  const opts = options || {};
  opts.headers = opts.headers || {};
  opts.headers.Cookie = cookieHeader;
  
  console.log(`[Hijack] WebSocket connecting to ${address} with Cookie: ${cookieHeader}`);
  return new WebSocket(address, protocols, opts);
}

WrappedWebSocket.prototype = WebSocket.prototype;

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'ws') {
    return WrappedWebSocket;
  }
  if (id === 'xmlhttprequest') {
    const patchedModule = originalRequire.call(this, patchedXhrPath);
    const OriginalXHR = patchedModule.XMLHttpRequest;
    
    function WrappedXMLHttpRequest() {
      const xhr = new OriginalXHR();
      
      const originalOpen = xhr.open;
      xhr.open = function(method, url, ...args) {
        xhr._url = url;
        return originalOpen.apply(xhr, [method, url, ...args]);
      };
      
      const originalSend = xhr.send;
      xhr.send = function(...args) {
        console.log(`[Hijack] XMLHttpRequest sending to ${xhr._url} with Cookie: ${cookieHeader}`);
        xhr.setRequestHeader('Cookie', cookieHeader);
        return originalSend.apply(xhr, args);
      };
      
      return xhr;
    }
    
    WrappedXMLHttpRequest.prototype = OriginalXHR.prototype;
    return { XMLHttpRequest: WrappedXMLHttpRequest };
  }
  return originalRequire.apply(this, arguments);
};

console.log('CommonJS require hijacked for WebSocket and XMLHttpRequest');
