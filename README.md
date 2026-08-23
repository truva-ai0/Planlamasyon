# Planlamasyon v3.1 — AI'sız Nihai Çekirdek

Bu sürüm Plan AI motorunu **bilinçli olarak v3.2'ye bırakır**. v3.1'in amacı gerçek parsel sorgusunu; doğrulanabilir imar verisi, hesaplama, çevre analizi, kaynak ilişkisi, kullanıcı kayıtları ve analiz talebi akışıyla tamamlamaktır.

## Bu sürümde çalışanlar

- TKGM tabanlı il → ilçe → mahalle/köy → ada → parsel sorgusu
- Gerçek parsel GeoJSON geometrisi ve haritada parsele zoom
- Kadastro alanı, nitelik, pafta ve konum bilgileri
- Yapılandırılabilir e-Plan / belediye / özel imar veri adaptörleri
- Kullanıcı tarafından resmî imar belgesi bilgisi ekleme
- Kaynak yoksa TAKS, emsal, kat veya inşaat alanı üretmeme
- Kaynak çelişkisi varsa hesaplamayı durdurma
- TAKS, emsal, kat, Hmax, nizam ve çekme mesafeleri
- Yaklaşık taban oturumu, emsale esas toplam alan ve dışarıda kalan alan hesabı
- Yapılabilecekler, uyarılar, teknik ayrıntılar ve ruhsat yol haritası
- OpenStreetMap/Overpass tabanlı yakın çevre analizi
- Kaynak–sonuç eşleştirmesi
- Çalışmalarım, Favorilerim ve Taleplerim
- Netlify Identity etkinleştirilirse gerçek giriş/kayıt ve cihazlar arası veri eşitleme
- Netlify Blobs ile kullanıcı verisi ve analiz talebi saklama
- Resend yapılandırılırsa analiz talebini ekibe e-posta gönderme
- Telefon sistem temasından bağımsız açık/koyu tema

## Dürüst veri sınırı

TKGM kadastro katmanı canlıdır. Türkiye genelindeki 1/1000 uygulama imar planı ve belediye yapılaşma koşulları için tek, belgelenmiş, herkese açık ve bütün belediyeleri kapsayan bir API varsayılmamıştır. Bu nedenle v3.1 üç güvenli yol sunar:

1. `PLANLAMASYON_ZONING_API_URL` veya `EPLAN_ADAPTER_URL` ile yetkili/kurumsal adaptör,
2. `MUNICIPALITY_CONNECTORS_JSON` ile il/ilçe bazlı belediye adaptörleri,
3. Resmî imar belgesindeki değerlerin kullanıcı tarafından kaynak bağlantısıyla girilmesi.

Hiçbiri yoksa uygulama parseli ve çevreyi gösterir, fakat imar rakamı uydurmaz.

## Netlify ortam değişkenleri

Zorunlu olmayan fakat üretimde kullanılabilen değişkenler:

```text
PLANLAMASYON_ZONING_API_URL=https://...
PLANLAMASYON_ZONING_API_TOKEN=...
EPLAN_ADAPTER_URL=https://...
EPLAN_ADAPTER_TOKEN=...
MUNICIPALITY_CONNECTORS_JSON=[...]
VERIFIED_ZONING_JSON={...}
OVERPASS_API_URL=https://overpass-api.de/api/interpreter
ENVIRONMENT_ANALYSIS_ENABLED=true
ENVIRONMENT_RADIUS_METERS=2500
RESEND_API_KEY=...
ANALYSIS_TEAM_EMAIL=...
FROM_EMAIL=Planlamasyon <noreply@alanadiniz.com>
```

### VERIFIED_ZONING_JSON örneği

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

## Netlify Identity'yi etkinleştirme

Netlify panelinde:

1. Project configuration
2. Identity
3. Enable Identity
4. Registration preferences bölümünde Open veya Invite only seçin
5. E-posta doğrulama ayarını ihtiyacınıza göre belirleyin

Identity kapalıyken site yine çalışır; kayıtlar yalnızca cihazın tarayıcı hafızasında tutulur.

## GitHub güncellemesi

Mobil GitHub kullanıyorsanız aynı depodaki şu dört dosyayı yeni v3.1 dosyalarıyla değiştirin:

- `package.json`
- `netlify.toml`
- `build.mjs`
- `README.md`

Commit mesajı önerisi:

```text
Planlamasyon v3.1 çekirdek güncellemesi
```

Netlify GitHub'a bağlı olduğu için commit sonrasında otomatik build ve deploy başlar.

## Kabul testi

1. `/api/health` adresinde `ok: true` görünmeli.
2. İl, ilçe ve mahalle listeleri açılmalı.
3. Gerçek ada/parsel haritada işaretlenmeli.
4. İmar adaptörü yoksa hiçbir sabit TAKS/emsal değeri görünmemeli.
5. Resmî belge eklenince hesaplar belgedeki değerlere göre oluşmalı.
6. Kaynaklar ve “hangi bilgi nereden geldi” bölümü dolmalı.
7. Yakın çevre servisi çalışmıyorsa parsel sonucu kaybolmamalı.
8. Identity etkinleştirildiyse kayıt/giriş ve hesap eşitleme çalışmalı.

## Uyarı

Planlamasyon bilgilendirme aracıdır. Kesin sınır, aplikasyon, güncel imar durumu, proje ve ruhsat işlemleri için yetkili kurumların yazılı ve güncel kayıtları esas alınmalıdır.
