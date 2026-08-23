# Planlamasyon v3.1.3 — Gömülü Resmî Belediye İmar Kataloğu

Plan AI bilinçli olarak **v3.2** aşamasına bırakılmıştır. v3.1.3, çalışan TKGM parsel motorunun üzerine doğrulanmış resmî belediye/e-İmar bağlantı kataloğunu doğrudan uygulama paketine gömer.

## Bu sürümde ne değişti?

- 117 doğrulanmış resmî imar bağlantısı build paketine gömüldü.
- 112 belediye/yerel hizmet kaydı ve 5 ulusal kaynak tek katalogda tutuluyor.
- Seçilen il ve ilçeye göre katalog içinde tam eşleşme aranıyor.
- Bir belediyenin birden fazla hizmeti varsa hepsi listeleniyor.
- Katalogda kayıt bulunamazsa e-Devlet resmî belediye hizmet aramasına güvenli yedek geçiş yapılıyor.
- e-Plan, TUCBS, TKGM ve e-Devlet belediye kataloğu ulusal kaynaklar olarak korunuyor.
- `/api/official-services?province=İstanbul&district=Şişli` uç noktası eklendi.
- `/api/health` katalog sürümü ve kayıt sayılarını gösteriyor.
- Gömülü katalog statik olarak `/data/municipality-official-services.json` adresinde de yayımlanıyor.
- Sonuç ekranı, eşleşen resmî hizmet sayısını ve erişim türünü açıkça gösteriyor.
- Telefon temasından bağımsız açık/koyu tema korunuyor.
- Demo TAKS, emsal, kat veya inşaat hakkı üretilmiyor.

## Çok önemli doğruluk sınırı

**Resmî bağlantının katalogda bulunması, o sayfanın otomatik API sunduğu anlamına gelmez.**

Birçok e-Devlet/e-İmar hizmeti kullanıcı oturumu isteyebilir. Planlamasyon bu oturumu okuyamaz ve içeriği gerçek veriymiş gibi kopyalamaz. Bu nedenle:

- Makine-okunabilir veya yapılandırılmış imar servisi varsa otomatik TAKS/emsal/kat analizi yapılır.
- Resmî bağlantı var ama veri otomatik okunamıyorsa doğru portal kullanıcıya gösterilir.
- Kullanıcı güncel resmî imar durum belgesindeki değerleri ekleyebilir.
- Kaynakta doğrulanmayan değerler **Doğrulanamadı** kalır.

Bu güvenlik kuralı özellikle korunur:

> Kaynak yoksa sayı yok. Kaynaklar çelişiyorsa otomatik hesap yok.

## Katalog kapsamı

Gömülü kaynak dosyası:

```text
dist/data/municipality-official-services.json
```

Backend modülü:

```text
netlify/functions/lib/municipality-catalog.mjs
```

Sağlık kontrolü:

```text
https://planlamasyon.netlify.app/api/health
```

Şişli örnek katalog sorgusu:

```text
https://planlamasyon.netlify.app/api/official-services?province=İstanbul&district=Şişli
```

## GitHub → Netlify güncelleme

Mevcut GitHub `Planlamasyon` deposundaki şu dört dosyayı v3.1.3 paketiyle değiştirin:

```text
package.json
netlify.toml
build.mjs
README.md
```

Önerilen commit mesajı:

```text
Planlamasyon v3.1.3 gömülü belediye imar kataloğu
```

Netlify otomatik deploy tamamlandıktan sonra `/api/health` yanıtında:

```text
app: planlamasyon-netlify-v3.1.3
embeddedMunicipalityCatalog: true
embeddedMunicipalityCatalogRecords: 117
```

görünmelidir.

## Ortam değişkenleri

Tam otomatik imar verisi sağlayan yapılandırılmış bağlantılar için mevcut değişkenler korunur:

```text
PLANLAMASYON_ZONING_API_URL
PLANLAMASYON_ZONING_API_TOKEN
EPLAN_ADAPTER_URL
EPLAN_ADAPTER_TOKEN
MUNICIPALITY_CONNECTORS_JSON
VERIFIED_ZONING_JSON
```

Gömülü katalog için ayrıca bir ortam değişkeni gerekmiyor.
