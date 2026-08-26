# LocalCut

LocalCut, ekran görüntülerini ve mikrofonlu ekran videolarını yakalayan, kaynak dosyaya dokunmadan düzenleyen ve ffmpeg ile paylaşılabilir yerel videolara dönüştüren kişisel bir Tauri 2 uygulamasıdır. Hesap, telemetri, analiz, faturalama, bulut yükleme veya barındırılan kontrol düzlemi yoktur.

## Tek komutla ilk çalıştırma

Önkoşullar: macOS 12+ (Windows/Linux için yakalama API desteği WebView'e bağlıdır), [Node.js 20+](https://nodejs.org/), pnpm 10+, [Rust 1.77.2+](https://rustup.rs/) ve PATH üzerinde `ffmpeg`/`ffprobe`. macOS'ta ayrıca Xcode Command Line Tools gerekir.

Depo kökünde yalnızca şu komutu çalıştırın:

```sh
./run-local.sh
```

Betik eksikse `node_modules` bağımlılıklarını kurar, araçları doğrular, ön yüzü yerel olarak paketler ve Tauri uygulamasını macOS'ta kararlı `app.localcut.desktop` kimliğine sahip bir `LocalCut.app` paketi olarak açar. Böylece ilk çalıştırma bir geliştirme sunucusuna bağlı değildir ve ekran kaydı izni sonraki çalıştırmalarda aynı uygulamayla eşleşir. Codex Desktop'ın izole Node/pnpm çalışma ortamı bu makinede bulunuyorsa onu otomatik olarak PATH'e ekler. İlk ekran veya mikrofon yakalamasında işletim sistemi izin iletişim kutusunu onaylayın.

İsteğe bağlı yerel ayarlar için:

```sh
cp .env.example .env
```

`.env` Git tarafından dışlanmıştır. API anahtarı gerekmiyor. Yerel `whisper-cli` kullanacaksanız yürütülebilir dosya ile model yolunu yalnızca `.env` içine yazın; model ve kimlik bilgilerini commit etmeyin.

## İş akışı

1. Video veya ekran görüntüsünü; ekran, pencere ya da yüzdelik bölge olarak seçin. Video için mikrofon isteğe bağlıdır.
2. OS ekran seçicisinden paylaşılacak kaynağı onaylayın. Kayıt zamanlayıcısı her zaman pencerenin üstünde görünür; **Kaydı Durdur** tepsi menüsünde de bulunur.
3. Kırpma, 1–4× yakınlaştırma, tıklama vurgusu ve zaman aralıklı metin notlarını tahrip edici olmayan reçeteye ekleyin.
4. H.264/MP4 (`libx264`, CRF 20, AAC, `faststart`) veya WebM (`libvpx-vp9`, CRF 30, Opus) olarak yerel render alın.
5. Dosya yolunu kopyalayın veya dosyayı klasöründe gösterin. Zorunlu yükleme yoktur.

Her kaydın yanında poster, `.transcript.txt` ve `.summary.md` üretilir. `WHISPER_CLI` ve `WHISPER_MODEL` verilmişse transkript tamamen yerel Whisper çalıştırmasıyla doldurulur; verilmemişse yan dosya açık bir yerel-yapılandırma notuyla yine oluşturulur. Bu durum yakalamayı kaybetmeye neden olmaz. ffmpeg yoksa ham yakalama ve metin yan dosyaları korunur; poster/render hatası yeniden denenebilir biçimde gösterilir.

## Mimari

```text
React yakalama denetimleri
  ├─ macOS: yerel screencapture ekran/pencere/bölge seçicisi + mikrofon
  ├─ Destekleyen WebView'ler: MediaRecorder/getDisplayMedia + bölge canvas'ı
  ├─ görünür sayaç ve tepsiden durdurma
  └─ Tauri invoke / tray stop event
       ├─ Rust doğrulama + atomik yerel dosya yazımı
       ├─ SQLite: başlık, yollar ve tahrip edici olmayan EditRecipe JSON
       ├─ ffmpeg: crop/zoom/drawbox/drawtext ve H.264/WebM ön ayarları
       └─ poster + transkript + Markdown özeti
```

- `src/App.tsx`: yakalama, kütüphane, tüm durumlar ve düzenleme görünümü.
- `src/lib/capture.ts`: destekleyen WebView'ler için `getDisplayMedia`, isteğe bağlı `getUserMedia`, bölge canvas'ı ve MediaRecorder.
- `src-tauri/src/lib.rs`: macOS yerel yakalama komutları, Tauri komutları, tepsi, dosya doğrulama ve yan dosyalar.
- `src-tauri/src/db.rs`: gömülü SQLite şeması ve sorguları.
- `src-tauri/src/render.rs`: güvenli adlandırma, dönüşüm doğrulaması ve ffmpeg render grafiği.

Kaynak medya değiştirilmez. Kırpma, yakınlaştırma ve notlar SQLite'ta bir `EditRecipe` olarak saklanır; yalnızca dışa aktarma yeni dosya oluşturur. Metin açıklamaları ffmpeg'e kabuk üzerinden değil argümanlar ve geçici `textfile` ile verilir.

## İzinler ve platform davranışı

- macOS kullanım açıklamaları `src-tauri/Info.plist` içinde ekran kaydı ve mikrofon için tanımlıdır. **Sistem Ayarları → Gizlilik ve Güvenlik → Ekran ve Sistem Ses Kaydı / Mikrofon** bölümünde LocalCut'a izin verin.
- Tauri yetenekleri `src-tauri/capabilities/default.json` içinde ana pencere ve çekirdek olaylarla sınırlandırılmıştır.
- macOS Tauri WebView'i `getDisplayMedia` sağlamadığında uygulama otomatik olarak sistemin `/usr/sbin/screencapture` aracına geçer; ekran görüntüsü, video ve isteğe bağlı varsayılan mikrofon bu yerel yoldan çalışır.
- Yakalama aracı, MediaRecorder, mikrofon veya dosya yöneticisi yoksa uygulama çökmek yerine açıklayıcı ve yeniden denenebilir hata gösterir.
- Ekran/pencere/bölge seçiminin son kararı işletim sistemine aittir. macOS video seçicisinde pencere kaydı, pencereyi çevreleyen seçili kayıt alanı olarak belirlenir.

## Veri konumu ve yedekleme

Tüm kullanıcı verileri varsayılan Tauri uygulama veri klasöründedir:

- macOS: `~/Library/Application Support/app.localcut.desktop/`
- Windows: `%APPDATA%\app.localcut.desktop\`
- Linux: `~/.local/share/app.localcut.desktop/`

Klasörde `localcut.sqlite3`, `captures/` ve `exports/` bulunur. SQLite WAL kullandığı için güvenli yedekleme sırası:

1. Devam eden kaydı durdurun ve LocalCut'tan çıkın.
2. `app.localcut.desktop` klasörünün tamamını harici diske veya kişisel yedekleme konumuna kopyalayın.
3. Geri yüklerken LocalCut kapalıyken klasörün tamamını aynı konuma geri koyun.

Dışa aktarılmış bir videonun poster, transkript ve Markdown özetini birlikte taşımak için aynı dosya köküne sahip dört dosyayı kopyalayın.

## Test ve kalite komutları

```sh
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm exec playwright install chromium   # yalnızca ilk E2E çalıştırmasında
pnpm test:e2e
```

Odaklı birim testleri güvenli dosya adı ve kırpma/yakınlaştırma sınırlarını TypeScript ve Rust katmanında doğrular. Rust entegrasyon testi gerçek ffmpeg ile hem H.264 hem WebM render, poster, transkript ve Markdown yan dosyalarını üretir. Playwright senaryosu yerel kaydı açma → açıklama ekleme → reçeteyi kaydetme → H.264 dışa aktarma akışını doğrular.

## Bilerek kapsam dışı

Herkese açık bulut barındırma/yükleme, izleyici kimliği, etkileşim analizi, telemetri, analiz, hesaplar, faturalama, ekip veya kurumsal çalışma alanları, SSO ve barındırılan kontrol düzlemi eklenmemiştir. LocalCut kişisel ve yerel-öncelikli kalır.
