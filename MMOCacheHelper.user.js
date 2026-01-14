// ==UserScript==
// @name         MMO Unity ETag Fixer
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Intercepts Fetch and forces ETag/IndexedDB caching with real-time progress reporting
// @author       Fire Feline
// @match        *://mmo-open-world.ru/*
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://fire-feline2.github.io/mmo_addons/MMOCacheHelper.user.js
// @downloadURL  https://fire-feline2.github.io/mmo_addons/MMOCacheHelper.user.js
// ==/UserScript==

(function() {
   'use strict';

   const TARGET_URL = 'unityweb';
   const TARGET_PATTERN = 'assets';
   const DB_NAME = 'UnityCacheDB';
   const STORE_NAME = 'files';

   // --- DB HELPERS ---
   const openDB = () => new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
   });

   // --- RESET CACHE COMMAND ---
   const resetCache = async () => {
      if (!confirm("Are you sure you want to clear the Unity Cache?\nThis will force the game to re-download all assets on the next refresh.")) {
         return;
      }

      try {
         const db = await openDB();
         const transaction = db.transaction(STORE_NAME, 'readwrite');
         const store = transaction.objectStore(STORE_NAME);
         const request = store.clear();

         request.onsuccess = () => {
            console.log('%c[MMO Cache] IndexedDB Cleared Successfully', 'color: #ff0000; font-weight: bold;');
            alert('Unity Cache has been cleared! Refresh the page to re-download assets.');
         };
      } catch (err) {
         console.error('[MMO Cache] Failed to clear cache:', err);
      }
   };

   if (typeof GM_registerMenuCommand !== 'undefined') {
      GM_registerMenuCommand("🔄 Reset Unity Cache", resetCache);
      GM_registerMenuCommand("🔎 Show Cache List", () => showCacheList());
   }

   const getAllCache = async () => {
      const db = await openDB();
      return new Promise(res => {
         const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
         req.onsuccess = () => res(req.result);
         req.onerror = () => res([]);
      });
   };

   const showCacheList = async () => {
      const items = await getAllCache();
      items.sort((a, b) => {
         if (a.modified !== b.modified) return b.modified - a.modified;
         return new Date(b.modifyDate) - new Date(a.modifyDate);
      });

      const container = document.createElement('div');
      container.id = 'mmo-cache-list';
      container.style.cssText = `
         position: fixed; top: 10%; left: 50%; transform: translateX(-50%);
         width: 80%; max-height: 70%; background: #1a1a1a; color: #00ff00;
         border: 2px solid #00ff00; border-radius: 8px; z-index: 10001;
         padding: 20px; font-family: monospace; overflow-y: auto;
         box-shadow: 0 0 20px rgba(0,255,0,0.3);
      `;

      const header = `
         <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #00ff00; padding-bottom: 10px; margin-bottom: 10px;">
            <span style="font-weight: bold; font-size: 1.2em;">Cached Assets (${items.length})</span>
            <button id="close-cache-list" style="background: #ff0000; color: white; border: none; cursor: pointer; padding: 2px 10px;">X</button>
         </div>
      `;

      const tableRows = items.map(item => {
         const color = item.modified ? '#ffcc00' : '#bada55';
         return `
            <tr style="color: ${color}; border-bottom: 1px solid #333;">
               <td style="padding: 5px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.url}">${item.url.split('/').pop()}</td>
               <td style="padding: 5px;">${item.modified ? 'YES' : 'no'}</td>
               <td style="padding: 5px;">${item.modifyDate || 'N/A'}</td>
            </tr>
         `;
      }).join('');

      container.innerHTML = `${header}<table style="width: 100%; text-align: left; border-collapse: collapse;">
            <thead><tr style="border-bottom: 1px solid #00ff00;"><th>Asset</th><th>Mod</th><th>Server Date</th></tr></thead>
            <tbody>${tableRows}</tbody></table>`;

      document.body.appendChild(container);
      document.getElementById('close-cache-list').onclick = () => container.remove();
   };

   const getCache = async (url) => {
      const db = await openDB();
      return new Promise(res => {
         const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(url);
         req.onsuccess = () => res(req.result);
         req.onerror = () => res(null);
      });
   };

   const setCache = async (url, etag, blob, modified, modifyDate) => {
      const db = await openDB();
      const date = new Date().toISOString();
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ url, date, modified, modifyDate, etag, blob }, url);
   };

   // --- FETCH INTERCEPTOR ---
   const installFetchProxy = () => {
      const nativeFetch = unsafeWindow.fetch;
      unsafeWindow.fetch = async function(...args) {
         const url = (args[0] instanceof Request) ? args[0].url : args[0];

         if (url.includes(TARGET_URL) || url.includes(TARGET_PATTERN)) {
            console.log('%c[MMO Cache] Intercepted: ' + url, 'background: #222; color: #bada55');
            const cached = await getCache(url);

            const headers = new Headers(args[1]?.headers || {});
            if (cached?.etag) headers.set('If-None-Match', cached.etag);

            const response = await nativeFetch(url, { ...args[1], headers });

            if (response.status === 304 || (response.status === 200 && cached && response.headers.get('etag') === cached.etag)) {
               console.log('%c[MMO Cache] Hit! Serving from IndexedDB: ' + url, 'background: #222; color: #bada55');
               return new Response(cached.blob, { status: 200, headers: response.headers });
            }

            if (response.status === 200) {
               const etag = response.headers.get('etag');
               const modifyDate = response.headers.get('last-modified') || response.headers.get('date');
               const modifiedFlag = !!cached;

               const reader = response.body.getReader();
               const chunks = [];

               // Using a ReadableStream allows Unity to see progress while we catch the data
               const stream = new ReadableStream({
                  async start(controller) {
                     while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        chunks.push(value); // Collect for DB
                        controller.enqueue(value); // Send to Unity loading bar immediately
                     }

                     const freshBlob = new Blob(chunks);
                     console.log('%c[MMO Cache] Stored in DB: ' + url, 'background: #222; color: #bada55');
                     await setCache(url, etag, freshBlob, modifiedFlag, modifyDate);
                     controller.close();
                  }
               });

               return new Response(stream, { status: 200, headers: response.headers });
            }
         }
         return nativeFetch.apply(this, args);
      };
   };

   installFetchProxy();
   console.log('[Cache] Interceptors Hooked with Progress Support');

})();
