// ==UserScript==
// @name         Yandex Games Resizer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Hide Ads from Yandex Games
// @author       Fire Feline
// @match        https://yandex.ru/games/app/*
// @grant        none
// ==/UserScript==

(function() {
   'use strict';

   setTimeout(() => {
      const frames = document.getElementsByTagName('iframe');
      if (frames.length > 0) {
         const frame = frames[0];
         frame.style.cssText = 'position: fixed; width: 100%; height: 100%; z-index: 9999;';
      }
      const headers = document.getElementsByTagName('header');
      if (headers.length > 0) {
         const header = headers[0];
         header.style.opacity = '0';
      }
   }, 5000);

})();
