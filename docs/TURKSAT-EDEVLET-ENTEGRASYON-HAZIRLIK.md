# Planlamasyon — Türksat / e-Devlet Entegrasyon Hazırlığı

Bu belge başvuru ve teknik tasarım hazırlığıdır; Türksat onayı, kurum yetkisi veya canlı e-Devlet veri erişimi verildiği anlamına gelmez.

## Onay gelene kadar çalışan güvenli akış

1. Planlamasyon, 1.407 belediyelik resmî envanterden doğru yetkili idareyi ve bilinen hizmet bağlantısını seçer.
2. e-Devlet hizmeti `https://www.turkiye.gov.tr/...` adresinde yeni sekmede açılır.
3. Kullanıcı kimlik doğrulamasını yalnız e-Devlet ekranında yapar. Planlamasyon parola, çerez, erişim belirteci veya oturum verisi almaz.
4. Kullanıcı resmî sonucu PDF/JPG/PNG olarak indirir ve Planlamasyon’a ekler.
5. Dosya cihazda metne dönüştürülür; yalnız çıkarılan metin ve kullanıcının açık onayı belge çözümleme API’sine gider.
6. Ada/parsel, belge türü, tarih, yetkili idare ve alan kanıtı doğrulanmadan TAKS/KAKS/kat/Hmax/bahçe hesabı yapılmaz.

## Resmî entegrasyon için önerilen mimari

```text
Planlamasyon istemcisi
  -> Planlamasyon yetkilendirme başlangıç uç noktası
  -> Türksat/e-Devlet resmî yetkilendirme ekranı
  -> Kurumca kayıtlı callback
  -> Tek kullanımlık kodun sunucuda doğrulanması
  -> Yalnız onaylanan hizmet ve alan kapsamının okunması
  -> Parsele bağlı, süreli ve denetlenebilir sonuç
```

- OAuth/OIDC veya Türksat’ın yazılı olarak bildireceği resmî protokol dışında kimlik doğrulama taklit edilmez.
- Parola hiçbir zaman Planlamasyon alan adına girilmez.
- Erişim belirteçleri tarayıcı `localStorage` alanına yazılmaz; sunucuda şifreli, kısa ömürlü ve kapsamı sınırlı tutulur.
- Her kurum/hizmet için amaç, veri alanları, saklama süresi, silme yolu ve hukukî dayanak ayrı kaydedilir.
- Kullanıcıya hangi kurumdan hangi alanın alındığı ve ne kadar süre tutulduğu gösterilir.
- Kimlik ve parsel belgesi, belediye verisi ve analiz çıktısı ayrı veri sınıflarıdır.
- Loglarda parola, çerez, token, ham belge veya hassas sorgu parametresi bulunmaz.
- İptal/çıkış, token yenileme, anahtar döndürme, olay kaydı ve veri silme senaryoları test edilir.

## Başvurudan önce gerekli kuruluş bilgileri

- Şirket/tüzel kişi unvanı, vergi ve MERSİS bilgileri
- Yetkili temsilci ve teknik/güvenlik irtibat kişileri
- Üretim alan adı ve sabit callback adresleri
- KVKK aydınlatma metni, açık rıza gerektiren/ gerektirmeyen işleme ayrımı
- Veri envanteri, saklama ve silme politikası
- Sızma testi ve güvenlik inceleme raporu
- Talep edilen e-Devlet hizmetlerinin kurum bazında listesi ve kullanım amacı
- Belediyeler/Türksat ile gerekli veri paylaşımı ve ticarî kullanım izinleri

## Kabul testleri

- Sahte alan adı, iframe, açık yönlendirme ve callback değiştirme engellenir.
- `state`, `nonce`, PKCE ve tek kullanımlık kod tekrar saldırıları reddedilir.
- Kullanıcı yalnız onayladığı belediye/hizmet kapsamını paylaşır.
- Başarısız veya süresi dolmuş oturum veri sonucu üretmez.
- Kurum kaynağı ve belge tarihi olmayan alan “doğrulanamadı” kalır.
- Yetki geri çekildiğinde token ve ilişkili geçici veri silinir.

## Mevcut v3.8 sınırı

v3.8 yalnız güvenli yönlendirme ve kullanıcı belgesi aktarımı yapar. e-Devlet hesabına arka planda giriş, CAPTCHA aşma, kullanıcı çerezi okuma veya oturum kopyalama yoktur.
