# Planlamasyon v3.1.6 — E-Devletsiz Açık Resmî Kaynak Tarama Motoru

Plan AI bu sürümde bilinçli olarak kapalıdır ve v3.2 aşamasına bırakılmıştır. V3.1.6'nın amacı, parsel bulunduktan sonra hemen “Doğrulanamadı” demek yerine e-Devlet girişi istemeyen açık resmî kaynakları sırayla kontrol etmek, gerçek yapılaşma değeri bulursa hesapları otomatik üretmektir.

## Çalışma sırası

1. TKGM’den gerçek parsel, alan ve geometri alınır.
2. Yapılandırılmış açık/yetkili imar bağlantıları kontrol edilir.
3. TUCBS / e-Plan açık WMS ve WFS plan katmanları denenir.
4. Gömülü 117 resmî belediye bağlantısından ilgili ilçe ve büyükşehir kaynakları seçilir.
5. Belediye portalı açıksa sayfadaki WMS, WFS, ArcGIS REST ve JSON veri kapıları aranır.
6. Veri kapısı sayfanın JavaScript dosyasında bulunuyorsa aynı resmî alan adına ait dosyalar kontrollü olarak taranır.
7. Bulunan farklı alan adları Planlamasyon’un ortak alanlarına çevrilir: plan fonksiyonu, TAKS, emsal, kat, Yençok/Hmax, yapı nizamı ve çekme mesafeleri.
8. Gerçek değer bulunursa taban oturumu, toplam emsale esas alan ve dışarıda kalan yaklaşık alan hesaplanır.
9. Ancak açık kaynak taraması gerçekten tamamlandıktan sonra sonuç yoksa “Açık resmî kaynaklarda bulunamadığı için hesaplanamadı” denir.

## Basit açıklama

- **WMS/WFS:** Kurumun harita bilgisini başka uygulamalara açtığı resmî veri bağlantısıdır.
- **ArcGIS REST:** Belediyenin harita sistemindeki bilgiyi uygulamaların okuyabildiği başka bir veri bağlantısıdır.
- **Adaptör:** Farklı belediyelerin farklı isimlerdeki bilgilerini Planlamasyon’un anlayacağı ortak biçime çeviren parçadır.

## Kullanıcıya ne gösterilir?

Sonuç ekranındaki kapalı “Kontrol edilen resmî kaynaklar” bölümünde:

- Kaç kaynak denendiği,
- Kaç kaynağa erişildiği,
- Hangi kaynakta veri bulunduğu,
- Hangi kaynağın giriş/yetki istediği,
- Hangi kaynağın zaman aşımına uğradığı

görülebilir.

Veri bulunursa hesap sonucu otomatik gösterilir. Veri bulunamazsa hangi kaynakların denendiği açıkça gösterilir. Resmî belge yükleme ana yöntem değildir; yalnızca bütün açık kaynaklar sonuç vermediğinde son tamamlama seçeneğidir.

## Canlı API’ler

```text
/api/tkgm
/api/analyze
/api/open-source-scan
/api/official-services
/api/plan-records
/api/parse-zoning-document
/api/health
```

Sağlık kontrolünde şu değerler görünmelidir:

```text
app: planlamasyon-netlify-v3.1.6
openOfficialSourceScan: true
openOfficialSourceScanVersion: 3.1.6
openOfficialSourceScanApi: /api/open-source-scan
eDevletFreeSourcePriority: true
documentUploadFallbackOnly: true
```

## Netlify’a yükleme

GitHub’daki mevcut Planlamasyon deposunda yalnızca şu dört dosya değiştirilir:

```text
package.json
netlify.toml
build.mjs
README.md
```

Commit mesajı önerisi:

```text
Planlamasyon v3.1.6 e-Devletsiz açık resmî kaynak motoru
```

Netlify GitHub değişikliğini otomatik algılar ve mevcut `planlamasyon.netlify.app` adresini günceller.

## Önemli sınır

Bu motor açık ve e-Devlet istemeyen kaynakları gerçekten dener; ancak kurum veriyi dışarıya açmamışsa veya yalnızca kullanıcı girişi arkasında tutuyorsa o kapalı veriye erişim sağlamaz. Sistem erişemediği veriyi tahmin etmez. Bu, yanlış TAKS, emsal veya kat göstermemek için bilinçli güvenlik kuralıdır.

Canlı TUCBS/e-Plan ve belediye uç noktalarının o anki erişim durumu yalnızca Netlify üzerindeki gerçek sorguyla kesinleşir; geliştirme ortamında dış ağ doğrulaması yapılamamıştır.
