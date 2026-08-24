# Planlamasyon v3.2.4 — Çalışan TKGM Akışının Cloudflare'a Birebir Taşınması

Bu sürümde hedef yeni bir TKGM sistemi icat etmek değil, **v3.2 / Netlify sürümünde çalışan parsel akışını Cloudflare üzerinde aynı arayüz ve aynı API cevabı ile çalıştırmaktır.**

## Neler değişti?

- Ön yüzdeki `/api/tkgm?action=...` akışı değişmedi.
- Netlify tarafında v3.2'de çalışan `tkgm-client` ve `tkgm-api` geri getirildi.
- Cloudflare tarafında `/api/tkgm` artık Netlify uyumluluk katmanından geçmeden **doğrudan Worker içinde** çalışır.
- İl / ilçe / mahalle-köy için TKGM'nin açık `megsiswebapi.v3` idari yolları ilk kaynak olarak kullanılır.
- Ada/parsel ve koordinat sorgusunda `megsiswebapi.v3.1` parsel yolu ilk kaynak olarak kullanılır.
- TKGM Parsel Sorgu'nun kamu web istemcisiyle uyumlu `User-Agent`, `Accept`, `Referer` ve `Origin` başlıkları gönderilir.
- Aynı JSON/GeoJSON sonuçları mevcut Planlamasyon normalleştiricisine verilir; UI, gerçek harita ve analiz akışı değişmez.
- NVIDIA `stepfun-ai/step-3.7-flash` Plan AI, resmî kaynak taraması, belediye kataloğu ve mevcut v3.2 özellikleri korunur.
- Cloudflare `NVIDIA_API_KEY` Secret değeri `keep_vars = true` nedeniyle deploylar arasında korunur.

## Cloudflare kurulumu

Build command:

```text
npm run build
```

Deploy command:

```text
npx wrangler deploy
```

Cloudflare runtime secret:

```text
NVIDIA_API_KEY
```

## Canlı test sırası

1. `https://planlamasyon.truvaai0.workers.dev/api/tkgm?action=status`
2. `https://planlamasyon.truvaai0.workers.dev/api/tkgm?action=provinces`
3. Siteyi açıp il → ilçe → mahalle/köy seçimlerini test edin.
4. Sonra gerçek ada/parsel sorgusu yapın.
5. Parsel bulunduğunda Plan AI'yi test edin.

`provinces` cevabında 81 ilin gelmesi, Cloudflare TKGM köprüsünün ilk kabul testidir.

## Doğruluk

TKGM'den gelen temel kadastro verileri bilgi amaçlıdır. Planlamasyon kapalı oturumları aşmaz ve kaynakta bulunmayan imar değerlerini üretmez.
