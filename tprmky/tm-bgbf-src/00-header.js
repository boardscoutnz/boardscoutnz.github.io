// ==UserScript==
// @name         Trade Me Board Games Bulk Fetcher (Collector)
// @namespace    https://github.com/yourname/tm-bgbf
// @version      0.7.12
// @description  Collect-only edition. Bulk-fetch live Card-game and selected Board-game listings from Trade Me, purge listings whose title matches the blacklist (accessory keywords now folded into the blacklist), tag expansions vs base games, flag freshly-seen listings, and AUTO-EXPORT a JSON file at the end of every run for the standalone web dashboard to consume.
// @author       you
// @match        https://www.trademe.co.nz/*
// @match        https://trademe.co.nz/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      trademe.co.nz
// @connect      www.trademe.co.nz
// @connect      api.trademe.co.nz
// @connect      self
// @noframes
// ==/UserScript==

/* eslint-disable no-console */


(function () {
  'use strict';

  console.log('[bgbf] script file evaluated at', new Date().toISOString(), location.href);

