# Rasadi ölçüm toplama hattı — açık kaynak aynası

Bu dizin, Rasadi'nin ziyaretçi ölçüm toplama hattının (tracker + ingest +
kayıt şeması) birebir aynasıdır. Amaç tek: **"IP saklamıyoruz, çerez
koymuyoruz" iddiasının koddan denetlenebilmesi.**

> Herkese açık depo: https://github.com/borakurum-source/rasadi-collect

## Kapsam

| Dahil | Neden |
|---|---|
| `src/lib/tracker-source.ts` | Ziyaretçinin tarayıcısında çalışan ölçüm kodu — ne gönderdiğini gösterir |
| `src/app/api/script/route.ts` | Tracker'ın sunuluşu |
| `src/app/api/collect/route.ts` | Ölçüm ucu — neyin saklandığına karar veren kod |
| `src/lib/tracking.ts`, `normalize.ts`, `locale.ts`, `locale-map.ts` | Kaynak/ortam türetme, URL temizliği |
| `src/lib/rate-limit.ts`, `keyed-mutex.ts`, `ingest-guard.ts`, `cache.ts` | Kötüye-kullanım koruması (yalnız bellek) + site önbelleği |
| `src/lib/geoip.ts` | IP → ülke/şehir/ASN türetme (IP'nin kendisi tutulmaz) |
| `src/lib/pii-mask.ts` | E-posta/telefon/TCKN maskesi |
| `src/lib/interactions.ts` | Etkileşim olaylarının izin listesi |
| `src/lib/types.ts`, `src/lib/db.ts` | Türler + veritabanı istemcisi |
| `prisma/schema.event.prisma` | `Event` modeli alıntısı — saklanan satırın şekli |

**Dahil değil:** panel, kimlik doğrulama, faturalama, içgörü/AI kartları,
yönetim, e-posta altyapısı. Bunlar ziyaretçi ölçüm yolunda değildir; SaaS
işletmesinin kapalı parçası olarak kalır.

## Nasıl denetlenir (5 dakika)

1. **Tracker ne gönderiyor?** `src/lib/tracker-source.ts` içinde `send()` —
   yükte ad, e-posta, IP yoktur.
2. **Sunucu ne saklıyor?** `src/app/api/collect/route.ts` içinde
   `db.event.create` — alan listesinde `ip` yoktur; ham `user-agent`
   yazılmaz, türetilmiş cihaz/tarayıcı yazılır.
3. **Şemada IP sütunu var mı?** `prisma/schema.event.prisma` içinde
   `model Event` — `ip` alanı yoktur.
4. **IP nerede yaşıyor?** `src/lib/geoip.ts` (anlık türetme) ve
   `src/lib/rate-limit.ts` (işlem belleğinde kısa ömürlü kova) — ikisi de
   diske yazmaz.

## Eşitleme

Bu dizin elle düzenlenmez — `bun scripts/extract-opensource.mjs` ile
üretilir. `src/lib/opensource-sync.test.ts`, aynanın kaynakla bayt-baytı
aynı olduğunu kilitler; listedeki bir dosya değişip ayna tazelenmezse
birim testleri kırmızıya döner.

## Denetim notları (2026-10-12)

- `src/lib/ingest-guard.ts` içindeki tek altyapı literali (`46.62.238.110`,
  `RASADI_OWN_IPS` varsayım değeri) sunucunun zaten herkese açık IP'sidir
  (rasadi.com.tr'nin A kaydı); gizli bilgi değildir.
- Dosyalarda API anahtarı, parola, belirteç veya iç ağ adresi yoktur
  (Task 299 yayım-öncesi taraması).

## Lisans

GNU Affero General Public License v3.0 — bkz. `LICENSE`.
Okumak ve denetlemek özgürdür; dağıtım koşulları lisans metnindedir.
