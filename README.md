# Planlamasyon v3.2.3 — Cloudflare TKGM Köprüsü

Bu sürüm Cloudflare Worker üzerinde görülen **“TKGM servisine ulaşılamadı / İller yükleniyor”** sorununa odaklanır. v3.2.2’deki Worker + Static Assets ve NVIDIA Plan AI yapısı korunur.

## Ana düzeltmeler

- Cloudflare `env` değerleri Netlify uyumlu sunucu modüllerine açıkça aktarılır; `NVIDIA_API_KEY` ve diğer runtime ayarları aynı kodda doğru okunur.
- TKGM istekleri TKGM Parsel Sorgu’nun kullandığı açık web bağlamı başlıklarıyla (`Origin`, `Referer`, `X-Requested-With`) gönderilir.
- İl listesinde TKGM’nin açık statik dizini ilk kaynak olarak kullanılır.
- İlçe, mahalle/köy ve parsel için birden fazla resmî TKGM CBS adresi sırayla denenir.
- Ada/parsel sorgusunda erişilebilen eski açık geometri yolu da yedek olarak denenir; giriş veya özel oturum taklit edilmez.
- Geçici 429/5xx/ağ hatalarında hem sunucu hem tarayıcı katmanında kısa otomatik yeniden deneme uygulanır.
- TKGM hata yanıtı artık hangi açık yolların denendiğine dair tanı bilgisi taşıyabilir.
- Statik `app.js` ve `styles.css` sürüm parametresi `3.2.3` yapıldı; eski tarayıcı önbelleğinin yeni kodu gizlemesi engellenir.
- `wrangler.toml` içinde `keep_vars = true`; Cloudflare Dashboard’dan girilen normal runtime değişkenleri sonraki deploylarda korunur. Secret değerler zaten Cloudflare tarafından şifreli tutulur.

## Cloudflare

Build command:

```text
npm run build
```

Deploy command:

```text
npx wrangler deploy
```

Runtime secret adı:

```text
NVIDIA_API_KEY
```

## Güvenlik ve sınır

TKGM için yalnızca kamuya açık web/CBS uç noktaları denenir. Kod e-Devlet oturumu üretmez, giriş engelini aşmaya çalışmaz ve özel kimlik bilgisi uydurmaz. Bir TKGM uç noktası gerçekten giriş gerektirirse sonuç bunu açıkça belirtir.
