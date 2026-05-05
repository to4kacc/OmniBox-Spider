/**
 * @name 歪比巴卜
 * @key wbbb
 * @type 4
 * @api /video/wbbb
 * @searchable 1
 * @quickSearch 1
 * @changeable 0
 * @version 1.0.1
 * @downloadURL https://github.com/Silent1566/OmniBox-Spider/raw/main/影视/采集/歪比巴卜.js
 */

let OmniBox;
try {
  OmniBox = require('omnibox_sdk');
} catch (_) {
  OmniBox = {
    log(level, message) {
      console.log(`[${level}] ${message}`);
    },
  };
}
let runner;
try {
  runner = require('spider_runner');
} catch (_) {
  runner = { run() {} };
}
const axios = require('axios');
const http = require('http');
const https = require('https');
const vm = require('vm');
const CryptoJS = require('crypto-js');

const SITE = {
  key: 'wbbb',
  name: '歪比巴卜',
  api: '/video/wbbb',
  host: 'https://wbbb1.com',
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  timeout: 20000,
};

const CATS = [
  { type_id: '1', type_name: '电影' },
  { type_id: '2', type_name: '剧集' },
  { type_id: '3', type_name: '动漫' },
  { type_id: '4', type_name: '综艺' },
];

const LINE_DIRECT_RE = /^(?:lzm3u8|bfzym3u8)$/i;

const httpClient = axios.create({
  timeout: SITE.timeout,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  validateStatus: () => true,
  headers: {
    'User-Agent': SITE.ua,
    'Referer': `${SITE.host}/`,
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
});

function ok(res) {
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return res.data || '';
}

async function getHtml(url) {
  const full = /^https?:\/\//.test(url) ? url : `${SITE.host}${url}`;
  const res = await httpClient.get(full);
  return ok(res);
}

function pickMatch(str, reg, idx = 1, def = '') {
  const m = str.match(reg);
  return m ? (m[idx] || def) : def;
}

function stripTags(str = '') {
  return String(str)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSlashText(str = '') {
  return stripTags(str)
    .replace(/\s*\/\s*/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function absUrl(url = '') {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${SITE.host}${url}`;
  return `${SITE.host}/${url}`;
}

function normalizeVodFromCard(block) {
  const vod_id = pickMatch(block, /href="\/detail\/(\d+)\.html"/, 1, '');
  const vod_name = stripTags(pickMatch(block, /<div class="module-(?:poster-item-title|card-item-title)">([\s\S]*?)<\/div>/, 1, '')) || pickMatch(block, /alt="([^"]+)"/, 1, '');
  const vod_pic = absUrl(pickMatch(block, /(?:data-original|data-src|src)="([^"]+)"/, 1, ''));
  const vod_remarks = stripTags(pickMatch(block, /<div class="module-item-note">([\s\S]*?)<\/div>/, 1, ''));
  return { vod_id, vod_name, vod_pic, vod_remarks };
}

function parseCards(html) {
  const list = [];
  const reg = /<a href="\/detail\/(\d+)\.html" title="([^"]+)" class="module-poster-item module-item">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = reg.exec(html)) !== null) {
    const block = m[0];
    list.push({
      vod_id: m[1],
      vod_name: m[2],
      vod_pic: absUrl(pickMatch(block, /(?:data-original|data-src|src)="([^"]+)"/, 1, '')),
      vod_remarks: stripTags(pickMatch(block, /<div class="module-item-note">([\s\S]*?)<\/div>/, 1, '')),
    });
  }
  if (list.length) return list;

  const reg2 = /<div class="module-card-item module-item">([\s\S]*?)<\/div>\s*<\/div>/g;
  while ((m = reg2.exec(html)) !== null) {
    const vod = normalizeVodFromCard(m[1]);
    if (vod.vod_id && vod.vod_name) list.push(vod);
  }
  return list;
}

function parseTabs(detailHtml) {
  const tabs = [];
  const regs = [
    /<div class="module-tab-item tab-item"[^>]*data-dropdown-value="([^\"]+)"[\s\S]*?<small>([^<]*)<\/small>/g,
    /<div class="module-tab-item[^\"]*"[^>]*data-dropdown-value="([^\"]+)"/g,
  ];
  for (const reg of regs) {
    let m;
    while ((m = reg.exec(detailHtml)) !== null) {
      const name = (m[1] || m[2] || '').trim();
      if (name) tabs.push(name);
    }
    if (tabs.length) break;
  }
  return tabs;
}

function parsePlayGroups(detailHtml) {
  const groups = [];
  const blockReg = /<div class="module-play-list-content[^\"]*">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = blockReg.exec(detailHtml)) !== null) {
    const block = m[1];
    const items = [];
    const aReg = /<a[^>]+class="module-play-list-link[^\"]*"[^>]+href="([^\"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let a;
    while ((a = aReg.exec(block)) !== null) {
      const href = absUrl(a[1]);
      const label = stripTags(a[2]).trim();
      if (!href || !label) continue;
      items.push(`${label}$${href}`);
    }
    if (items.length) groups.push(items);
  }

  if (groups.length) return groups;

  const hrefOnly = [...detailHtml.matchAll(/<a[^>]+href="([^\"]*\/(?:vplay|play)\/[^\"#]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  if (hrefOnly.length) {
    return [hrefOnly.map((mm) => `${stripTags(mm[2]).trim() || '播放'}$${absUrl(mm[1])}`)];
  }
  return groups;
}

function parsePlayer(html) {
  const patterns = [
    /var\s+player_aaaa\s*=\s*(\{.*?\})<\/script>/s,
    /var\s+player_.*?=\s*(\{.*?\})<\/script>/s,
    /player_aaaa\s*=\s*(\{.*?\})\s*;/s,
    /player_data\s*=\s*(\{.*?\})\s*;/s,
  ];
  for (const reg of patterns) {
    const m = html.match(reg);
    if (!m) continue;
    try { return JSON.parse(m[1]); } catch (_) {}
  }
  return null;
}

function decodePlayUrl(raw, encrypt) {
  let url = String(raw || '').trim();
  const enc = String(encrypt || '').trim();
  if (enc === '1') {
    try { url = unescape(url); } catch (_) {}
  } else if (enc === '2') {
    try { url = Buffer.from(url, 'base64').toString('utf8'); } catch (_) {}
    try { url = unescape(url); } catch (_) {}
  }
  if (url.startsWith('//')) url = `https:${url}`;
  else if (url.startsWith('/')) url = absUrl(url);
  return url;
}

function isDirectMediaUrl(url, from) {
  return /^https?:\/\//i.test(url)
    || /\.(?:m3u8|mp4)(?:\?|$)/i.test(url)
    || LINE_DIRECT_RE.test(from || '');
}

async function resolveWbbbPlayerUrl(playerToken, nextUrl, title) {
  const parsePageUrl = `https://xn--qvr2v.850088.xyz/player/?url=${encodeURIComponent(playerToken)}${nextUrl ? `&next=${encodeURIComponent(nextUrl)}` : ''}${title ? `&title=${encodeURIComponent(title)}` : ''}`;
  const settingJs = await getHtml('https://xn--qvr2v.850088.xyz/player/artplayer/js/setting.js');
  let postCall = null;
  const dummy = new Proxy(function () {}, { get: () => dummy, apply: () => dummy });
  const loc = new URL(parsePageUrl);
  const el = { style: {}, addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {}, innerHTML: '' };
  const context = {
    console,
    CryptoJS,
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    fetch: async () => ({ json: async () => ({ data: [] }) }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: SITE.ua, platform: 'Linux', appVersion: 'Linux' },
    location: { href: loc.href, search: loc.search, origin: loc.origin, hostname: loc.hostname, host: loc.host, pathname: loc.pathname, toString() { return this.href; } },
    window: null,
    document: {
      title: title || '',
      referrer: `${SITE.host}/`,
      querySelector: () => null,
      getElementById: () => el,
      createElement: () => ({ ...el }),
      body: { appendChild() {} },
      head: { appendChild() {} },
      getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }],
      addEventListener() {},
      write() {},
    },
    URLSearchParams,
    URL,
    Math,
    Date,
    JSON,
    encodeURIComponent,
    decodeURIComponent,
    escape,
    unescape,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Artplayer: function () { return dummy; },
    artplayerPluginDanmuku: () => dummy,
    Hls: { isSupported: () => false },
    flvjs: { isSupported: () => false },
    dashjs: { MediaPlayer: () => ({ create: () => ({ initialize() {} }) }) },
  };
  const $ = function () {
    return {
      hide() { return this; }, show() { return this; }, text() { return this; }, html() { return this; },
      on() { return this; }, css() { return this; }, remove() { return this; }, append() { return this; },
      get() { return [{ play: () => Promise.resolve(), pause() {}, currentTime: 0 }]; },
    };
  };
  $.ajaxSettings = {};
  $.ajaxSetup = (o) => Object.assign($.ajaxSettings, o || {});
  $.post = (url, data, cb) => { postCall = { url, data }; if (cb) cb({ code: 500, msg: 'stub' }); return { fail() {} }; };
  $.get = (...args) => { const cb = args.find((x) => typeof x === 'function'); if (cb) cb({}); return { fail() {} }; };
  context.$ = context.jQuery = $;
  context.window = context;
  vm.createContext(context);
  try { vm.runInContext(settingJs, context, { timeout: 5000 }); } catch (_) {}
  if (!context.stray || typeof context.stray.start !== 'function') throw new Error('player bootstrap missing');
  try { context.stray.start(); } catch (_) {}
  if (!postCall || !postCall.url || !postCall.data) throw new Error('player api call capture failed');
  const apiUrl = /^https?:\/\//i.test(postCall.url) ? postCall.url : `https://xn--qvr2v.850088.xyz/player/${String(postCall.url).replace(/^\//, '')}`;
  const apiRes = await httpClient.post(apiUrl, new URLSearchParams(postCall.data).toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': parsePageUrl,
    },
  });
  const payload = typeof apiRes.data === 'string' ? JSON.parse(apiRes.data) : apiRes.data;
  if (!payload || Number(payload.code) !== 200 || !payload.url) throw new Error(payload && payload.msg ? payload.msg : 'parse api failed');
  if (typeof context.decrypt === 'function' && payload.aes_key && payload.aes_iv) {
    const finalUrl = context.decrypt(payload.url);
    if (finalUrl) return { url: finalUrl, type: payload.type || '' };
  }
  return { url: payload.url, type: payload.type || '' };
}

async function home(params = {}) {
  OmniBox.log('info', `[wbbb][home] params=${JSON.stringify(params)}`);
  try {
    const html = await getHtml('/');
    const list = parseCards(html).slice(0, 40);
    return { class: CATS, list };
  } catch (e) {
    OmniBox.log('error', `[wbbb][home] error=${e.message}`);
    return { class: CATS, list: [], error: e.message || String(e) };
  }
}

async function category(params = {}) {
  OmniBox.log('info', `[wbbb][category] params=${JSON.stringify(params)}`);
  try {
    const id = params.id || params.t || params.type_id || params.categoryId || '1';
    const page = parseInt(params.page || params.pg || '1', 10) || 1;
    const path = page > 1 ? `/show/${id}--------${page}---.html` : `/show/${id}-----------.html`;
    OmniBox.log('info', `[wbbb][category] url=${SITE.host}${path}`);
    const html = await getHtml(path);
    const list = parseCards(html);
    OmniBox.log('info', `[wbbb][category] id=${id} page=${page} count=${list.length}`);
    const hasNext = html.includes('title="下一页"');
    return { list, page, pagecount: hasNext ? page + 1 : page, total: list.length };
  } catch (e) {
    OmniBox.log('error', `[wbbb][category] error=${e.message}`);
    const page = parseInt(params.page || params.pg || '1', 10) || 1;
    return { list: [], page, pagecount: page, total: 0, error: e.message || String(e) };
  }
}

async function detail(params = {}) {
  OmniBox.log('info', `[wbbb][detail] params=${JSON.stringify(params)}`);
  try {
    let ids = [];
    if (Array.isArray(params.id)) ids = params.id;
    else if (Array.isArray(params.ids)) ids = params.ids;
    else if (params.ids) ids = String(params.ids).split(',').map((s) => s.trim()).filter(Boolean);
    else if (params.id) ids = String(params.id).split(',').map((s) => s.trim()).filter(Boolean);
    else if (params.vod_id) ids = String(params.vod_id).split(',').map((s) => s.trim()).filter(Boolean);
    // 新增对 videoId / video_id 的兼容
    else if (params.videoId) ids = String(params.videoId).split(',').map((s) => s.trim()).filter(Boolean);
    else if (params.video_id) ids = String(params.video_id).split(',').map((s) => s.trim()).filter(Boolean);


    const list = [];
    for (const rawId of ids) {
      const mediaId = String(rawId).trim();
      OmniBox.log('info', `[wbbb][detail] fetch detail for ${mediaId}`);
      const html = await getHtml(`/detail/${mediaId}.html`);
      const vod_name = stripTags(pickMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/, 1, ''));
      const vod_pic = absUrl(pickMatch(html, /<div class="module-item-pic">[\s\S]*?<img[^>]+data-original="([^\"]+)"/, 1, ''))
        || absUrl(pickMatch(html, /<div class="module-item-pic">[\s\S]*?<img[^>]+(?:data-src|src)="([^\"]+)"/, 1, ''));
      const vod_content = stripTags(pickMatch(html, /<div class="module-info-introduction-content[^>]*>([\s\S]*?)<\/div>/, 1, ''));
      const tagLinks = [...html.matchAll(/<div class="module-info-tag-link">([\s\S]*?)<\/div>/g)].map(x => x[1]);
      const vod_year = stripTags(tagLinks[0] || '');
      const vod_area = stripTags(tagLinks[1] || '');
      const vod_type = cleanSlashText(tagLinks[2] || '');
      const vod_remarks = stripTags(pickMatch(html, /<div class="module-item-note">([\s\S]*?)<\/div>/, 1, '')) || stripTags(pickMatch(html, /\u66f4\u65b0\u81f3[^<\s]+/, 0, ''));
      const vod_director = cleanSlashText(pickMatch(html, /\u5bfc\u6f14：[\s\S]*?<div[^>]*class="module-info-item-content">([\s\S]*?)<\/div>/, 1, ''));
      const vod_actor = cleanSlashText(pickMatch(html, /\u4e3b\u6f14：[\s\S]*?<div[^>]*class="module-info-item-content">([\s\S]*?)<\/div>/, 1, ''));

      const tabs = parseTabs(html);
      const groups = parsePlayGroups(html);
      const playFrom = [];
      const playUrl = [];
      groups.forEach((items, idx) => {
        const lineName = tabs[idx] || `\u7ebf\u8def${idx + 1}`;
        if (!items || !items.length) return;
        playFrom.push(lineName);
        playUrl.push(items.join('#'));
      });

      const vod = {
        videoId: mediaId,
        id: mediaId,
        vod_id: mediaId,
        vod_name,
        vod_pic,
        type_name: vod_type,
        vod_year,
        vod_area,
        vod_remarks,
        vod_actor,
        vod_director,
        vod_content,
        vod_play_from: playFrom.join('$$$'),
        vod_play_url: playUrl.join('$$$'),
        playFrom: playFrom,
        playUrl: playUrl,
        vod_play_list: playFrom.map((name, idx) => ({
          name,
          url: playUrl[idx] || '',
          episodes: (groups[idx] || []).map((item) => {
            const sep = item.indexOf('$');
            return sep >= 0 ? { name: item.slice(0, sep), url: item.slice(sep + 1) } : { name: item, url: '' };
          }),
        })),
      };
      OmniBox.log('info', `[wbbb][detail] parsed mediaId=${mediaId}, name=${vod_name}, tabs=${playFrom.length}, groups=${groups.length}, episodeCounts=${groups.map(g => g.length).join('/')}, playFrom=${vod.vod_play_from}`);
      if (!vod.vod_play_url) {
        OmniBox.log('warn', `[wbbb][detail] no vod_play_url for ${mediaId}, htmlLength=${html.length}, hasVplay=${html.includes('/vplay/')}`);
      }
      list.push(vod);
    }
    OmniBox.log('info', `[wbbb][detail] total items=${list.length}, first play_from=${list[0]?.vod_play_from?.split('$$$')[0]||''}`);
    return { list };
  } catch (e) {
    OmniBox.log('error', `[wbbb][detail] error=${e.message}`);
    return { list: [], error: e.message || String(e) };
  }
}

async function search(params = {}) {
  OmniBox.log('info', `[wbbb][search] params=${JSON.stringify(params)}`);
  try {
    const wd = params.wd || params.keyword || params.key || '';
    const page = parseInt(params.page || params.pg || '1', 10) || 1;
    if (!wd) return { list: [], page, pagecount: page, total: 0 };
    const path = page > 1 ? `/search/-------------.html?wd=${encodeURIComponent(wd)}&page=${page}` : `/search/-------------.html?wd=${encodeURIComponent(wd)}`;
    OmniBox.log('info', `[wbbb][search] url=${SITE.host}${path}`);
    const html = await getHtml(path);
    const list = parseCards(html);
    return { list, page, pagecount: list.length >= 20 ? page + 1 : page, total: list.length };
  } catch (e) {
    const page = parseInt(params.page || params.pg || '1', 10) || 1;
    OmniBox.log('error', `[wbbb][search] error=${e.message}`);
    return { list: [], page, pagecount: page, total: 0, error: e.message || String(e) };
  }
}

async function play(params = {}) {
  OmniBox.log('info', `[wbbb][play] params=${JSON.stringify(params)}`);
  const id = params.id || params.play || params.playId || params.url;
  try {
    const html = await getHtml(id);
    const player = parsePlayer(html);
    OmniBox.log('info', `[wbbb][play] player url=${player.url || ''} from=${player.from || ''}`);
    if (!player) return { parse: 1, jx: 1, url: id };
    const url = decodePlayUrl(player.url, player.encrypt);
    const from = String(player.from || '').trim();
    const nextUrl = player.link_next ? absUrl(player.link_next) : '';
    const title = player.vod_data && player.vod_data.vod_name ? String(player.vod_data.vod_name) : '';
    if (isDirectMediaUrl(url, from)) {
      return { parse: 0, jx: 0, url, header: { 'User-Agent': SITE.ua, 'Referer': `${SITE.host}/` } };
    }
    const parseApi = String(player.parse || player.jx || '').trim();
    if (parseApi) {
      const jump = /^https?:\/\//i.test(parseApi) ? `${parseApi}${encodeURIComponent(url)}` : absUrl(`${parseApi}${encodeURIComponent(url)}`);
      return { parse: 0, jx: 0, url: jump, header: { 'User-Agent': SITE.ua, 'Referer': `${SITE.host}/` } };
    }
    try {
      const resolved = await resolveWbbbPlayerUrl(String(player.url || ''), nextUrl, title);
      if (resolved && resolved.url) {
        return { parse: 0, jx: 0, url: resolved.url, header: { 'User-Agent': SITE.ua, 'Referer': `${SITE.host}/` } };
      }
    } catch (_) {}
    return { parse: 1, jx: 1, url, header: { 'User-Agent': SITE.ua, 'Referer': `${SITE.host}/` } };
  } catch (e) {
    return { parse: 1, jx: 1, url: id, error: e.message || String(e) };
  }
}

module.exports = { home, category, detail, search, play };
runner.run(module.exports);
