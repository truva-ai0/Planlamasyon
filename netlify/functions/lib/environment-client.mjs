import { formatDistance, geometryCenter, haversineMeters } from './geo.mjs';

const CACHE = globalThis.__PLANLAMASYON_ENV_CACHE__ || new Map();
globalThis.__PLANLAMASYON_ENV_CACHE__ = CACHE;

const DEFAULT_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];

const CATEGORY_RULES = [
  ['transport', 'Ulaşım', (tags) => tags.public_transport || tags.highway === 'bus_stop' || ['station', 'halt', 'tram_stop'].includes(tags.railway)],
  ['education', 'Eğitim', (tags) => ['school', 'kindergarten', 'college', 'university'].includes(tags.amenity)],
  ['health', 'Sağlık', (tags) => ['hospital', 'clinic', 'doctors', 'pharmacy', 'dentist'].includes(tags.amenity)],
  ['park', 'Park / Yeşil alan', (tags) => tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'recreation_ground'],
  ['commerce', 'Ticaret / Günlük ihtiyaç', (tags) => ['supermarket', 'convenience', 'mall'].includes(tags.shop) || ['marketplace', 'bank', 'post_office'].includes(tags.amenity)],
  ['culture', 'Kültür / Kamu', (tags) => ['library', 'community_centre', 'townhall', 'place_of_worship'].includes(tags.amenity)]
];

export async function analyzeEnvironment({ geometry, env = process.env, fetchImpl = globalThis.fetch }) {
  const center = geometryCenter(geometry);
  if (!center) return unavailable('Parsel merkez koordinatı hesaplanamadı.');
  if (typeof fetchImpl !== 'function') return unavailable('Yakın çevre sorgusu için ağ erişimi bulunmuyor.', center);

  const enabled = String(env.ENVIRONMENT_ANALYSIS_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enabled) return unavailable('Yakın çevre analizi bu kurulumda kapalı.', center);

  const radius = clampInt(env.ENVIRONMENT_RADIUS_METERS, 500, 5000, 2500);
  const cacheDisabled = String(env.ENVIRONMENT_CACHE_DISABLED ?? 'false').toLowerCase() === 'true';
  const cacheKey = `${center.lat.toFixed(5)}:${center.lon.toFixed(5)}:${radius}`;
  if (!cacheDisabled) {
    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }

  const endpoints = resolveOverpassEndpoints(env);
  const totalBudgetMs = clampInt(env.OVERPASS_TOTAL_TIMEOUT_MS, 2500, 30000, 4500);
  const perEndpointMs = clampInt(env.OVERPASS_TIMEOUT_MS, 900, 15000, 1600);
  const query = buildQuery(center, radius);
  const diagnostics = [];
  const startedAt = Date.now();

  for (const endpoint of endpoints) {
    const remaining = totalBudgetMs - (Date.now() - startedAt);
    if (remaining < 700) break;
    try {
      const payload = await queryEndpoint({
        endpoint,
        query,
        fetchImpl,
        timeoutMs: Math.min(perEndpointMs, remaining),
        env
      });
      const items = normalizeElements(payload?.elements || [], center);
      const categories = CATEGORY_RULES.map(([key, label]) => {
        const categoryItems = items.filter((item) => item.category === key).slice(0, 4);
        return { key, label, items: categoryItems, nearest: categoryItems[0] || null };
      }).filter((category) => category.items.length);

      const result = {
        status: 'available',
        center,
        radius,
        items: categories.flatMap((category) => category.items),
        categories,
        diagnostics,
        providerEndpoint: endpointHost(endpoint),
        source: {
          id: 'openstreetmap-environment',
          title: 'OpenStreetMap Yakın Çevre Verisi',
          provider: 'OpenStreetMap katkıcıları / Overpass API',
          url: 'https://www.openstreetmap.org/copyright',
          endpoint,
          kind: 'environment',
          trust: 'community-data',
          note: `Yakın çevre noktaları OpenStreetMap etiketlerinden hesaplandı (${endpointHost(endpoint)}); eksik veya güncel olmayan kayıtlar bulunabilir.`
        }
      };
      if (!cacheDisabled) {
        CACHE.set(cacheKey, { value: result, expiresAt: Date.now() + 60 * 60 * 1000 });
        trimCache();
      }
      return result;
    } catch (error) {
      diagnostics.push({ endpoint: endpointHost(endpoint), message: safeMessage(error), status: error?.status || null });
    }
  }

  const nominatimEnabled = String(env.NOMINATIM_FALLBACK_ENABLED ?? 'false').toLowerCase() === 'true';
  if (nominatimEnabled) {
    try {
      const fallback = await queryNominatimFallback({ center, radius, fetchImpl, env });
      if (fallback.items.length) {
        if (!cacheDisabled) {
          CACHE.set(cacheKey, { value: fallback, expiresAt: Date.now() + 60 * 60 * 1000 });
          trimCache();
        }
        return fallback;
      }
      diagnostics.push({ endpoint: 'nominatim.openstreetmap.org', message: 'Sınıflandırılmış yakın çevre kaydı bulunamadı.', status: 200 });
    } catch (error) {
      diagnostics.push({ endpoint: 'nominatim.openstreetmap.org', message: safeMessage(error), status: error?.status || null });
    }
  }

  const detail = diagnostics.slice(-4).map((item) => `${item.endpoint}${item.status ? ` (${item.status})` : ''}`).join(', ');
  return unavailable(
    `${detail ? `Yakın çevre servisleri geçici olarak yanıt vermedi: ${detail}. ` : ''}Parsel ve imar sonucu bundan etkilenmez; yakın çevre yeniden denenebilir.`,
    center,
    radius,
    diagnostics
  );
}

async function queryEndpoint({ endpoint, query, fetchImpl, timeoutMs, env }) {
  const attempts = [
    {
      name: 'GET',
      build() {
        const url = new URL(endpoint);
        url.searchParams.set('data', query);
        return { url, init: { method: 'GET' } };
      }
    },
    {
      name: 'POST_FORM',
      build() {
        return {
          url: new URL(endpoint),
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`
          }
        };
      }
    },
    {
      name: 'POST_TEXT',
      build() {
        return {
          url: new URL(endpoint),
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
            body: query
          }
        };
      }
    }
  ];

  const errors = [];
  const startedAt = Date.now();
  for (const attempt of attempts) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining < 400) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const request = attempt.build();
      const response = await fetchImpl(request.url, {
        ...request.init,
        headers: {
          Accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
          'User-Agent': clean(env.OVERPASS_USER_AGENT, 240) || 'Planlamasyon/3.6.0 (+https://planlamasyon.truva-ai.com)',
          ...(clean(env.OVERPASS_REFERER, 240) ? { Referer: clean(env.OVERPASS_REFERER, 240) } : {}),
          ...(request.init.headers || {})
        },
        signal: controller.signal
      });
      if (!response?.ok) {
        const error = new Error(`${attempt.name} isteği ${response?.status || 'yanıtsız'} döndürdü.`);
        error.status = response?.status || null;
        throw error;
      }
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error(`${attempt.name} geçerli JSON döndürmedi.`); }
      if (!payload || !Array.isArray(payload.elements)) throw new Error(`${attempt.name} beklenen Overpass veri yapısını döndürmedi.`);
      return payload;
    } catch (error) {
      const normalized = error?.name === 'AbortError' ? new Error(`${attempt.name} zaman aşımına uğradı.`) : error;
      if (error?.status) normalized.status = error.status;
      errors.push(normalized);
    } finally {
      clearTimeout(timer);
    }
  }
  const finalError = new Error(errors.map((error) => safeMessage(error)).join(' | ') || 'Overpass isteği tamamlanamadı.');
  finalError.status = errors.at(-1)?.status || null;
  throw finalError;
}

async function queryNominatimFallback({ center, radius, fetchImpl, env }) {
  const totalTimeoutMs = clampInt(env.NOMINATIM_TIMEOUT_MS, 3000, 20000, 11000);
  const requestTimeoutMs = clampInt(env.NOMINATIM_REQUEST_TIMEOUT_MS, 1200, 5000, 2800);
  const delayMs = clampInt(env.NOMINATIM_DELAY_MS, 900, 2000, 1050);
  const deltaLat = radius / 111_320;
  const deltaLon = radius / Math.max(35_000, 111_320 * Math.cos(center.lat * Math.PI / 180));
  const viewbox = [center.lon - deltaLon, center.lat + deltaLat, center.lon + deltaLon, center.lat - deltaLat].map((value) => value.toFixed(7)).join(',');
  const searches = [
    ['transport', 'Ulaşım', 'bus stop metro station'],
    ['education', 'Eğitim', 'school university'],
    ['health', 'Sağlık', 'hospital pharmacy'],
    ['park', 'Park / Yeşil alan', 'park'],
    ['commerce', 'Ticaret / Günlük ihtiyaç', 'supermarket']
  ];
  const categories = [];
  const diagnostics = [];
  const startedAt = Date.now();
  for (let index = 0; index < searches.length; index += 1) {
    const [category, label, query] = searches[index];
    const remaining = totalTimeoutMs - (Date.now() - startedAt);
    if (remaining < 700) break;
    if (index > 0) await sleep(Math.min(delayMs, Math.max(0, remaining - 600)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, Math.max(600, remaining)));
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('q', query);
      url.searchParams.set('viewbox', viewbox);
      url.searchParams.set('bounded', '1');
      url.searchParams.set('limit', '3');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('extratags', '1');
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.5',
          'User-Agent': clean(env.NOMINATIM_USER_AGENT, 240) || 'Planlamasyon/3.6.0 (+https://planlamasyon.truva-ai.com)'
        },
        signal: controller.signal
      });
      if (!response.ok) { const error = new Error(`Nominatim ${response.status} yanıtı verdi.`); error.status = response.status; throw error; }
      const json = await response.json();
      const items = (Array.isArray(json) ? json : []).map((item, itemIndex) => {
        const point = { lat: Number(item.lat), lon: Number(item.lon) };
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
        const distanceMeters = haversineMeters(center, point);
        return {
          id: `nominatim:${category}:${item.place_id || itemIndex}`,
          category,
          name: clean(item.name || item.display_name?.split(',')[0] || label, 160) || label,
          lat: point.lat,
          lon: point.lon,
          distanceMeters: distanceMeters == null ? null : Math.round(distanceMeters),
          distanceText: formatDistance(distanceMeters),
          tags: { type: clean(item.type, 80), category: clean(item.category, 80) }
        };
      }).filter(Boolean).sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
      if (items.length) categories.push({ key: category, label, items, nearest: items[0] || null });
    } catch (error) {
      diagnostics.push({ category, message: error?.name === 'AbortError' ? 'Nominatim isteği zaman aşımına uğradı.' : safeMessage(error), status: error?.status || null });
    } finally {
      clearTimeout(timer);
    }
  }
  const items = categories.flatMap((category) => category.items);
  return {
    status: items.length ? 'available' : 'not-found',
    center,
    radius,
    items,
    categories,
    diagnostics,
    providerEndpoint: 'nominatim.openstreetmap.org',
    source: {
      id: 'openstreetmap-nominatim-environment',
      title: 'OpenStreetMap Yakın Çevre Verisi',
      provider: 'OpenStreetMap katkıcıları / Nominatim',
      url: 'https://www.openstreetmap.org/copyright',
      endpoint: 'https://nominatim.openstreetmap.org/',
      kind: 'environment',
      trust: 'community-data',
      note: 'Overpass servisleri yanıt vermediğinde, yakın çevre noktaları OpenStreetMap Nominatim aramasıyla sınırlı sayıda tamamlandı; eksik kayıtlar bulunabilir.'
    }
  };
}

function sleep(ms) { return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve(); }

export function resolveOverpassEndpoints(env = {}) {
  const values = [];
  if (env.OVERPASS_API_URLS) values.push(...parseEndpointList(env.OVERPASS_API_URLS));
  if (env.OVERPASS_API_URL) values.push(env.OVERPASS_API_URL);
  if (env.OVERPASS_FALLBACK_URLS) values.push(...parseEndpointList(env.OVERPASS_FALLBACK_URLS));
  values.push(...DEFAULT_ENDPOINTS);
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    try {
      const endpoint = allowedOverpassUrl(value);
      if (seen.has(endpoint)) continue;
      seen.add(endpoint);
      unique.push(endpoint);
    } catch {
      // Hatalı özel uç nokta, güvenli kamu yedeklerini engellemez.
    }
  }
  return unique.slice(0, 8);
}

function parseEndpointList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Virgül, noktalı virgül veya satır sonu ile ayrılmış liste de desteklenir.
  }
  return String(value).split(/[\n,;]/).map((item) => item.trim()).filter(Boolean);
}

function buildQuery(center, radius) {
  const around = `(around:${radius},${center.lat.toFixed(7)},${center.lon.toFixed(7)})`;
  return `[out:json][timeout:20];(
    nwr["amenity"~"school|kindergarten|college|university|hospital|clinic|doctors|pharmacy|dentist|marketplace|bank|post_office|library|community_centre|townhall|place_of_worship"]${around};
    nwr["public_transport"]${around};
    nwr["highway"="bus_stop"]${around};
    nwr["railway"~"station|halt|tram_stop"]${around};
    nwr["leisure"~"park|garden"]${around};
    nwr["landuse"="recreation_ground"]${around};
    nwr["shop"~"supermarket|convenience|mall"]${around};
  );out center 120;`;
}

function normalizeElements(elements, center) {
  const seen = new Set();
  const items = [];
  for (const element of elements) {
    const tags = element?.tags || {};
    const point = elementPoint(element);
    if (!point) continue;
    const category = CATEGORY_RULES.find(([, , predicate]) => predicate(tags))?.[0];
    if (!category) continue;
    const name = clean(tags['name:tr'] || tags.name || genericName(tags, category), 160);
    const id = `${element.type}:${element.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const distanceMeters = haversineMeters(center, point);
    items.push({
      id,
      category,
      name: name || 'İsimsiz kayıt',
      lat: point.lat,
      lon: point.lon,
      distanceMeters: distanceMeters == null ? null : Math.round(distanceMeters),
      distanceText: formatDistance(distanceMeters),
      tags: {
        amenity: clean(tags.amenity, 80),
        shop: clean(tags.shop, 80),
        railway: clean(tags.railway, 80),
        public_transport: clean(tags.public_transport, 80),
        leisure: clean(tags.leisure, 80)
      }
    });
  }
  return items.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
}

function elementPoint(element) {
  const lat = Number(element?.lat ?? element?.center?.lat);
  const lon = Number(element?.lon ?? element?.center?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function genericName(tags, category) {
  if (category === 'transport') return tags.railway === 'station' ? 'Tren / metro istasyonu' : 'Toplu taşıma noktası';
  if (category === 'education') return 'Eğitim tesisi';
  if (category === 'health') return 'Sağlık tesisi';
  if (category === 'park') return 'Park / yeşil alan';
  if (category === 'commerce') return 'Ticaret / günlük ihtiyaç';
  return 'Kamu / kültür noktası';
}

function unavailable(message, center = null, radius = null, diagnostics = []) {
  return {
    status: 'unavailable',
    center,
    radius,
    items: [],
    categories: [],
    diagnostics,
    message: clean(message, 900),
    source: {
      id: 'openstreetmap-environment',
      title: 'OpenStreetMap Yakın Çevre Verisi',
      provider: 'OpenStreetMap katkıcıları / Overpass API',
      url: 'https://www.openstreetmap.org/copyright',
      kind: 'environment',
      trust: 'community-data',
      note: 'Bu sorguda yakın çevre verisi alınamadı; parsel ve imar sonucu bundan etkilenmez.'
    }
  };
}

function allowedOverpassUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:') throw new Error('Overpass adresi HTTPS olmalıdır.');
  if (isPrivateHost(url.hostname)) throw new Error('Özel ağ adresine Overpass isteği gönderilemez.');
  url.hash = '';
  return url.toString();
}
function isPrivateHost(hostname) {
  const host = String(hostname).toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
function endpointHost(value) { try { return new URL(String(value)).hostname; } catch { return 'Overpass'; } }
function clampInt(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback; }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function safeMessage(error) { return clean(error?.message || error, 320) || 'Bilinmeyen bağlantı hatası'; }
function trimCache() { while (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value); }
