# Planlamasyon v3.2.5 — Hızlı ve Kesilmeyen Analiz Akışı

Bu sürüm **v3.2.4'te çalışan TKGM köprüsünü aynen korur**. Değişiklik, parsel bulunduktan sonra imar/çevre/açık kaynak taramasının bir servis yüzünden sürekli “Hazırlanıyor / Taranıyor” durumunda kalmasını önler.

## Neler değişti?

- TKGM il → ilçe → mahalle/köy → ada/parsel → gerçek geometri akışı değiştirilmedi.
- İmar analizi artık kontrollü bir toplam süre içinde sonuç döndürür.
- e-Plan, TUCBS, belediye açık veri, plan kaydı, çevre ve Plan AI istekleri için ayrı süre sınırları vardır.
- Bir kaynak cevap vermediğinde **diğer bulunan bilgiler yine gösterilir**.
- Yanıt vermeyen bölüm “alınamadı / süre sınırı” olarak işaretlenir; bütün sonuç ekranı sonsuza kadar dönmez.
- Açık resmî kaynak taraması ile Plan AI paralel yürütülür; biri yavaşsa diğerini bekletmez.
- Yakın çevre analizi ilk sonuçta en fazla birkaç saniye beklenir; çevre servisi yavaşsa parsel ve imar sonucu bundan etkilenmez.
- Tarayıcı tarafında da son güvenlik olarak analiz isteğine 22 saniyelik üst sınır eklenmiştir.
- NVIDIA `stepfun-ai/step-3.7-flash`, `NVIDIA_API_KEY` Secret ve Cloudflare `keep_vars = true` korunur.

## Cloudflare kurulumu

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

## Beklenen davranış

1. TKGM parseli bulur ve haritada gösterir.
2. İmar/plan/çevre kaynakları kontrollü süre içinde paralel kontrol edilir.
3. Bulunan veri hemen sonuç ekranına girer.
4. Cevap vermeyen kaynak bütün ekranı kilitlemez; “yanıt vermedi / daha sonra tekrar denenebilir” şeklinde görünür.
5. Kaynakta gerçek TAKS, emsal, kat, Yençok veya çekme mesafesi varsa hesap yapılır; yoksa değer uydurulmaz.

## Canlı test

- `/api/tkgm?action=provinces` → TKGM bağlantısı
- Site: İstanbul → Şişli → Mecidiyeköy → 1946 / 70
- Parsel bulunduktan sonra sonuç ekranının 20 saniyeden uzun “Hazırlanıyor”da kalmaması
- Plan AI kartında NVIDIA yapılandırmasının görünmesi

## Not

TKGM temel kadastro verileri bilgi amaçlıdır. İmar ve ruhsat açısından bağlayıcı işlem öncesinde yetkili idarenin güncel kaydı esastır.
