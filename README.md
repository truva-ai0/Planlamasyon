# Planlamasyon v3.2 — Plan AI + NVIDIA Resmî Kaynak Okuma Motoru

Planlamasyon v3.2, v3.1.6'daki TKGM parsel/harita motorunu, 117 kayıtlı resmî belediye kaynağını ve e-Devletsiz açık kaynak taramasını korur. Yeni olarak **Plan AI**, normal taramanın bulduğu açık resmî belediye/e-Plan/TUCBS sayfaları ile metin katmanı bulunan PDF'leri okuyup imar değerlerini kaynak kanıtıyla çıkarmaya çalışır.

## Basit çalışma sırası

1. TKGM'den gerçek parsel, alan ve geometri alınır.
2. Açık resmî kaynaklar normal kodla taranır.
3. Normal tarama eksik kalırsa Plan AI açık resmî sayfa ve belgeleri okur.
4. Plan AI şu alanları arar: plan fonksiyonu, TAKS, emsal/KAKS, kat, Yençok/Hmax, yapı nizamı, ön/yan/arka bahçe mesafeleri ve plan bilgileri.
5. Bir değer ancak **kaynak URL'si + kaynakta gerçekten bulunan kısa alıntı + doğru ada/parsel eşleşmesi + güncel/yürürlükte olduğuna dair yeterli işaret** varsa hesap motoruna aktarılır.
6. Güvenilir değer bulunduğunda taban oturumu, yaklaşık toplam emsale esas alan ve dışarıda kalan alan hesaplanır.
7. Kaynaklar çelişirse ilgili değer hesapta kullanılmaz.
8. Hiçbir açık kaynak sonuç vermiyorsa sistem sayı uydurmaz; neden hesaplanamadığını söyler.

## Plan AI modeli

- Sağlayıcı: NVIDIA NIM
- Model: `stepfun-ai/step-3.7-flash`
- Sunucu değişkeni: `NVIDIA_API_KEY`
- API: `/api/plan-ai`

API anahtarı tarayıcıya gönderilmez. Yalnızca Netlify Functions sunucu tarafında kullanılır.

## Plan AI ne yapar / ne yapmaz?

**Yapar:** Açık resmî HTML/metin/PDF içeriğini okur, belgede yazan imar değerlerini ayıklar, kaynak alıntısını kontrol eder ve mevcut analiz hakkında sade Türkçe soru-cevap sunar.

**Yapmaz:** e-Devlet oturumunu aşmaz, kapalı belediye sistemine izinsiz girmez, başka parsele ait değeri kullanmaz, tarihsel askı kaydını bugünkü imar hakkı saymaz ve kaynakta olmayan TAKS/emsal/kat değerini tahmin etmez.

Metin katmanı olmayan tamamen taranmış PDF'lerde otomatik uzaktan okuma sınırlı olabilir. Kullanıcının belge yükleme/OCR yolu son yedek olarak korunur.

## Canlı API'ler

```text
/api/tkgm
/api/analyze
/api/open-source-scan
/api/official-services
/api/plan-records
/api/parse-zoning-document
/api/plan-ai
/api/health
```

Sağlık kontrolü:

```text
https://planlamasyon.truva-ai.com/api/health
```

Beklenen ana değerler:

```text
app: planlamasyon-netlify-v3.2.0
planAi: true
planAiConfigured: true
planAiModel: stepfun-ai/step-3.7-flash
```

## GitHub güncellemesi

Mevcut Planlamasyon deposuna sadece şu dört dosya yüklenir:

```text
package.json
netlify.toml
build.mjs
README.md
```

Commit mesajı önerisi:

```text
Planlamasyon v3.2 Plan AI NVIDIA entegrasyonu
```

Netlify'da `NVIDIA_API_KEY` tanımlı olmalıdır. Yeni GitHub commit'i Netlify tarafından yeniden yayınlandığında Plan AI aktif olur.

## Doğruluk kuralı

Plan AI bir yorum katmanıdır; kaynak yerine geçmez. Kullanıcıya gösterilen yapılaşma hesabı ancak sistemin kaynak kanıtı kontrolünden geçen değerlerle yapılır. Ruhsat ve bağlayıcı işlemlerde yetkili idarenin güncel kaydı esastır.
