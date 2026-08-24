# Planlamasyon v3.4.0 — Hızlı ve İzinli Parsel Karar Akışı

## v3.4.0 yenilikleri

- TKGM taşınmaz niteliği ile imar planı/yeni yapı hakkı ekranda iki ayrı kayıt olarak gösterilir. Kadastro kartında sürekli görünen “İmar hakkı değildir” uyarısı bulunur.
- Mobil sonuç ekranına parsel, tapu/kadastro kaydı ve imar doğrulama durumunu tek bakışta veren hızlı karar özeti eklendi. Doğrulanmış hesap yoksa dört boş “Doğrulanamadı” kartı gizlenir.
- Parsel ve kadastro geometrisi, uzun imar analizi beklenmeden gösterilir. Otomatik Plan AI ilk fazdan çıkarıldı; açık resmî kaynak taraması 15 saniyelik üst sınır içinde tamamlanır. Plan AI kullanıcı isteğiyle ayrıca çalışır.
- OpenStreetMap karoları yüklenmezse harita bir kez uydu tabanına geçer. İki taban da başarısız olduğunda parsel geometrisi korunur ve “Yeniden dene” kontrolü gösterilir.
- Beşiktaş Belediyesi için resmî hizmet yolu `manual-only` olarak kayıtlıdır. Yayımlanan kullanım koşulları nedeniyle portal otomatik taranmaz veya form gönderilmez.
- Beşiktaş KEOS/Netcad sonucu yalnız kullanıcının resmî portaldan aldığı HTML dosyasını yüklemesi/yapıştırması ve açık onay vermesiyle çevrimdışı ayrıştırılır. Ada/parsel birebir eşleşmezse hiçbir değer uygulanmaz; boş TAKS, emsal, kat veya bahçe alanı tahmin edilmez.
- 816/35 fikstürü; plan adı, Konut Alanı, 1/1000 ölçek, 09.08.2007 plan tasdik tarihi ve 12,50 m bina yüksekliği alanlarını okuma motoruna karşı test eder. Bunlar canlı portalın otomatik çekildiği anlamına gelmez.

## Dağıtım

- Üretim adresi: `https://planlamasyon.truvaai0.workers.dev/`
- Cloudflare üretim dağıtımı GitHub `main` dalını izler.

## İzin ve ticari kullanım sınırı

Halka açık bir sonuç sayfası teknik olarak açılabiliyor olsa bile bu, üçüncü taraf otomatik işleme veya ticari yeniden yayımlama izni anlamına gelmez. Beşiktaş Belediyesi’nin yayımladığı koşullar üçüncü taraf otomasyonunu yasakladığı için bu bağlantı yalnız kullanıcı tarafından açılır. Otomatik entegrasyon ancak belediye ve gerekiyorsa yazılım/veri sahibinden yazılı izin veya lisanslı API alındığında etkinleştirilmelidir.

# Önceki sürüm: Planlamasyon v3.3.0 — Türkiye Geneli Resmî Kaynak Yönlendirmesi

## v3.3.0 yenilikleri

- Her il ve ilçe için e-Devlet belediye imar araması, e-Plan imar durumu, e-Plan plan/askı kayıtları, TUCBS ve TKGM resmî yolları dinamik olarak sunulur.
- Gömülü 117 doğrulanmış bağlantı doğrudan eşleşme için korunur; katalogda kayıt olmayan yerlerde Türkiye'nin 81 ili için güvenli ulusal yönlendirme devreye girer.
- Google üzerinden yalnız `bel.tr` ve `gov.tr` alan adlarında imar kaynağı keşif bağlantısı oluşturulur. Arama sonucu doğrulanmadan resmî veri veya otomatik sorgu kaynağı sayılmaz.
- Aynı kaynağın büyük/küçük alan adı, son `/`, takip parametresi ve sorgu-parametresi sırası farklılıkları kanonikleştirilerek tekilleştirilir; anlamlı sorgu parametreleri korunur.
- Açık resmî portal manuel bağlantıdan önce seçilir; URL değişikliği sağlayıcı önbelleğini yeniler.
- Localhost, özel IP, kullanıcı adı/şifre içeren ve HTTPS olmayan yönlendirme adresleri reddedilir.
- “Yapılaşma izni bulunmuş değildir” ifadesi kaldırıldı. Yerine “Yapılaşma izni doğrulanamadı; bu, yapı yapılamayacağı anlamına gelmez” açıklaması kullanılır.
- Bağlantı bulunması TAKS, emsal, kat veya yapı izni doğrulandığı anlamına gelmez. Yalnız açık lisanslı ya da açıkça yetkilendirilmiş veri adaptörleri otomatik hesap kaynağı olabilir.

## Ticari kullanım sınırı

Google'da veya halka açık bir portalda bulunmak, verinin ticari olarak çekilip yeniden yayımlanabileceği anlamına gelmez. Ticari kadastro otomasyonu için TAKPAS sözleşmesi; kısıtlı coğrafi servisler için ilgili TUCBS/veri sahibi kurum izinleri gerekir. e-Devlet ve e-Plan hizmetleri bu sürümde güvenli bağlantı yönlendirmesi olarak kullanılır; kullanıcı oturumu veya resmî form işlemi otomatikleştirilmez.

# Önceki sürüm: Planlamasyon v3.2.9 — Doğru Bağlam ve Mobil Sonuç Deneyimi

## v3.2.9 düzeltmeleri

- İmar değeri doğrulanmayan parsellerde konut, villa, havuz ve benzeri kullanım kartları artık öneri gibi gösterilmez; tek bir güvenli açıklama sunulur.
- “Mezarlık ve Tarla”, orman, mera, park ve benzeri kadastro niteliklerinde bunun tek başına imar hakkı olmadığı açıkça belirtilir.
- Yapılaşma doğrulanmadan tam ruhsat yol haritası gösterilmez; önce yetkili idarenin güncel imar durumunun doğrulanması istenir.
- Tekrarlanan resmî bağlantılar URL ve kaynak kimliğine göre birleştirilir; ikincil kaynaklar açılır-kapanır ayrıntı bölümlerine taşındı.
- Plan AI, telefon ve “masaüstü site” görünümünde tam genişlikte bir alt panel olarak açılır. CSS ve JavaScript önbellek anahtarları v3.2.9’a yükseltildi.
- Cloudflare’ın ana sayfayı Identity ayarı gibi HTTP 200 döndürmesi artık hesap sistemini yanlışlıkla etkin göstermez.
- Hesap eşitleme kapalıyken Çalışmalarım, Favorilerim ve Taleplerim bölümlerinde kayıtların yalnız bu cihazda saklandığı açıkça gösterilir.

## Korunan v3.2.8 iyileştirmeleri

- Mobil haritada varsayılan katman daha dayanıklı OpenStreetMap katmanına alındı; parsel çiziminden sonra harita boyutu ve sınırları yeniden hesaplanır.
- Açık resmî kaynak tarama süresi ve eşzamanlı bağlantı sayısı artırıldı; yarım kalan taramalar daha az görülür.
- Plan AI bekleme süresi ve NVIDIA 202 durum sorgulama aralığı gerçek servis gecikmelerine göre düzenlendi; cevap uzunluğu hız için sınırlandı.
- Yakın çevre sorgusu 1,5 km yarıçapta hızlandırıldı ve Overpass yanıt vermediğinde Nominatim yedeği etkinleştirildi.
- Güncel e-Plan adresi `eplan.csb.gov.tr` olarak değiştirildi.
- Kadastro niteliği arsa olmayan taşınmazlarda yanıltıcı “arsa” ifadesi yerine “parsel” dili kullanılır.

> Belediye portalı otomatik sorguya izin vermiyorsa sistem güvenlik ve kullanım koşulları nedeniyle değer uydurmaz; resmî manuel sorgu veya güncel imar belgesi gerekir.

# Önceki sürüm: Planlamasyon v3.2.7 — Kanıtlı İmar Akışı ve Dayanıklı Plan AI

Bu sürüm TKGM il → ilçe → mahalle/köy → ada/parsel → gerçek geometri akışını korur; açık resmî kaynak okuma, imar hesabı ve NVIDIA Plan AI katmanlarını güvenli biçimde tamamlar.

## Bu sürümde düzeltilenler

- Açık WMS/WFS, ArcGIS ve JSON imar katmanları ile izinli/yetkili belediye adaptörleri aynı tarama kuyruğunda işlenir.
- Doğrudan açılan resmî sonuç sayfasındaki TAKS, emsal, kat, Yençok, yapı nizamı ve bahçe mesafeleri yalnız sorgulanan ada/parsel metinde açıkça eşleşirse kullanılır.
- Kullanım koşulları otomatik sorguya izin vermeyen veya giriş isteyen portallar `manual-only` olarak gösterilir; kullanıcı resmî sayfaya yönlendirilir.
- Form gönderimi yalnız kaynak yapılandırmasında `automatedQueryAllowed: true` açıkça verilmiş izinli entegrasyonlarda yapılır.
- Zaman aşımı, erişim hatası ve yarım kalan taramalar “sonuç yok” diye 30 dakika önbelleğe alınmaz.
- “Kalan Kaynakları Yeniden Tara” düğmesi bütün imar/plan kaynak önbelleklerini o istek için gerçekten atlar.
- Çelişmeyen farklı resmî kayıtlardaki tamamlayıcı alanlar birleştirilir; her alanın kaynak izi korunur. Aynı alan için uyuşmazlık varsa hesap durdurulur.
- Şişli tipi ayraçsız `Plan Fonksiyon`, `Kat Adedi`, `İnşaat Nizamı` satırları okunur. `Yençok: 25 kat` artık yanlışlıkla `25 m` yükseklik sayılmaz.
- Belge/PDF okuyucunun Cloudflare Worker ortamı için `nodejs_compat` bayrağı etkinleştirildi.
- NVIDIA `stepfun-ai/step-3.7-flash` çağrısında 202 yanıtı resmî durum uç noktasından sınırlı süreyle izlenir; ağ, zaman aşımı, kota ve anahtar hataları kodlanır.
- Model kuralları `system`, belge/soru içeriği `user` mesajında gönderilir ve aynı çağrıda hem `temperature` hem `top_p` değiştirilmez.
- Modelin kendi başına “ada/parsel eşleşti” demesi yeterli değildir. Hesaba giren kritik değer, deterministik olarak eşleşmiş aynı resmî kanıttaki alıntıyla doğrulanmalıdır.
- Plan AI servisi geçici olarak çalışmazsa sohbet 500 hatası vermez; mevcut analizdeki doğrulanmış alanları ve eksikleri kullanan, değer uydurmayan `verified-fallback` cevap döner.

## Doğrulama ve hesap ilkeleri

TKGM kaydı parselin konumunu, geometrisini ve temel kadastro bilgisini verir; tek başına imar hakkı değildir. Yaklaşık sonuçlar yalnız doğrulanmış imar alanlarıyla üretilir:

- yaklaşık taban oturumu = parsel alanı × TAKS
- yaklaşık emsale esas toplam alan = parsel alanı × emsal
- yaklaşık açık alan = parsel alanı − taban oturumu
- kat bilgisi, Yençok ve plan notları ayrıca gösterilir; birbirinin yerine tahmin edilmez

Kaynaktan gelmeyen değer doldurulmaz. “Doğrulanamadı” durumu, yanlış kesinlik üretmek yerine resmî sayfa/belge veya yetkili adaptör gerektiğini belirtir. Ruhsat ve bağlayıcı işlemde yetkili idarenin güncel imar durum belgesi esastır.

## İzinli belediye kaynağı yapılandırması

`OPEN_OFFICIAL_ZONING_SOURCES_JSON` bir WMS/WFS/ArcGIS/JSON kaynağı veya belediyeden kullanım izni alınmış portal adaptörü tanımlayabilir. Portal formu için izin açıkça belirtilmelidir:

```json
[
  {
    "id": "yetkili-belediye-adaptoru",
    "province": "İstanbul",
    "district": "Örnek İlçe",
    "title": "Belediye İmar Servisi",
    "provider": "Örnek Belediyesi",
    "kind": "portal",
    "url": "https://imar.example.bel.tr/sorgu",
    "automatedQueryAllowed": true,
    "priority": 150
  }
]
```

Kurumsal JSON API kullanılıyorsa `MUNICIPALITY_CONNECTORS_JSON`, `EPLAN_ADAPTER_URL` veya `PLANLAMASYON_ZONING_API_URL` seçenekleri de kullanılabilir.

## Cloudflare kurulumu

```text
npm run build
npm test
npx wrangler deploy
```

Gerekli Secret:

```text
NVIDIA_API_KEY
```

`wrangler.toml` içindeki `keep_vars = true` yeni dağıtımda mevcut Secret değerlerini korur.

## Canlı doğrulama sırası

1. `/api/tkgm?action=provinces` ile TKGM akışını doğrulayın.
2. Bir parsel seçip kaynak taramasını çalıştırın.
3. Açık/izinli kaynakta değer varsa imar özeti ve yaklaşık hesapları; kaynak yoksa resmî bağlantı ve eksik alanları kontrol edin.
4. “Kalan Kaynakları Yeniden Tara” ile önbelleksiz taramayı doğrulayın.
5. Plan AI’ye hem sayısal hem “eksikler neler?” sorusu sorun; NVIDIA kullanılamıyorsa `verified-fallback` cevabını kontrol edin.

> Testlerdeki HTML/PDF içerikleri ayrıştırıcı fikstürüdür; herhangi bir gerçek parselin güncel imar hakkı olarak kullanılmaz.
