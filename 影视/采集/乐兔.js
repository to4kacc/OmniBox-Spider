// @name 乐兔
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持，广告：有
// @version 1.0.1
// @downloadURL https://xget.xi-xu.me/gh/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/乐兔.js
/**
 * 质量较差不建议加入
 *
 * 说明：
 * 1. 由 `本地调试/乐兔.js` 转换为 OmniBox 标准接口。
 * 2. 支持 `home/category/search/detail/play`。
 * 3. 详情将旧式 `vod_play_from + vod_play_url` 转换为 `vod_play_sources`。
 * 4. 参考 `影视/采集/热播.js` 增加 `DANMU_API` 弹幕匹配能力。
 *
 * 环境变量：
 * - `LETU_HOST`：站点域名，默认 `https://www.letu.me`
 * - `DANMU_API`：弹幕 API 地址（可选）
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
const HOST = process.env.LETU_HOST || "https://www.letu.me";
const DANMU_API = process.env.DANMU_API || "";
const PAGE_LIMIT = 20;

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
  Referer: `${HOST}/`,
};

const axiosInstance = axios.create({
  timeout: 60 * 1000,
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false, family: 4 }),
  httpAgent: new http.Agent({ keepAlive: true }),
});

// ==================== 日志工具 ====================
function logInfo(message, data = null) {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("info", `[乐兔] ${output}`);
}

function logError(message, error) {
  OmniBox.log("error", `[乐兔] ${message}: ${error?.message || error}`);
}

// ==================== 通用工具 ====================
function e64(text) {
  try {
    return Buffer.from(String(text || ""), "utf8").toString("base64");
  } catch {
    return "";
  }
}

function d64(text) {
  try {
    return Buffer.from(String(text || ""), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function encodeMeta(obj) {
  try {
    return e64(JSON.stringify(obj || {}));
  } catch {
    return "";
  }
}

function decodeMeta(str) {
  try {
    const raw = d64(str || "");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function toAbsUrl(pathOrUrl) {
  const v = String(pathOrUrl || "");
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return `${HOST}${v.startsWith("/") ? "" : "/"}${v}`;
}

function getClasses() {
  return [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "电视剧" },
    { type_id: "3", type_name: "综艺" },
    { type_id: "4", type_name: "动漫" },
    { type_id: "5", type_name: "短剧" },
  ];
}

function getFilters() {
  return {};
}

function parseCardList(html) {
  const $ = cheerio.load(html || "");
  const list = [];

  $(".grid.container_list .s6").each((_, element) => {
    const $el = $(element);
    const $link = $el.find("a").first();

    const name = $link.attr("title") || "";
    const href = $link.attr("href") || "";
    const pic = $el.find(".large").attr("data-src") || "";
    const remark = $el.find(".small-text").text().trim() || "";

    if (name && href) {
      list.push({
        vod_id: href,
        vod_name: name,
        vod_pic: toAbsUrl(pic),
        vod_remarks: remark,
      });
    }
  });

  return list;
}

function convertToPlaySources(vodPlayFrom, vodPlayUrl, vodName = "", videoId = "") {
  const playSources = [];
  const froms = String(vodPlayFrom || "").split("$$$");
  const urls = String(vodPlayUrl || "").split("$$$");

  for (let i = 0; i < froms.length; i++) {
    const sourceName = froms[i] || `线路${i + 1}`;
    const sourceItems = urls[i] ? urls[i].split("#") : [];

    const episodes = sourceItems
      .map((item, index) => {
        const parts = item.split("$");
        const epName = parts[0] || `第${index + 1}集`;
        const epId = parts[1] || "";
        if (!epId) return null;

        const fid = `${videoId}#${i}#${index}`;
        const playData = { id: epId, v: vodName, e: epName, sid: String(videoId || ""), fid };
        return {
          name: epName,
          playId: e64(JSON.stringify(playData)),
          _fid: fid,
          _rawName: epName,
        };
      })
      .filter(Boolean);

    if (episodes.length > 0) {
      playSources.push({
        name: sourceName,
        episodes,
      });
    }
  }

  return playSources;
}

function preprocessTitle(title) {
  if (!title) return "";
  return title
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

function chineseToArabic(cn) {
  const map = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (!isNaN(cn)) return parseInt(cn, 10);
  if (cn.length === 1) return map[cn] || cn;
  if (cn.length === 2) {
    if (cn[0] === "十") return 10 + map[cn[1]];
    if (cn[1] === "十") return map[cn[0]] * 10;
  }
  if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
  return cn;
}

function extractEpisode(title) {
  if (!title) return "";
  const processedTitle = preprocessTitle(title).trim();

  const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));

  const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];

  const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];

  return "";
}

function buildFileNameForDanmu(vodName, episodeTitle) {
  if (!vodName) return "";
  if (!episodeTitle || episodeTitle === "正片" || episodeTitle === "播放") return vodName;

  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) {
      if (epNum < 10) return `${vodName} S01E0${epNum}`;
      return `${vodName} S01E${epNum}`;
    }
  }
  return vodName;
}

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalName;
  }
  if (mapping.episodeName) {
    return mapping.episodeName;
  }
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(
      (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
    );
    if (hit?.name) {
      return `${hit.episodeNumber}.${hit.name}`;
    }
  }
  return originalName;
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) {
  if (!scrapeData) {
    return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
  }
  if (scrapeType === "movie") {
    return scrapeData.title || fallbackVodName;
  }
  const title = scrapeData.title || fallbackVodName;
  const seasonAirYear = scrapeData.seasonAirYear || "";
  const seasonNumber = mapping?.seasonNumber || 1;
  const episodeNumber = mapping?.episodeNumber || 1;
  return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}

async function sniffLetuPlay(playUrl) {
  if (!playUrl) return null;
  try {
    logInfo("尝试嗅探播放页", playUrl);
    const sniffed = await OmniBox.sniffVideo(playUrl);
    if (sniffed && sniffed.url) {
      logInfo("嗅探成功", sniffed.url);
      return {
        urls: [{ name: "嗅探线路", url: sniffed.url }],
        parse: 0,
        header: sniffed.header || { ...DEFAULT_HEADERS, Referer: playUrl },
      };
    }
  } catch (error) {
    logInfo(`嗅探失败: ${error.message}`);
  }
  return null;
}

async function matchDanmu(fileName) {
  if (!DANMU_API || !fileName) return [];

  try {
    const response = await OmniBox.request(`${DANMU_API}/api/v2/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({ fileName }),
    });

    if (response.statusCode !== 200) return [];
    const matchData = JSON.parse(response.body);
    if (!matchData.isMatched) return [];

    const matches = matchData.matches || [];
    if (matches.length === 0) return [];

    const firstMatch = matches[0];
    const episodeId = firstMatch.episodeId;
    if (!episodeId) return [];

    const animeTitle = firstMatch.animeTitle || "";
    const episodeTitle = firstMatch.episodeTitle || "";
    let danmakuName = "弹幕";
    if (animeTitle && episodeTitle) {
      danmakuName = `${animeTitle} - ${episodeTitle}`;
    } else if (animeTitle) {
      danmakuName = animeTitle;
    } else if (episodeTitle) {
      danmakuName = episodeTitle;
    }

    return [{
      name: danmakuName,
      url: `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`,
    }];
  } catch (error) {
    logInfo(`弹幕匹配失败: ${error.message}`);
    return [];
  }
}

async function getCategoryList(type, page = 1) {
  try {
    const tid = type || "1";
    const pg = page || 1;
    const url = `${HOST}/vodtype/${tid}-${pg}.html`;

    const response = await axiosInstance.get(url, { headers: DEFAULT_HEADERS });
    const list = parseCardList(response.data);

    return {
      list,
      page: parseInt(pg, 10),
      pagecount: 999,
      limit: PAGE_LIMIT,
      total: 999 * PAGE_LIMIT,
    };
  } catch (error) {
    logError("获取分类失败", error);
    return { list: [], page: 1, pagecount: 1, limit: PAGE_LIMIT, total: 0 };
  }
}

async function getDetailById(id) {
  try {
    const detailUrl = toAbsUrl(id);
    const response = await axiosInstance.get(detailUrl, { headers: DEFAULT_HEADERS });
    const $ = cheerio.load(response.data || "");

    const vodName = $("h1").first().text().trim();
    const vodPic = toAbsUrl($("img").first().attr("src") || "");
    const vodType = $(".scroll.no-margin a").eq(0).text().trim();
    const vodActor = $(".scroll.no-margin a").eq(1).text().trim();
    const vodDirector = $(".no-space.no-margin.m.l").text().trim();
    const vodArea = $(".no-margin.m.l").text().trim();
    const vodContent = $(".responsive p").last().text().trim();

    const playFromList = [];
    const playUrlList = [];

    $(".tabs.left-align a").each((index, element) => {
      const tabName = $(element).text().trim() || `线路${index + 1}`;
      playFromList.push(tabName);

      const episodes = [];
      $(`.playno:eq(${index}) a`).each((_, ep) => {
        const epName = $(ep).text().trim();
        const epUrl = $(ep).attr("href") || "";
        if (epName && epUrl) {
          episodes.push(`${epName}$${epUrl}`);
        }
      });
      playUrlList.push(episodes.join("#"));
    });

    const videoIdForScrape = String(id || "");
    const playSources = convertToPlaySources(playFromList.join("$$$"), playUrlList.join("$$$"), vodName, videoIdForScrape);

    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = "";
    const scrapeCandidates = [];

    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        if (!ep._fid) continue;
        scrapeCandidates.push({
          fid: ep._fid,
          file_id: ep._fid,
          file_name: ep._rawName || ep.name || "正片",
          name: ep._rawName || ep.name || "正片",
          format_type: "video",
        });
      }
    }

    if (scrapeCandidates.length > 0) {
      try {
        const scrapingResult = await OmniBox.processScraping(videoIdForScrape, vodName || "", vodName || "", scrapeCandidates);
        OmniBox.log("info", `[乐兔] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);

        const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
        scrapeData = metadata?.scrapeData || null;
        videoMappings = metadata?.videoMappings || [];
        scrapeType = metadata?.scrapeType || "";
        logInfo("刮削元数据读取完成", { hasScrapeData: !!scrapeData, mappingCount: videoMappings.length, scrapeType });
      } catch (error) {
        logError("刮削处理失败", error);
      }
    }

    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
        if (!mapping) continue;
        const oldName = ep.name;
        const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
        if (newName && newName !== oldName) {
          ep.name = newName;
          OmniBox.log("info", `[乐兔] 应用刮削后源文件名: ${oldName} -> ${newName}`);
        }
        ep._seasonNumber = mapping.seasonNumber;
        ep._episodeNumber = mapping.episodeNumber;
      }

      const hasEpisodeNumber = (source.episodes || []).some(
        (ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null
      );
      if (hasEpisodeNumber) {
        source.episodes.sort((a, b) => {
          const seasonA = a._seasonNumber || 0;
          const seasonB = b._seasonNumber || 0;
          if (seasonA !== seasonB) return seasonA - seasonB;
          const episodeA = a._episodeNumber || 0;
          const episodeB = b._episodeNumber || 0;
          return episodeA - episodeB;
        });
      }
    }

    const normalizedPlaySources = playSources.map((source) => ({
      name: source.name,
      episodes: (source.episodes || []).map((ep) => ({
        name: ep.name,
        playId: ep.playId,
      })),
    }));

    return {
      vod_id: id,
      vod_name: scrapeData?.title || vodName,
      vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : vodPic,
      vod_type: vodType,
      vod_actor:
        (scrapeData?.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(",") || vodActor,
      vod_director:
        (scrapeData?.credits?.crew || [])
          .filter((c) => c?.job === "Director" || c?.department === "Directing")
          .slice(0, 3)
          .map((c) => c?.name)
          .filter(Boolean)
          .join(",") || vodDirector,
      vod_area: vodArea,
      vod_content: scrapeData?.overview || vodContent,
      vod_play_sources: normalizedPlaySources,
    };
  } catch (error) {
    logError("获取详情失败", error);
    return null;
  }
}

async function getPlay(playId, vodName = "", episodeName = "", vodId = "") {
  try {
    let realPlayId = playId;
    let playMeta = {};
    let scrapedDanmuFileName = "";
    try {
      const decoded = d64(playId);
      if (decoded && decoded.startsWith("{")) {
        const parsed = JSON.parse(decoded);
        playMeta = parsed || {};
        realPlayId = parsed.id || playId;
        vodName = parsed.v || vodName;
        episodeName = parsed.e || episodeName;
      }
    } catch {
      // ignore
    }

    try {
      const sourceVideoId = String(vodId || playMeta.sid || "");
      if (sourceVideoId) {
        const metadata = await OmniBox.getScrapeMetadata(sourceVideoId);
        if (metadata && metadata.scrapeData) {
          const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
          scrapedDanmuFileName = buildScrapedDanmuFileName(
            metadata.scrapeData,
            metadata.scrapeType || "",
            mapping,
            vodName,
            episodeName
          );
          if (metadata.scrapeData.title) {
            vodName = metadata.scrapeData.title;
          }
          if (mapping?.episodeName) {
            episodeName = mapping.episodeName;
          }
        }
      }
    } catch (error) {
      logInfo(`读取刮削元数据失败: ${error.message}`);
    }

    const playPageUrl = toAbsUrl(realPlayId);
    const response = await axiosInstance.get(playPageUrl, { headers: DEFAULT_HEADERS });
    const html = String(response.data || "");

    // 1) JSON 接口直返
    try {
      const json = JSON.parse(html);
      if (json && Number(json.code) === 200 && json.url) {
        let videoUrl = String(json.url);

        if (videoUrl.startsWith("rose_")) {
          const base64Part = videoUrl.substring(5);
          try {
            const decodedBase64 = decodeURIComponent(base64Part);
            videoUrl = Buffer.from(decodedBase64, "base64").toString();
          } catch {
            try {
              videoUrl = Buffer.from(base64Part, "base64").toString();
            } catch {
              // ignore
            }
          }
        } else if (videoUrl.startsWith("/")) {
          videoUrl = toAbsUrl(videoUrl);
        }

        const playResponse = {
          urls: [{ name: "播放", url: videoUrl }],
          parse: 0,
          header: DEFAULT_HEADERS,
        };

        if (DANMU_API && vodName) {
          const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
          if (fileName) {
            const danmakuList = await matchDanmu(fileName);
            if (danmakuList.length > 0) playResponse.danmaku = danmakuList;
          }
        }

        return playResponse;
      }
    } catch {
      // ignore
    }

    // 2) MacCMS player_ 配置
    try {
      const match = html.match(/player_.*?=(\{[\s\S]*?\})/);
      if (match && match[1]) {
        const conf = JSON.parse(match[1].replace(/'/g, '"'));
        let videoUrl = conf.url || "";

        if (String(conf.encrypt) === "1") videoUrl = decodeURIComponent(videoUrl);
        if (String(conf.encrypt) === "2") videoUrl = Buffer.from(decodeURIComponent(videoUrl), "base64").toString();

        if (videoUrl) {
          const playResponse = {
            urls: [{ name: "播放", url: videoUrl }],
            parse: 0,
            header: DEFAULT_HEADERS,
          };

          if (DANMU_API && vodName) {
            const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
            if (fileName) {
              const danmakuList = await matchDanmu(fileName);
              if (danmakuList.length > 0) playResponse.danmaku = danmakuList;
            }
          }

          return playResponse;
        }
      }
    } catch {
      // ignore
    }

    const sniffResult = await sniffLetuPlay(playPageUrl);
    if (sniffResult) return sniffResult;

    return {
      urls: [{ name: "解析", url: playPageUrl }],
      parse: 1,
      header: DEFAULT_HEADERS,
    };
  } catch (error) {
    logError("播放解析失败", error);
    const sniffResult = await sniffLetuPlay(toAbsUrl(playId));
    if (sniffResult) return sniffResult;
    return {
      urls: [{ name: "解析", url: toAbsUrl(playId) }],
      parse: 1,
      header: DEFAULT_HEADERS,
    };
  }
}

async function getSearch(keyword, page = 1) {
  try {
    const pg = page || 1;
    const wd = encodeURIComponent(String(keyword || "").trim());
    const url = `${HOST}/vodsearch/${wd}----------${pg}---/`;

    const response = await axiosInstance.get(url, { headers: DEFAULT_HEADERS });
    const list = parseCardList(response.data);

    return {
      list,
      page: parseInt(pg, 10),
      pagecount: 999,
      limit: PAGE_LIMIT,
      total: 999 * PAGE_LIMIT,
    };
  } catch (error) {
    logError("搜索失败", error);
    return { list: [], page: 1, pagecount: 1, limit: PAGE_LIMIT, total: 0 };
  }
}

// ==================== 标准接口：home ====================
async function home(params) {
  const classes = getClasses();
  const result = await getCategoryList("1", 1);

  return {
    class: classes,
    filters: getFilters(),
    list: result.list || [],
    page: 1,
    pagecount: result.pagecount || 1,
    total: result.total || 0,
    limit: result.limit || PAGE_LIMIT,
  };
}

// ==================== 标准接口：category ====================
async function category(params) {
  const type = params?.categoryId || params?.id || "1";
  const page = parseInt(params?.page, 10) || 1;
  return getCategoryList(type, page);
}

// ==================== 标准接口：detail ====================
async function detail(params) {
  try {
    const id = params?.videoId || params?.id || "";
    if (!id) return { list: [] };
    const vod = await getDetailById(id);
    return { list: vod ? [vod] : [] };
  } catch (error) {
    logError("detail 失败", error);
    return { list: [] };
  }
}

// ==================== 标准接口：search ====================
async function search(params) {
  const wd = params?.keyword || params?.wd || "";
  const page = parseInt(params?.page, 10) || 1;
  if (!wd) return { list: [], page: 1, pagecount: 1, limit: PAGE_LIMIT, total: 0 };
  return getSearch(wd, page);
}

// ==================== 标准接口：play ====================
async function play(params) {
  const playId = params?.playId || params?.id || "";
  const vodName = params?.vodName || "";
  const episodeName = params?.episodeName || "";
  const vodId = params?.vodId || "";
  if (!playId) {
    return {
      urls: [{ name: "解析", url: "" }],
      parse: 1,
      header: DEFAULT_HEADERS,
    };
  }
  return getPlay(playId, vodName, episodeName, vodId);
}

module.exports = {
  home,
  category,
  detail,
  search,
  play,
};

const runner = require("spider_runner");
runner.run(module.exports);

