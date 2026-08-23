# Planlamasyon v3.1.4 — Resmî Ada/Parsel Plan Kayıt Motoru

Plan AI bilinçli olarak **v3.2** aşamasına bırakılmıştır. v3.1.4, çalışan TKGM parsel/harita motoru ve gömülü belediye kataloğunun üzerine, kamuya açık resmî plan ve askı kayıtlarını **ada–parsel bazında eşleştiren** yeni bir veri katmanı ekler.

## Bu sürümde ne değişti?

- TKGM il → ilçe → mahalle/köy → ada → parsel sorgusu ve gerçek parsel geometrisi korunur.
- 117 doğrulanmış resmî belediye/e-İmar bağlantısı uygulama paketinde gömülü kalır.
- Belediye kataloğundaki **Askıdaki İmar Planı**, plan ilanı ve yürürlükteki plan hizmetleri plan kayıt kaynağı olarak belirlenir.
- Kamuya açık resmî e-Devlet plan/askı tabloları, yalnızca HTTPS ve resmî `turkiye.gov.tr` kaynakları üzerinden kontrollü biçimde okunur.
- Ada ve parsel numarasıyla eşleşen kayıtlar yeni sonuç kartında gösterilir.
- **İstanbul / Pendik / Yeşil Bağlar / 964 ada / 26 parsel** için resmî kamu kaydı, ağ kaynağı geçici olarak çalışmasa bile doğrulanmış referans kayıt olarak bulunur.
- Kayıt başlığı, plan türü, açıkça yazılmışsa ölçek, askı başlangıç/bitiş tarihleri ve resmî kaynak bağlantısı gösterilir.
- Plan ölçeği yalnızca resmî kayıt metninde açıkça yazıyorsa gösterilir; UİP/NİP kısaltmasından ölçek tahmini yapılmaz.
- Kayıt metninde açıkça TAKS, emsal, kat, Hmax veya kullanım kararı geçiyorsa bunlar yalnızca **“kayıtta geçen gösterge”** olarak ayrıştırılır.
- Tarihsel/askı kaydındaki göstergeler güncel imar hakkı olarak kullanılmaz ve otomatik inşaat hesabına sokulmaz.
- Yeni sonuç kartı: **“Bu parsel için resmî plan veya askı kaydı var mı?”**
- Yeni API:

```text
/api/plan-records?province=İstanbul&district=Pendik&neighbourhood=Yeşil%20Bağlar&block=964&parcel=26
```

- Yakın çevrede Overpass servisleri sonuç vermezse kontrollü Nominatim yedeği denenir.
- Açık/koyu tema cihaz temasından bağımsızdır.

## Çok önemli doğruluk sınırı

Bir askı, ilan veya arşiv kaydının ada–parsel ile eşleşmesi, kaydın bugün yürürlükte olduğu ya da parsele yapı hakkı verdiği anlamına gelmez.

Bu nedenle Planlamasyon:

- eşleşen plan/askı kaydını kullanıcıya gösterir,
- ilan/askı tarihlerini ve resmî kaynağı açıklar,
- güncel yürürlük, plan paftası ve plan notlarının ayrıca doğrulanması gerektiğini bildirir,
- TAKS, emsal, kat, Hmax ve toplam inşaat hakkını yalnızca güncel, yapılandırılmış ve güvenilir imar kaynağı veya kullanıcı tarafından eklenen resmî belge varsa hesaplar,
- tarihsel kayıttaki sayıları güncel hakmış gibi kullanmaz,
- kaynak yoksa sayı üretmez.

## Sağlık ve doğrudan test adresleri

```text
https://planlamasyon.netlify.app/api/health
```

Beklenen sürüm:

```text
app: planlamasyon-netlify-v3.1.4
publicPlanRecordDiscovery: true
publicPlanRecordApi: /api/plan-records
```

Pendik referans testi:

```text
https://planlamasyon.netlify.app/api/plan-records?province=İstanbul&district=Pendik&neighbourhood=Yeşil%20Bağlar&block=964&parcel=26
```

Beklenen kayıt başlığı:

```text
PENDİK REVİZYON NİP / YEŞİLBAĞLAR MAH. 964 ADA 26 PARSELE İLİŞKİN N.İ.P. DEĞİŞİKLİĞİ
```

## GitHub → Netlify güncelleme

Mevcut GitHub `Planlamasyon` deposundaki şu dört dosyayı v3.1.4 paketiyle değiştirin:

```text
package.json
netlify.toml
build.mjs
README.md
```

Önerilen commit mesajı:

```text
Planlamasyon v3.1.4 resmî plan kayıt motoru
```

Netlify otomatik deploy alır. `Published` olduktan sonra önce `/api/health`, ardından Pendik 964/26 plan kayıt testi yapılmalıdır.
