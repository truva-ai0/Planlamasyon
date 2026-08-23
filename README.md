# Planlamasyon v3.1.2 — Türkiye Geneli Resmî İmar Sağlayıcı Mimarisi

Plan AI bilinçli olarak **v3.2** aşamasına bırakılmıştır. v3.1.2; çalışan TKGM parsel motorunun üzerine Türkiye genelindeki resmî imar kaynaklarını tek bir sağlayıcı yönlendirme katmanında toplar.

## v3.1.2 ile gelenler

- Türkiye geneli **e-Plan İmar Durumu** resmî portalı
- TUCBS Coğrafi Açık Veri ve kamuya açık kesinleşmiş UIP/NIP WMS kapsam/metaveri kontrolü
- İl ve ilçeye göre ilgili belediyenin e-Devlet **İmar Durum Bilgisi Sorgulama** hizmetini bulma veya resmî arama bağlantısı oluşturma
- `MUNICIPALITY_CONNECTORS_JSON` ile il/ilçe bazlı otomatik belediye adaptörü yönlendirmesi
- Kamuya açık plan adı, ölçeği, işlem numarası, tarih ve idare metaverilerini sonuçta gösterme
- Resmî hizmetleri ayrı “Türkiye geneli resmî bağlantılar” kartında sunma
- Yapılaşma hakkı verisi yoksa TAKS, emsal, kat ve inşaat alanı üretmeme
- Overpass sorgu sözdizimi düzeltmesi ve yakın çevre yedek sunucu zinciri
- v3.1.2 tema/cache ayrımı

## Önemli sınır

Türkiye’de tüm belediyelerin TAKS, emsal, kat, Hmax ve özel plan notlarını aynı açık JSON şemasında veren tek bir kamu API’si varsayılmamıştır. Bu sürüm üç katmanlı çalışır:

1. Ulusal kaynaklar: TKGM, e-Plan, TUCBS.
2. Yetkili yerel kaynak keşfi: ilgili belediyenin e-Devlet/resmî imar hizmeti.
3. Otomatik bağlantı: açık/yetkili belediye servisi `MUNICIPALITY_CONNECTORS_JSON` ile tanımlandığında yapılaşma değerleri otomatik alınır.

Kimlik doğrulaması isteyen e-Devlet sonucu Planlamasyon tarafından kullanıcı adına okunmaz. Kullanıcı resmî ekrana yönlendirilir veya güncel resmî imar belgesindeki değerleri kaynak göstererek ekler.

## MUNICIPALITY_CONNECTORS_JSON örneği

```json
[
  {
    "id": "ornek-belediye-imar",
    "province": "İstanbul",
    "district": "Şişli",
    "url": "https://yetkili-servis.example.gov.tr/planlamasyon/imar",
    "method": "POST",
    "title": "Şişli Belediyesi İmar Veri Servisi",
    "provider": "Şişli Belediyesi",
    "publicUrl": "https://www.turkiye.gov.tr/sisli-belediyesi-imar-durum-sorgulama",
    "tokenEnv": "SISLI_IMAR_API_TOKEN"
  }
]
```

Adaptörün JSON yanıtında mümkün olan alanlar: `landUse`, `taks`, `emsal`, `floors`, `hmax`, `buildingOrder`, `frontSetback`, `sideSetback`, `rearSetback`, `planName`, `planNumber`, `planScale`, `planDate`, `authority`, `planNotes`, `constraints`, `allowances`.

## Netlify ortam değişkenleri

```text
MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED=true
MUNICIPALITY_EDEVLET_DISCOVERY_TIMEOUT_MS=3500
MUNICIPALITY_OFFICIAL_SERVICES_JSON=[]
MUNICIPALITY_CONNECTORS_JSON=[]

PUBLIC_PLAN_COVERAGE_ENABLED=true
PUBLIC_PLAN_COVERAGE_TIMEOUT_MS=7000

PLANLAMASYON_ZONING_API_URL=https://...
PLANLAMASYON_ZONING_API_TOKEN=...
EPLAN_ADAPTER_URL=https://...
EPLAN_ADAPTER_TOKEN=...
VERIFIED_ZONING_JSON={}
```

## GitHub güncellemesi

Mevcut depodaki `package.json`, `netlify.toml`, `build.mjs` ve `README.md` dosyalarını v3.1.2 paketiyle değiştirin. Önerilen commit mesajı:

```text
Planlamasyon v3.1.2 Türkiye geneli imar sağlayıcı güncellemesi
```

Netlify commit sonrasında otomatik build/deploy başlatır.

## Kabul testi

- `/api/health` içinde `app: planlamasyon-netlify-v3.1.2` görünmeli.
- Gerçek parsel haritada görünmeli.
- Sonuçta e-Plan, TUCBS ve ilgili belediyenin resmî hizmeti listelenmeli.
- Kamu plan metaverisi bulunursa plan adı/ölçek gibi bilgiler gösterilmeli.
- Otomatik imar adaptörü yoksa TAKS/emsal/kat yine **Doğrulanamadı** kalmalı.
- Yakın çevre sorgusu geçerli Overpass QL biçimiyle çalışmalı.

Planlamasyon bilgilendirme aracıdır. Bağlayıcı işlemde yetkili idarelerin güncel ve yazılı kayıtları esas alınır.
