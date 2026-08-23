# Planlamasyon v3.1.5 — Güncel Resmî İmar Belgesi Okuma ve Analiz Motoru

Plan AI bilinçli olarak **v3.2** aşamasına bırakılmıştır. v3.1.5, çalışan TKGM parsel/harita motoru, 117 bağlantılı resmî belediye kataloğu ve ada–parsel plan kayıt motorunun üzerine **güncel resmî imar belgesini okuyup yapılaşma değerlerine dönüştüren** yeni katmanı ekler.

## V3.1.5 ile gelen asıl çözüm

Türkiye’de bütün belediyelerin TAKS, emsal, kat ve plan notlarını aynı açık API üzerinden vermemesi nedeniyle, kullanıcı artık belediye/e‑Plan/e‑Devlet üzerinden aldığı güncel belgeyi Planlamasyon’a ekleyebilir:

- PDF imar durumu belgesi
- İmar çapı
- Plan notu
- Herkese açık resmî PDF/HTML/JSON/XML bağlantısı
- Taranmış PDF veya PNG/JPG görsel
- Kopyalanmış resmî belge metni

Planlamasyon belgeyi okur ve aşağıdaki alanları mümkün olduğu ölçüde otomatik doldurur:

- Yetkili idare
- Plan adı, işlem/karar numarası, ölçek ve tarih
- Plan fonksiyonu
- TAKS
- Emsal / KAKS
- Kat adedi
- Yençok / Hmax
- Yapı nizamı
- Ön, yan ve arka bahçe mesafeleri
- Otopark, yol terki, taşkın ve açıkça yazılmış özel hükümler
- Belgedeki konut, villa, havuz, bodrum, balkon, çatı ve benzeri izin ifadeleri

Okunan değerler kullanıcıya gösterilir; kullanıcı resmî belgeyle karşılaştırıp onayladıktan sonra hesap motoruna aktarılır.

## Güvenlik ve doğruluk kuralları

- Belgedeki ada/parsel ile sorgulanan ada/parsel eşleşmezse belge **uygulanmaz**.
- Belge ada/parseli okunamazsa kullanıcıdan açık parsel doğrulaması istenir.
- Askı/ilan veya tarihsel plan kaydı güncel imar hakkı olarak **kullanılmaz**.
- Belgede bulunmayan TAKS, emsal, kat veya çekme mesafesi **üretilmez**.
- Her bulunan alan için belge metnindeki kanıt parçası ve okuma güveni gösterilir.
- Belge özeti SHA‑256 ile işaretlenir; kaynak ve parser sürümü sonuçta saklanır.
- Otomatik okuma bağlayıcı değildir; ruhsat öncesinde yetkili idare kaydı esastır.

## Gizlilik

Yerel dosya yüklemesinde:

- PDF metni kullanıcının tarayıcısında çıkarılır.
- Taranmış belge/görsel OCR işlemi tarayıcıda yapılır.
- Belgenin kendisi Planlamasyon sunucusuna yüklenmez.
- Yalnızca çıkarılan metin alan ayrıştırma API’sine gönderilir.

Herkese açık resmî bağlantı yöntemi seçilirse belge Netlify Function üzerinden alınır. Yalnızca HTTPS ve genel internet adresleri kabul edilir; özel ağ/localhost adresleri engellenir.

## Çalışan temel katmanlar

- TKGM il → ilçe → mahalle/köy → ada → parsel sorgusu
- Gerçek parsel GeoJSON geometrisi ve uydu haritası
- Parsel alanı, nitelik ve pafta
- 117 gömülü resmî belediye/e‑İmar hizmeti
- e‑Plan ve TUCBS resmî kaynak yönlendirmeleri
- Kamuya açık ada–parsel plan/askı kaydı keşfi
- Resmî imar belgesi okuma ve parsel eşleştirme
- Doğrulanmış değerlerden taban oturumu, toplam inşaat alanı ve açık alan hesabı
- Kaynak–sonuç ilişkisi
- Çalışmalarım, Favorilerim, Taleplerim ve hesap altyapısı
- Telefon sistem temasından bağımsız açık/koyu tema

## API’ler

```text
/api/tkgm
/api/analyze
/api/official-services
/api/plan-records
/api/parse-zoning-document
/api/request-analysis
/api/user-data
/api/health
```

Belge metni örneği:

```http
POST /api/parse-zoning-document
Content-Type: application/json

{
  "mode": "text",
  "text": "İMAR DURUMU BELGESİ ... Ada: 964 Parsel: 26 ... TAKS: 0,30 ...",
  "query": { "province": "İstanbul", "district": "Pendik", "block": "964", "parcel": "26" },
  "fileName": "imar-durumu.pdf",
  "mimeType": "application/pdf"
}
```

## Sağlık kontrolü

```text
https://planlamasyon.netlify.app/api/health
```

Beklenen sürüm:

```text
app: planlamasyon-netlify-v3.1.5
officialZoningDocumentReader: true
officialZoningDocumentApi: /api/parse-zoning-document
parcelDocumentMatchGuard: true
```

## GitHub → Netlify güncelleme

Mevcut GitHub `Planlamasyon` deposundaki şu dört dosyayı v3.1.5 paketiyle değiştirin:

```text
package.json
netlify.toml
build.mjs
README.md
```

Önerilen commit mesajı:

```text
Planlamasyon v3.1.5 güncel resmî imar belgesi okuma motoru
```

Netlify otomatik deploy alır. `Published` olduktan sonra `/api/health` kontrol edilmeli; ardından gerçek parsel sorgulanıp **Resmî İmar Belgesi Yükle ve Oku** akışı test edilmelidir.

## Dürüst kapsam

V3.1.5, kullanıcı güncel resmî imar belgesine erişebildiğinde eksik yapılaşma değerlerini otomatik okuyup sonuç motoruna taşıyabilir. e‑Devlet oturumu isteyen sonucu kullanıcı adına gizlice açmaz ve tüm belediyelerde belge olmadan TAKS/emsal üretmez. Bu sınır, yanlış imar hakkı gösterilmesini önlemek için bilinçlidir.
