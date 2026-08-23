# Planlamasyon v3.1.1 — Çekirdek Düzeltme Sürümü

Plan AI bilinçli olarak **v3.2** aşamasına bırakılmıştır. v3.1.1; canlı parsel sorgusu, kamuya açık plan kapsamı kontrolü, güvenli imar doğrulama akışı, hesaplama, yakın çevre, kaynak ilişkisi, kullanıcı kayıtları ve analiz talebi altyapısını sağlamlaştırır.

## v3.1.1'de düzeltilenler

- OpenStreetMap/Overpass `406` hatası için GET → standart form POST geçişi
- Bir Overpass sunucusu yanıt vermezse güvenli yedek sunuculara otomatik geçiş
- Yakın çevre sorgusunu yeniden deneme düğmesi
- Boş TAKS, emsal, kat ve çekme mesafelerinin yanlışlıkla `0` sayılmasının engellenmesi
- Eksik TAKS/Emsal alanında `0 / 0` yerine **Doğrulanamadı** gösterimi
- TUCBS kamuya açık kesinleşmiş Uygulama İmar Planı ve Nazım İmar Planı sınırı WMS kontrolü
- WMS `application/json` formatını reddederse XML/GML formatına otomatik geçiş
- Kamuya açık plan kapsamı ile parsel bazlı yapılaşma koşullarının birbirinden açıkça ayrılması
- e-Plan düğmesinin doğrudan resmî İmar Durumu ekranına yönlendirilmesi
- `/api/health` yanıtında otomatik imar sağlayıcısının gerçekten bağlı olup olmadığının gösterilmesi
- Tema kayıt anahtarının v3.1.1'e ayrılması ve eski sürüm çakışmasının azaltılması

## Çalışan çekirdek

- TKGM tabanlı il → ilçe → mahalle/köy → ada → parsel sorgusu
- Gerçek parsel GeoJSON geometrisi ve haritada parsele zoom
- Kadastro alanı, nitelik, pafta ve konum bilgileri
- Kamuya açık kesinleşmiş plan sınırı kapsam kontrolü
- Yapılandırılabilir e-Plan / belediye / özel imar veri adaptörleri
- Kullanıcının resmî imar belgesi bilgilerini kaynakla eklemesi
- Kaynak yoksa TAKS, emsal, kat veya inşaat alanı üretmeme
- Kaynak çelişkisi varsa hesaplamayı durdurma
- Doğrulanmış TAKS/emsalden taban oturumu, toplam emsale esas alan ve dışarıda kalan alan hesabı
- Yapılabilecekler, uyarılar, teknik ayrıntılar ve ruhsat yol haritası
- OpenStreetMap/Overpass tabanlı yakın çevre analizi
- Kaynak–sonuç eşleştirmesi
- Çalışmalarım, Favorilerim ve Taleplerim
- Netlify Identity etkinleştirilirse gerçek giriş/kayıt ve cihazlar arası veri eşitleme
- Netlify Blobs ile kullanıcı verisi ve analiz talebi saklama
- Resend yapılandırılırsa analiz talebini ekibe e-posta gönderme
- Telefon sistem temasından bağımsız açık/koyu tema

## İmar verisi hakkında dürüst sınır

Kamuya açık TUCBS WMS katmanları, parsel merkezinin kesinleşmiş uygulama/nazım imar planı sınırı içinde kalıp kalmadığına ilişkin **plan kapsamı** göstergesi sağlayabilir. Bu kayıt tek başına TAKS, emsal, kat, Hmax, çekme mesafeleri veya özel plan notu değildir.

Türkiye genelindeki parsel bazlı yapılaşma koşulları için tek, belgelenmiş ve bütün belediyeleri kapsayan açık bir API varsayılmamıştır. v3.1.1 şu güvenli yolları destekler:

1. `PLANLAMASYON_ZONING_API_URL` veya `EPLAN_ADAPTER_URL` ile yapılandırılmış/yetkili adaptör,
2. `MUNICIPALITY_CONNECTORS_JSON` ile il/ilçe bazlı belediye adaptörleri,
3. `VERIFIED_ZONING_JSON` ile doğrulanmış kayıt,
4. Güncel resmî imar belgesindeki değerlerin kullanıcı tarafından kaynak bağlantısıyla eklenmesi.

Bu kaynaklardan hiçbiri yoksa uygulama gerçek parseli, kamuya açık plan kapsamını ve yakın çevreyi gösterebilir; fakat imar hakkı rakamı uydurmaz.

## Netlify ortam değişkenleri

```text
# Otomatik imar sağlayıcıları
PLANLAMASYON_ZONING_API_URL=https://...
PLANLAMASYON_ZONING_API_TOKEN=...
EPLAN_ADAPTER_URL=https://...
EPLAN_ADAPTER_TOKEN=...
MUNICIPALITY_CONNECTORS_JSON=[...]
VERIFIED_ZONING_JSON={...}

# Kamuya açık plan kapsamı
PUBLIC_PLAN_COVERAGE_ENABLED=true
PUBLIC_PLAN_COVERAGE_TIMEOUT_MS=5000
EPLAN_PUBLIC_UIP_WMS_URL=https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_uip_wms
EPLAN_PUBLIC_UIP_LAYER=tucbsPlanSinir_UIP
EPLAN_PUBLIC_NIP_WMS_URL=https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_nip_wms
EPLAN_PUBLIC_NIP_LAYER=tucbsPlanSinir_NIP

# Yakın çevre
ENVIRONMENT_ANALYSIS_ENABLED=true
ENVIRONMENT_RADIUS_METERS=2500
OVERPASS_TOTAL_TIMEOUT_MS=9000
OVERPASS_TIMEOUT_MS=4500
OVERPASS_API_URLS=["https://lz4.overpass-api.de/api/interpreter","https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://overpass.private.coffee/api/interpreter"]

# Analiz talebi e-postası
RESEND_API_KEY=...
ANALYSIS_TEAM_EMAIL=...
FROM_EMAIL=Planlamasyon <noreply@alanadiniz.com>
```

Bu değişkenlerin tamamı zorunlu değildir. TKGM sorgusu ve temel arayüz değişken eklenmeden çalışır.

## VERIFIED_ZONING_JSON örneği

Anahtar formatı: `mahalleId:ada:parsel`

```json
{
  "12345:1946:70": {
    "authority": "Yetkili Belediye",
    "sourceTitle": "Güncel İmar Durumu",
    "sourceUrl": "https://belediye.gov.tr/...",
    "planName": "1/1000 Ölçekli Uygulama İmar Planı",
    "landUse": "Konut Alanı",
    "taks": 0.30,
    "emsal": 1.50,
    "floors": 5,
    "hmax": 15.50,
    "buildingOrder": "Ayrık",
    "frontSetback": 5,
    "sideSetback": 3,
    "rearSetback": 3,
    "allowances": {
      "housing": "allowed",
      "pool": "conditional",
      "landscaping": "allowed",
      "parking": "required"
    }
  }
}
```

## GitHub güncellemesi

Mevcut `Planlamasyon` deposundaki şu dört dosyayı v3.1.1 paketindeki dosyalarla değiştirin:

- `package.json`
- `netlify.toml`
- `build.mjs`
- `README.md`

Önerilen commit mesajı:

```text
Planlamasyon v3.1.1 düzeltme güncellemesi
```

Netlify GitHub'a bağlı olduğundan commit sonrasında otomatik build/deploy başlar.

## Kabul testi

1. `/api/health` adresinde `ok: true` ve `app: planlamasyon-netlify-v3.1.1` görünmeli.
2. İl, ilçe ve mahalle listeleri açılmalı.
3. Gerçek ada/parsel haritada işaretlenmeli.
4. Boş imar verilerinde `0 / 0` görünmemeli.
5. Plan kapsamı bulunursa bunun TAKS/emsal olmadığı açıkça belirtilmeli.
6. Yakın çevre ilk sunucudan alınamazsa yedek servis denenmeli.
7. Resmî imar belgesi eklenince hesaplar yalnızca belgedeki değerlere göre oluşmalı.
8. Kaynaklar ve “hangi bilgi nereden geldi” bölümü dolmalı.

## Uyarı

Planlamasyon bilgilendirme aracıdır. Kesin sınır, aplikasyon, güncel imar durumu, proje ve ruhsat işlemlerinde yetkili kurumların yazılı ve güncel kayıtları esas alınmalıdır.
