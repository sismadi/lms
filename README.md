# LMS Piawai (MOOC IPWIJA) — format PPM

Gabungan `app-lms` + `api-lms` dengan struktur dan tampilan **SIM-PPM**:
satu Cloudflare Worker menyajikan frontend (`public/`) sekaligus API
(`/api`, `/public`) ke D1 `lms-db`. Satu origin, tanpa CORS.

```
lms-ppm/
├─ wrangler.toml          # Worker + D1 + [assets] (pola PPM)
├─ schema.sql             # skema + seed akun demo
├─ migrations/            # 002_seed_quiz_robotika.sql
├─ hash-password.mjs      # buat hash PBKDF2 untuk reset akun
├─ src/index.js           # Worker (logika auth/kuis/sertifikat tetap, + /api/health + fallback ASSETS)
└─ public/
   ├─ index.html          # shell PPM: topbar + sidebar + main
   ├─ css/  style.css (asli) · svg.css · theme-ppm.css (palet & layout PPM)
   ├─ img/  logo-ipwija.png
   └─ js/   script, db, auth, courses, dosen, admin, quiz, dataset, svg
      └─ pages/  home, learn, rpl, pbo, robotika, cert
```

## Setup
```bash
wrangler d1 execute lms-db --remote --file=./schema.sql
wrangler d1 execute lms-db --remote --file=./migrations/002_seed_quiz_robotika.sql   # opsional
wrangler secret put SESSION_SECRET      # WAJIB (32+ karakter acak)
wrangler secret put RESEND_API_KEY      # opsional (email reset password)
wrangler deploy
```
Lokal: `wrangler dev` (frontend & API di http://localhost:8787).
Cek koneksi D1: `GET /api/health`.

## Yang berubah dari LMS lama
- `db.js`: `API_ORIGIN` absolut dihapus → path relatif `/public` & `/api`.
- Berkas dipindah ke `public/css`, `public/js`, `public/js/pages`; path di `index.html` dan `loadPageScripts` disesuaikan.
- `index.html`: header/menu-bar lama diganti shell PPM (topbar, sidebar `#navLinks`, panel utama). ID yang dipakai JS (`navLinks`, `burgerBtn`, `authSlot`, `content`, drawer) tetap sama.
- CSP: `connect-src` tidak lagi memuat `workers.dev` (cukup `'self'`).
- `CNAME` (GitHub Pages) dihapus; domain diatur lewat Cloudflare (Custom Domain pada Worker).
- Menu otomatis tersaring peran (`siteConfig` di `dataset.js` tidak diubah).

## Akun demo (ganti sebelum produksi)
`admin/admin123` · `dosen/dosen123` · `peserta/peserta123`

## Catatan
- `database_id` di `wrangler.toml` memakai ID `lms-db` dari proyek lama; sesuaikan bila DB berbeda.
- Endpoint & aturan keamanan tidak berubah; lihat `SECURITY.md`.
