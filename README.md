# Planlamasyon v3.2.6 — Gerçek İmar Sayfası Okuma + Plan AI Düzeltmesi

Bu sürüm **v3.2.5'te çalışan TKGM + Cloudflare altyapısını korur**. Ana hedef, resmî belediye imar sayfası açık olduğu halde TAKS / emsal / kat / Yençok / yapı nizamı / bahçe mesafelerinin okunamaması ve Plan AI'nin Cloudflare'da “Beklenmeyen sunucu hatası” vermesini düzeltmektir.

## v3.2.6'da değişenler

- TKGM il → ilçe → mahalle/köy → ada/parsel → gerçek geometri akışı değiştirilmedi.
- Şişli Belediyesi için açık **Web İmar Durum Uygulaması** doğrudan resmî kaynak adayı olarak önceliklendirildi.
- Açık belediye e-imar sayfasında ada/parsel formu varsa Planlamasyon:
  1. sayfayı açar,
  2. gizli form alanlarını korur,
  3. sorgulanan ada/parseli forma yazar,
  4. sonucu aynı belediye sunucusundan alır,
  5. sonuçta **aynı ada ve parsel açıkça görülüyorsa** imar metnini okur.
- Form sonucu için ASP.NET oturum çerezi gerekiyorsa ilk sayfadan gelen çerez aynı resmî sunucuya iletilir.
- Yanlış parsele ait bir sonuçta TAKS / emsal gibi değerler **asla uygulanmaz**.
- Resmî sonuç metninde doğrudan okunabilen değerler normal hesap motoruna aktarılır.
- Doğrudan ayrıştırılamayan ama doğru parsele ait resmî metin, tekrar indirilmeden **NVIDIA Plan AI** kanıtına aktarılır.
- Açık kaynak taraması artık Plan AI'den önce çalışır; böylece Plan AI gerçek tarama sonucunu görür.
- Cloudflare Worker ortamında Node `Buffer` bulunmamasından kaynaklanan Plan AI POST hatası giderildi (`TextEncoder` / `TextDecoder` uyumlu gövde okuyucu).
- NVIDIA 401/403, 429, 404 ve timeout durumlarında artık “Beklenmeyen sunucu hatası” yerine anlaşılır hata mesajı döner.
- Analiz yine süre sınırlıdır; yavaş bir kaynak bütün ekranı sonsuza kadar bekletmez.
- Yakın çevre için Overpass yedek sunucu listesi genişletildi.

## Güvenlik kuralı

Bir belediye sayfasından değer ancak sorgulanan **ada + parsel sonucu sayfada açıkça eşleşirse** hesaplamaya alınır. Kaynakta olmayan değer tahmin edilmez.

## Cloudflare

Build command:

```text
npm run build
```

Deploy command:

```text
npx wrangler deploy
```

Runtime Secret:

```text
NVIDIA_API_KEY
```

`wrangler.toml` içinde `keep_vars = true` bulunduğu için GitHub'dan yeni deploy geldiğinde Cloudflare Secret korunur.

## Canlı test sırası

1. `/api/tkgm?action=provinces` → TKGM il verisi gelmeli.
2. İstanbul → Şişli → Mecidiyeköy → 1946 / 70 → parsel yine bulunmalı.
3. Resmî kaynak taramasında Şişli Web İmar Durum Uygulaması ilk adaylardan biri olarak denenmeli.
4. Kaynakta yapılaşma değeri varsa otomatik doldurulmalı; yoksa `Doğrulanamadı` kalmalı.
5. Plan AI'ye soru sorulduğunda NVIDIA hatası varsa gerçek hata türü görünmeli; API sağlıklıysa cevap dönmeli.

> Not: TKGM kadastro ve belediye web imar sonuçları bilgi amaçlıdır. Ruhsat ve bağlayıcı işlemde yetkili idarenin güncel resmî belgesi esastır.
