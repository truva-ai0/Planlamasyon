# Planlamasyon — Netlify GitHub Paketi

Bu repo üç ana dosyayla çalışır:

- `package.json`
- `netlify.toml`
- `build.mjs`

Netlify GitHub deposunu klonladığında `npm run build` komutunu çalıştırır. Build işlemi `dist/` ön yüzünü ve `netlify/functions/` sunucu fonksiyonlarını otomatik üretir.

## Netlify ayarları

Ayarlar `netlify.toml` içinde hazırdır:

- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

## Test adresleri

Yayın sonrası:

- `/api/health`
- `/api/tkgm?action=status`

TKGM servis erişimi kamu uç noktasının güncel erişim davranışına bağlıdır. Erişim gerektiren bir kurulumda yalnızca meşru olarak verilmiş `TKGM_BEARER_TOKEN` Netlify environment variable olarak eklenebilir.
