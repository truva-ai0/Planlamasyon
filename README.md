# Planlamasyon v3.2.2 — Cloudflare Worker Runtime Düzeltmesi

Bu sürüm v3.2.1’de Cloudflare tarafından yalnızca statik site olarak algılanan yayını gerçek **Worker + Static Assets** yapısına çevirir.

## Ana düzeltme

- `src/worker.js` gerçek Worker giriş noktasıdır.
- `/api/*` istekleri Worker kodunda çalışır.
- Site dosyaları `dist` klasöründen Cloudflare Static Assets ile sunulur.
- `NVIDIA_API_KEY` artık Cloudflare **Runtime variables and secrets** bölümünden Secret olarak eklenebilir.
- Plan AI anahtarı tarayıcıya veya GitHub kaynak koduna yazılmaz.
- Netlify uyumluluğu korunur.

## Cloudflare

Build command:

```text
npm run build
```

Deploy command:

```text
npx wrangler deploy
```

Deploy tamamlandıktan sonra Cloudflare → Planlamasyon → Settings → Runtime variables and secrets altında:

```text
NVIDIA_API_KEY = NVIDIA tarafından verilen API anahtarı
```

değerini **Secret** olarak ekleyin.

## Güvenlik

Plan AI yalnız açık resmî kaynaklardan kanıtı bulunan değerleri hesap motoruna aktarır. Kaynakta bulunmayan TAKS, emsal, kat veya çekme mesafesi uydurulmaz.
