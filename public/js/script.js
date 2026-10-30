// ============================================================
// [KEAMANAN] escHtml / safeUrl — mooc-app lama TIDAK PUNYA fungsi
// escape HTML sama sekali (lihat mooc-app-fixed/SECURITY.md temuan
// SEDANG 7): judul/deskripsi kursus, nama akun, dll disisipkan
// langsung ke innerHTML lewat template string. Dosen/peserta bisa
// mengisi field teks apa pun dengan payload HTML/JS dan itu
// tereksekusi di sesi pengunjung lain (stored XSS). Dua fungsi ini
// dipakai di SETIAP titik yang menyisipkan data pengguna ke HTML di
// bawah — pola sama dengan cms-app (escHtml/safeUrl di engine.js).
// ============================================================
function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
function safeUrl(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (/^(javascript|data|vbscript|file):/i.test(v)) return '';
    return v;
}

function pagesToFileFormat(pagesObj) {
    return Object.entries(pagesObj)
        .map(([key, val]) => `pages.${key} = ${JSON.stringify(val, null, 4)};`)
        .join('\n\n');
}

// Fungsi untuk mengubah **teks** menjadi <strong>teks</strong>
const formatText = (text) => {
    if (typeof text !== 'string') return text;
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
};

const web = {

    // Definisi rute: slug -> nama fungsi resolver di objek `web`.
    // Slug yang TIDAK terdaftar di sini otomatis ditangani oleh resolveContent()
    // (langsung membaca pages[slug] tanpa logika tambahan) — jadi menambah
    // halaman statis baru cukup dengan menambah pages.namahalaman, tanpa
    // menyentuh routing sama sekali.
    routes: {
        cert:      'resolveCertificate',
        // 'learn' SENGAJA tidak didaftarkan di sini — halaman ini sekarang
        // adalah katalog statis biasa (pages.learn, section 'courseCatalog'),
        // jadi otomatis ditangani oleh resolveContent() (lihat komentar di
        // atas objek `routes`). Materi tiap kursus punya slug sendiri:
        // Kursus baru cukup didaftarkan di sini + di `courses` (dataset.js) —
        // resolveLearningModule sudah generik, membaca pages[slug] sesuai
        // slug yang dipanggil (lihat parameter kedua di bawah).
        rpl:       'resolveLearningModule',
        pbo:       'resolveLearningModule',
        robotika:  'resolveLearningModule',
        dashboard: 'resolveDashboard',
        settings:  'resolveSettings',
        editor:    'resolveEditor'
    },

    gebi: (id) => document.getElementById(id),

    // [DEDUP] Helper aktif key — dipakai oleh updateDataset & downloadPage
    _activeKey: function() {
        return this.gebi('page-select')?.value
            || (typeof pageFiles !== 'undefined' ? pageFiles[0] : Object.keys(pages)[0]);
    },

    // ============================================================
    // FORM DRAWER — panel geser dari kanan, dipakai ULANG oleh SEMUA
    // form tambah/edit (dosen.js, admin.js, quiz.js) supaya dosen/admin
    // tidak perlu pindah halaman hanya untuk mengisi 1 form. Markup
    // statis-nya ada di index.html (#formDrawerOverlay/#formDrawerPanel);
    // di sini hanya logika buka/tutup + render kontennya lewat komponen
    // form yang SUDAH ADA (components.genericForm) — jadi TIDAK ada
    // duplikasi cara merender field (text/select/textarea, dst).
    // ============================================================

    /** Buka drawer dari config form mentah: { title, fields, onSubmit, submitText, ... }
     *  (persis format `rightCol` pada section 'article' yang sudah dipakai di seluruh app). */
    openDrawer: function(cfg) {
        const overlay = this.gebi('formDrawerOverlay');
        const panel   = this.gebi('formDrawerPanel');
        const titleEl = this.gebi('formDrawerTitle');
        const bodyEl  = this.gebi('formDrawerBody');
        if (!overlay || !panel || !bodyEl || !cfg) return;

        titleEl.textContent = cfg.title || cfg.subtitle || 'Form';
        bodyEl.innerHTML = components.genericForm(cfg);

        overlay.classList.add('open');
        panel.classList.add('open');
        document.body.classList.add('drawer-lock');
    },

    closeDrawer: function() {
        this.gebi('formDrawerOverlay')?.classList.remove('open');
        this.gebi('formDrawerPanel')?.classList.remove('open');
        document.body.classList.remove('drawer-lock');
    },

    // ============================================================
    // MODUL DRAWER — "Daftar Modul" pada halaman kursus (section
    // 'learningModule'). Dipisah dari FORM DRAWER di atas karena
    // isinya bukan form melainkan navigasi antar materi, tapi memakai
    // pola buka/tutup + markup statis yang identik (lihat index.html:
    // #modulDrawerOverlay/#modulDrawerPanel). Data kategori diambil
    // langsung dari pages[slug].categories — sama seperti versi sidebar
    // yang digantikannya — supaya tidak perlu meneruskan HTML lewat
    // atribut onclick (rawan masalah escaping tanda kutip).
    // ============================================================
    openModulDrawer: function(slug, activeId) {
        const overlay = this.gebi('modulDrawerOverlay');
        const panel   = this.gebi('modulDrawerPanel');
        const bodyEl  = this.gebi('modulDrawerBody');
        if (!overlay || !panel || !bodyEl) return;

        // [KEAMANAN] cat.name/item.title bisa berasal dari materi tambahan
        // yang diisi DOSEN (courseSvc.addMaterial) — di-escape. item.id
        // dibentuk oleh server (genId, pola 'materi_...') jadi aman
        // disisipkan ke onclick, tapi tetap dibersihkan dari kutip sebagai
        // pertahanan berlapis.
        const categories = (pages[slug] && pages[slug].categories) || [];
        bodyEl.innerHTML = categories.map(cat => `
            <div class="cat-box"><strong>${escHtml(cat.name)}</strong>
            <ul>${(cat.items || []).map(item => {
                const safeId = String(item.id).replace(/[^a-zA-Z0-9_-]/g, '');
                return `<li><a href="javascript:void(0)"
                    class="${item.id === activeId ? 'active' : ''}"
                    onclick="web.navigate('${slug}/${safeId}'); web.closeModulDrawer();">${escHtml(item.title)}</a></li>`;
            }).join('')}</ul></div>`).join('');

        overlay.classList.add('open');
        panel.classList.add('open');
        document.body.classList.add('drawer-lock');
    },

    closeModulDrawer: function() {
        this.gebi('modulDrawerOverlay')?.classList.remove('open');
        this.gebi('modulDrawerPanel')?.classList.remove('open');
        document.body.classList.remove('drawer-lock');
    },

    // ============================================================
    // UNDUH SERTIFIKAT SEBAGAI PDF — menangkap elemen `.cert-border`
    // (desain HTML/CSS yang SUDAH ADA, lihat components.certificate)
    // apa adanya lewat html2canvas, lalu membungkusnya jadi 1 file PDF
    // dengan jsPDF. SENGAJA tidak memakai aset PNG/PDF template
    // terpisah — satu sumber tampilan (CSS) tetap dipakai untuk layar,
    // cetak (window.print), maupun unduhan PDF ini.
    // ============================================================
    downloadCertificatePDF: function(elId, certId, btn) {
        const el = this.gebi(elId);
        if (!el) { alert('Elemen sertifikat tidak ditemukan.'); return; }
        if (typeof html2canvas === 'undefined' || !window.jspdf) {
            alert('Fitur unduh PDF butuh koneksi internet (memuat html2canvas/jsPDF dari CDN).');
            return;
        }

        const originalLabel = btn ? btn.textContent : null;
        if (btn) { btn.disabled = true; btn.textContent = 'Menyiapkan PDF...'; }

        html2canvas(el, {
            scale: 2,               // resolusi lebih tinggi supaya tidak pecah saat dicetak
            backgroundColor: '#ffffff',
            // Tombol Cetak/Unduh ikut berada di dalam .cert-border, tapi
            // TIDAK boleh ikut tertangkap ke dalam PDF — cukup skip lewat
            // class yang sama dipakai @media print (.no-print), tanpa
            // perlu menyembunyikan/menampilkan elemen secara manual.
            ignoreElements: (node) => node.classList && node.classList.contains('no-print')
        }).then((canvas) => {
            const { jsPDF } = window.jspdf;
            // Ukuran halaman PDF dibuat PAS mengikuti ukuran hasil tangkapan
            // (unit 'px'), supaya sertifikat tidak terpotong/melar seperti
            // dipaksakan ke ukuran kertas standar (A4, dll).
            const pdf = new jsPDF({
                orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`Sertifikat-${certId}.pdf`);
        }).catch((err) => {
            console.error(err);
            alert('Gagal membuat PDF. Coba lagi.');
        }).finally(() => {
            if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
        });
    },

    /**
     * [DEDUP] Jembatan generik: ambil `rightCol` (config form) dari hasil
     * resolver halaman yang SUDAH ADA (mis. dosenView.formEditKursus(...))
     * lalu buka lewat drawer — TANPA menuliskan ulang daftar field di
     * tempat lain. Kalau resolver mengembalikan penolakan akses (tidak
     * ada section 'article', hanya titleHero), tampilkan pesannya lewat
     * alert alih-alih membuka drawer kosong.
     */
    openFormFromPage: function(pageResult, opts = {}) {
        const blocks = Array.isArray(pageResult) ? pageResult : [];
        const heroTitle = blocks.find(b => b.section === 'titleHero')?.title;
        const articleBlock = blocks.find(b => b.section === 'article');

        if (!articleBlock || !articleBlock.rightCol || !articleBlock.rightCol.fields) {
            // opts.silent: dipakai oleh auto-open drawer (lihat
            // AUTO_DRAWER_ROUTES di navigate() di bawah) — halaman yang
            // TIDAK sedang menampilkan form (mis. "Anda sudah masuk") itu
            // kondisi normal, bukan kegagalan yang perlu di-alert().
            if (opts.silent) return;
            const heroDesc = blocks.find(b => b.section === 'titleHero')?.description || '';
            alert((heroTitle || 'Tidak dapat membuka form') +
                  (heroDesc ? '\n' + heroDesc.replace(/<[^>]+>/g, '') : ''));
            return;
        }

        this.openDrawer({ ...articleBlock.rightCol, title: opts.title || heroTitle || articleBlock.rightCol.subtitle });
    },

    // ============================================================
    // [DRAWER] Rute yang FORM-nya selalu dibuka otomatis lewat drawer
    // kanan begitu halamannya dinavigasi — memenuhi permintaan "semua
    // form ada dalam drawer" untuk alur akun (masuk/daftar/lupa-
    // password/reset-password/pengaturan profil), konsisten dengan pola
    // yang SUDAH ADA untuk form dosen/admin/kuis. Halaman di baliknya
    // (leftCol: info akun demo, tautan, dst.) tetap tampil sebagai latar
    // — dibangun lewat resolver YANG SAMA persis (auth.js), TIDAK ada
    // duplikasi field antara halaman & drawer.
    // ============================================================
    AUTO_DRAWER_ROUTES: new Set(['login', 'daftar', 'lupa-password', 'reset-password', 'settings']),

    // [PATCH D1] async: beberapa resolver (resolveLearningModule,
    // resolveDosenDashboard, resolveKuisDashboard, resolveCertificate)
    // sekarang async karena menunggu Worker API (db.js versi D1) —
    // jadi hasilnya (bisa berupa array ATAU Promise<array>) di-await di
    // sini dengan `await Promise.resolve(...)`, supaya resolver LAMA yang
    // masih sinkron (resolveContent, resolveSettings, dst.) tetap jalan
    // tanpa perubahan apa pun. ui.render juga di-await (lihat patchnya)
    // karena components.courseCatalog kini bisa async juga.
    navigate: async function(slug) {
        this.closeDrawer(); // [DEDUP] pindah halaman APAPUN otomatis menutup drawer yang terbuka
        const queryString = window.location.search.substring(1);
        const currentPath = slug || queryString || 'home';
        const [targetSlug, subParam] = currentPath.split('/');

        let pageData = [];
        const resolverName = this.routes[targetSlug];

        if (typeof this[resolverName] === 'function') {
            // targetSlug diteruskan sebagai argumen ke-2 agar resolver generik
            // (mis. resolveLearningModule) tahu kursus mana yang diminta.
            pageData = await Promise.resolve(this[resolverName](subParam, targetSlug));
        } else {
            pageData = this.resolveContent(targetSlug, subParam);
        }

        await ui.render('content', pageData);

        // [DRAWER] Buka otomatis kalau rute ini termasuk alur akun (lihat
        // AUTO_DRAWER_ROUTES di atas) — `silent:true` supaya kondisi
        // "form tidak ada karena sudah masuk" tidak memunculkan alert.
        if (this.AUTO_DRAWER_ROUTES.has(targetSlug)) {
            this.openFormFromPage(pageData, { silent: true });
        }

        if (slug !== undefined) {
            window.history.pushState({ path: currentPath }, '', `?${currentPath}`);
        }
        document.title = `DonatJS | ${targetSlug.toUpperCase()}`;
        window.scrollTo(0, 0);
        if (typeof svg?.di === 'function') svg.di();

        web.gebi('navLinks')?.classList.remove('active');
        return false;
    },

    resolveContent: function(category, subId) {
        const fullData = pages[category] || pages['home'];
        if (!Array.isArray(fullData)) return fullData;

        if (subId) {
            // Strip ?tab=xxx atau query string apapun dari subId
            const cleanId = subId.split('?')[0];

            const subContent = fullData.find(item => item.id === cleanId);
            if (subContent) return [subContent];

            // Fallback ke id:'default' jika ada di dataset kategori ini
            const fallback = fullData.find(item => item.id === 'default');
            if (fallback) return [fallback];

            // Fallback akhir: pesan generik
            return [{ section: 'titleHero', title: 'Konten Tidak Ditemukan',
                      description: `ID <strong>${cleanId}</strong> tidak tersedia.` }];
        } else {
            // Mode daftar: sembunyikan semua item yang punya id (termasuk 'default')
            return fullData.filter(item => !item.id);
        }
    },

    /**
     * [PATCH CERT-FIX]
     * resolveCertificate — membaca pages.certificates (object lookup)
     * Jika ditemukan → render komponen certificate
     * Jika tidak     → render halaman form verifikasi (pages.cert)
     */
    resolveCertificate: function(id) {
        if (id) {
            const data = pages.certificates?.[id] || null;
            return data
                ? [{ section: 'certificate', id, ...data }]
                : [{ section: 'titleHero', title: 'Sertifikat Tidak Ditemukan',
                     description: `ID <strong>${id}</strong> tidak terdaftar dalam sistem kami.` }];
        }
        // Tanpa ID → tampilkan halaman form verifikasi
        return pages.cert || [{ section: 'titleHero', title: 'Verifikasi Sertifikat' }];
    },

    resolveLearningModule: function(id, slug = 'rpl') {
        let raw = pages[slug];
        if (Array.isArray(raw)) raw = raw[0] || {};
        if (!raw || typeof raw !== 'object') raw = {};

        const categories = raw.categories || [];
        const allItems   = categories.flatMap(cat => cat.items || []);
        const defaultId  = allItems[0]?.id || '';
        const activeId   = id || defaultId;
        const exists     = allItems.some(i => i.id === activeId);

        // Judul halaman diambil dari registry `courses` (dataset.js) bila ada,
        // supaya tiap kursus tampil dengan nama yang benar tanpa hardcode.
        const courseMeta = (typeof courses !== 'undefined')
            ? courses.find(c => c.slug === slug) : null;

        // Catat modul terakhir yang dilihat — dibaca kembali oleh resolveDashboard()
        if (exists) {
            localStorage.setItem('slsLastModule', activeId);

            // Catat progress PER KURSUS — dipakai oleh resolveDashboard() untuk
            // menampilkan "Kursus yang Diikuti" & "Progress Kursus". Disimpan
            // di localStorage (client-first, tanpa backend), key: slsProgress.
            const progress = JSON.parse(localStorage.getItem('slsProgress') || '{}');
            const entry = progress[slug] || { viewed: [] };
            if (!entry.viewed.includes(activeId)) entry.viewed.push(activeId);
            entry.lastId = activeId;
            progress[slug] = entry;
            localStorage.setItem('slsProgress', JSON.stringify(progress));
        }

        return [
            {
                section: 'titleHero',
                title:   exists ? (courseMeta?.title || 'Learning Module') : 'Modul Tidak Ditemukan'
            },
            {
                section:  'learningModule',
                activeId: exists ? activeId : defaultId,
                slug:     slug,
                data:     raw
            }
        ];
    },

    /**
     * resolveDashboard — ringkasan progres belajar peserta: kursus yang
     * diikuti, progress tiap kursus, dan sertifikat yang diperoleh.
     * Data diambil dari localStorage (client-first, tanpa backend).
     * Tidak ada komponen baru: progress bar pakai 'skill:' dan daftar
     * sertifikat pakai 'table:' — keduanya sudah ada di lineRenderer.
     */
    resolveDashboard: function() {
        const profile   = JSON.parse(localStorage.getItem('slsProfile')  || '{}');
        const progress  = JSON.parse(localStorage.getItem('slsProgress') || '{}');
        const name      = profile.name || 'Peserta';
        const quizScore = localStorage.getItem('slsQuizScore') || 'Belum ada';
        const lastModule = localStorage.getItem('slsLastModule') || 'Belum ada';
        const courseList = (typeof courses !== 'undefined') ? courses : [];

        // --- Kursus yang diikuti + progress -------------------------------
        // "Diikuti" = kursus yang sudah punya progress tersimpan (pernah
        // membuka minimal 1 modul). Jumlah materi per kursus dihitung dari
        // pages[slug].categories — sama seperti yang dipakai courseCatalog.
        const enrolledSlugs = Object.keys(progress);
        const progressLines = enrolledSlugs.length
            ? enrolledSlugs.map(slug => {
                const meta   = courseList.find(c => c.slug === slug);
                const total  = (pages[slug]?.categories || []).flatMap(cat => cat.items || []).length;
                const viewed = (progress[slug].viewed || []).length;
                const pct    = total ? Math.round((viewed / total) * 100) : 0;
                return `skill:${pct}%:${meta?.title || slug}:${viewed}/${total} modul`;
              })
            : ['Anda belum mengikuti kursus apa pun.', 'link:Lihat Katalog Kursus:learn'];

        // --- Sertifikat yang diperoleh -------------------------------------
        // Dicocokkan dari registry pages.certificates (dataset.js/cert.js)
        // berdasarkan nama pemilik sertifikat == nama di profil peserta.
        const myCerts = Object.entries(pages.certificates || {})
            .filter(([id, c]) => profile.name && c.name.trim().toLowerCase() === profile.name.trim().toLowerCase())
            .map(([id, c]) => ({ Kode: id, Ujian: c.exam, Skor: c.score, Tanggal: c.date }));

        return [
            { section: 'titleHero', title: 'Dashboard',
              description: `Selamat datang kembali, <strong>${name}</strong>.` },
            {
                section: 'article',
                leftCol: {
                    subtitle: 'Kursus Diikuti & Progress',
                    lines: progressLines
                },
                rightCol: {
                    subtitle: 'Sertifikat Diperoleh',
                    lines: myCerts.length
                        ? [`table:${JSON.stringify(myCerts)}`]
                        : [
                            'Belum ada sertifikat atas nama Anda.',
                            'Pastikan **Nama** di Pengaturan Profil sama dengan nama pada sertifikat.',
                            'link:Verifikasi Sertifikat:cert'
                          ]
                }
            },
            {
                section: 'article',
                rightCol: {
                    subtitle: 'Ringkasan Lainnya',
                    lines: [
                        `card:Modul Terakhir Dilihat:${lastModule}`,
                        `card:Skor Kuis Terakhir:${quizScore}`
                    ]
                },
                leftCol: {
                    subtitle: 'Aksi Cepat',
                    lines: [
                        'link:Lihat Katalog Kursus:learn',
                        '---',
                        'link:Kerjakan Kuis:kuis',
                        '---',
                        'link:Verifikasi Sertifikat:cert',
                        '---',
                        'link:Pengaturan Profil:settings',
                        '---'
                    ]
                }
            }
        ];
    },

    /**
     * resolveSettings — form profil sederhana (nama, email, notifikasi).
     * Disimpan ke localStorage lewat web.saveProfile(). Memakai komponen
     * yang sudah ada: titleHero + article + genericForm (lewat 'form:').
     */
    resolveSettings: function() {
        const profile = JSON.parse(localStorage.getItem('slsProfile') || '{}');

        return [
            { section: 'titleHero', title: 'Pengaturan / Profil',
              description: 'Kelola informasi akun Anda.' },
            {
                section: 'article',
                leftCol: {
                    subtitle: 'Info',

                    lines: [
                        'link:Lihat Katalog Kursus:learn',
                        '---',
                        'link:Kerjakan Kuis:kuis',
                        '---',
                        'link:Verifikasi Sertifikat:cert',
                        '---',
                        'link:Pengaturan Profil:settings',
                        '---'

                    ]
                                    },
                rightCol: {
                    subtitle: 'Profil Saya',
                    fields: [
                        { type: 'text',   name: 'name',  id: 'set-name',  label: 'Nama Lengkap',
                          value: profile.name  || '', placeholder: 'Nama Anda', required: true },
                        { type: 'email',  name: 'email', id: 'set-email', label: 'Email',
                          value: profile.email || '', placeholder: 'nama@email.com' },
                        { type: 'select', name: 'notif', id: 'set-notif', label: 'Notifikasi Email',
                          value: profile.notif || 'on',
                          options: [{ value: 'on', label: 'Aktifkan' }, { value: 'off', label: 'Matikan' }] }
                    ],
                    submitText: 'Simpan Perubahan',
                    onSubmit:   'event.preventDefault(); web.saveProfile(this);',
                    lines: ['form:']
                }
            }
        ];
    },

    /** Simpan form profil ke localStorage, lalu kembali ke Dashboard */
    saveProfile: function(form) {
        const data = {
            name:  form.querySelector('[name="name"]')?.value.trim()  || '',
            email: form.querySelector('[name="email"]')?.value.trim() || '',
            notif: form.querySelector('[name="notif"]')?.value        || 'on'
        };
        localStorage.setItem('slsProfile', JSON.stringify(data));
        alert('Profil berhasil disimpan.');
        this.navigate('dashboard');
    },

    evaluateQuiz: function(form, questions) {
        const score = questions.reduce((acc, q, idx) => {
            const selected = form.querySelector(`input[name="q${idx}"]:checked`);
            return (selected && btoa(selected.value) === q.ans) ? acc + 1 : acc;
        }, 0);
        const finalScore = (score / questions.length) * 100;
        localStorage.setItem('slsQuizScore', finalScore.toFixed(2));
        alert(`Ujian Selesai!\nSkor Anda: ${finalScore.toFixed(2)}`);
        this.navigate('dashboard');
    },

    // -------------------------------------------------------
    // Editor Tools
    // -------------------------------------------------------

    /** Load halaman tertentu ke textarea editor */
    loadPageToEditor: function(key) {
        const el = web.gebi('json-input');
        if (!el) return;
        el.value = `pages.${key} = ${JSON.stringify(pages[key], null, 4)};`;
    },

    /** Render editor dengan select halaman */
    resolveEditor: function() {
        const key = this._activeKey();
        return [{
            section: 'editor',
            json: `pages.${key} = ${JSON.stringify(pages[key], null, 4)};`
        }];
    },

    /** Eval isi editor → update pages global → preview halaman aktif */
    updateDataset: function() {
        try {
            const input     = web.gebi('json-input').value;
            const tempPages = {};
            const sandbox   = new Function('pages', input);
            sandbox(tempPages);
            Object.assign(pages, tempPages);

            const key = this._activeKey();
            const el  = web.gebi('preview-area');
            el.innerHTML = (pages[key] || [])
                .map(d => components[d.section]?.(d) || '')
                .join('');
        } catch(e) { alert('JS Error: ' + e.message); }
    },

    /** Download semua halaman dalam satu dataset.js */
    downloadDataset: function() {
        const data = pagesToFileFormat(pages);
        const blob = new Blob([data], { type: 'application/javascript' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = 'dataset.js';
        a.click();
    },

    /** Download halaman yang sedang aktif di select */
    downloadPage: function() {
        const key  = this._activeKey();
        const data = `pages.${key} = ${JSON.stringify(pages[key], null, 4)};`;
        const blob = new Blob([data], { type: 'application/javascript' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `${key}.js`;
        a.click();
    }
};


const components = {

    lineRenderer: (lines = [], context = {}) => {
        const data = Array.isArray(lines) ? lines : [];
        let inCodeBlock = false; // Tracker state untuk code block

        const handlers = {
          // --- Gambar ---
                     // Sintaks: image:https://url/gambar.jpg
                     // Opsional caption: image:https://url/gambar.jpg|Judul gambar
          'image:': (val) => {
               const [src, caption] = val.split('|').map(s => s.trim());
               const cap = caption
                   ? `<figcaption style="font-size:12px;color:var(--sv-text-dim);margin-top:6px;text-align:center;">${escHtml(caption)}</figcaption>`
                   : '';
               return `<figure style="margin:16px 0;width:100%;">
                   <img src="${safeUrl(src)}" alt="${escHtml(caption || '')}"
                        style="width:100%;height:auto;border-radius:6px;display:block;border:1px solid var(--sv-border);"
                        loading="lazy" onerror="this.style.display='none'">
                   ${cap}
               </figure>`;
           },

           // --- PDF Embed ---
           // Sintaks: pdf:https://url/dokumen.pdf
           // Opsional tinggi: pdf:https://url/dokumen.pdf|600
           'pdf:': (val) => {
               const [rawSrc, height] = val.split('|').map(s => s.trim());
               const src = safeUrl(rawSrc);
               const h = parseInt(height) || 480;
               return `<div style="width:100%;margin:16px 0;">
                   <iframe src="${src}"
                           style="width:100%;height:${h}px;border:1px solid var(--sv-border);border-radius:6px;display:block;background:#fff;"
                           title="PDF Viewer"
                           loading="lazy">
                       <p>Browser tidak mendukung PDF embed.
                          <a href="${src}" target="_blank" style="color:var(--aColor);">Buka PDF &rarr;</a>
                       </p>
                   </iframe>
               </div>`;
           },

           // --- Video ---
           // Sintaks: video:https://url/video.mp4          (file langsung)
           //          video:youtube:VIDEO_ID                (YouTube embed)
           //          video:vimeo:VIDEO_ID                  (Vimeo embed)
           // Opsional tinggi: video:https://...mp4|360
           'video:': (val) => {
               const [src, height] = val.split('|').map(s => s.trim());
               const h = parseInt(height) || 360;

               // YouTube
               const ytMatch = src.match(/^youtube:([\w-]+)$/);
               if (ytMatch) {
                   return `<div style="width:100%;margin:16px 0;position:relative;padding-bottom:${h}px;height:0;">
                       <iframe src="https://www.youtube.com/embed/${ytMatch[1]}"
                               style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:6px;"
                               allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"
                               allowfullscreen loading="lazy">
                       </iframe>
                   </div>`;
               }

               // Vimeo
               const vimeoMatch = src.match(/^vimeo:(\d+)$/);
               if (vimeoMatch) {
                   return `<div style="width:100%;margin:16px 0;position:relative;padding-bottom:${h}px;height:0;">
                       <iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}"
                               style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:6px;"
                               allow="autoplay;fullscreen;picture-in-picture"
                               allowfullscreen loading="lazy">
                       </iframe>
                   </div>`;
               }

               // File video langsung (mp4, webm, ogg)
               const safeSrc = safeUrl(src);
               const ext = src.split('.').pop().split('?')[0].toLowerCase();
               const mime = { mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg' }[ext] || 'video/mp4';
               return `<div style="width:100%;margin:16px 0;">
                   <video controls style="width:100%;height:auto;max-height:${h}px;border-radius:6px;display:block;border:1px solid var(--sv-border);background:#000;">
                       <source src="${safeSrc}" type="${mime}">
                       Browser tidak mendukung video HTML5.
                       <a href="${safeSrc}" target="_blank" style="color:var(--aColor);">Unduh video &rarr;</a>
                   </video>
               </div>`;
           },

            'form:validate-cert': () => `
                <div class="card-input">
                    <p>Masukkan nomor kredensial:</p>
                    <input type="text" id="cert-input" placeholder="SLS-2026-XXX" style="width:200px">
                    <button class="slcBtn" onclick="
                        const v = web.gebi('cert-input').value.trim();
                        v ? web.navigate('cert/' + v) : alert('Isi Kode Sertifikat!');
                    ">Verifikasi</button>
                </div>`,
            'form:quiz': () => components.quizEngine(context),
            'form:': (val) => {
                if (val) {
                    try { const inlineCtx = JSON.parse(val); return components.genericForm(inlineCtx); }
                    catch(e) { return components.genericForm(context); }
                }
                return components.genericForm(context);
            },
            'link:': (val) => {
                const parts = val.split(':');
                const target = parts.slice(1).join(':').replace(/'/g, '');
                return `<a href="javascript:void(0)" onclick="web.navigate('${target}')" class="inline-link">${escHtml(parts[0])} &raquo;</a>`;
            },
            // [KEAMANAN] label/text/title/content di sini bisa berasal dari
            // judul kursus atau nama modul buatan DOSEN (mis. baris
            // 'skill:' di Dashboard — lihat auth.js buildPortfolioData) —
            // di-escape supaya judul kursus tidak bisa menyuntik HTML ke
            // Dashboard peserta lain yang melihatnya.
            'skill:': (val) => {
                const [percent, label, text] = val.split(':');
                return `<div class="skill-item">
                    <div class="skill-info"><strong>${escHtml(label)}</strong> ${escHtml(text || '')} <small>(${escHtml(percent)})</small></div>
                    <div class="skill-track"><div class="skill-fill" style="width:${encodeURIComponent(percent)}"></div></div>
                </div>`;
            },
            'step:': (val) => {
                const [time, title, desc] = val.split(':');
                return `<div class="tl-item"><div class="tl-year">${escHtml(time)}</div><div><strong>${escHtml(title)}</strong></div><div>${escHtml(desc || '')}</div></div>`;
            },
            'card:': (val) => {
                const [title, content] = val.split(':');
                return `<div class="info-card"><strong>${escHtml(title)}</strong><p>${escHtml(content)}</p></div>`;
            },
            'table:': (val) => {
                let dataTable = null;
                if (val) {
                    if (context[val] && Array.isArray(context[val])) dataTable = context[val];
                    else { try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) dataTable = parsed; } catch(e) { return `<div class="info-card">⚠ Format tabel salah</div>`; } }
                }
                if (!dataTable?.length) return '';
                return components.renderTable(dataTable, context.tableOpts || {});
            },
            'contact:': (val) => {
                const [icon, label, info, link] = val.split('|');
                return `<div class="contact-item"><i class="${icon} img-32"></i><strong>${label}</strong><br>${link ? `<a href="${link}" target="_blank">${info}</a>` : info}</div>`;
            },
            'slide:': (val) => components.slideViewer({ slideKey: val.trim() }),
            'badge:': (val) => `<span class="badge">${val}</span>`,
            '### ':   (val) => `<h3>${val}</h3>`,
            '## ':    (val) => `<h2>${val}</h2>`,
            '---':    ()    => '<hr>'
        };

        // [DEDUP] Baris 'card:' yang BERURUTAN otomatis digabung dalam SATU
        // wrapper '.info-card-row' (grid CSS yang SUDAH ADA di style.css)
        // supaya kartu-kartunya SAMA TINGGI — CSS Grid meregangkan semua
        // item dalam 1 baris secara otomatis. Sebelumnya tiap 'card:'
        // dirender lepas satu-satu sehingga jatuh ke rule `.artikel
        // .info-card` biasa (display: inline-block, tinggi ikut isi
        // masing-masing) dan TIDAK PERNAH sama tinggi kalau isinya beda
        // panjang. 1 'card:' berdiri sendiri tetap dibungkus wrapper yang
        // sama — grid 1 kolom tidak mengubah tampilannya, jadi aman.
        const out = [];
        let cardBuffer = [];
        const flushCards = () => {
            if (!cardBuffer.length) return;
            out.push(`<div class="info-card-row">${cardBuffer.join('')}</div>`);
            cardBuffer = [];
        };

        data.forEach(line => {
            // 1. Deteksi pembuka/penutup Code Block (```)
            if (line.trim().startsWith('```')) {
                flushCards();
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    out.push('<pre class="sv-code"><code>'); // Buka tag code
                } else {
                    inCodeBlock = false;
                    out.push('</code></pre>'); // Tutup tag code
                }
                return;
            }

            // 2. Jika sedang di dalam area Code Block, bypass parsing komponen lain
            if (inCodeBlock) {
                out.push(line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '\n');
                return;
            }

            // 3. Parsing normal jika di luar code block
            let html = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            if (html.startsWith('card:')) {
                cardBuffer.push(handlers['card:'](html.replace('card:', '').trim()));
                return;
            }
            flushCards();

            for (const [key, handler] of Object.entries(handlers)) {
                if (html.startsWith(key)) { out.push(handler(html.replace(key, '').trim())); return; }
            }
            out.push(`<div>${html}</div>`);
        });
        flushCards();

        return out.join('');
    },

    genericForm: (ctx) => {
        const fields = (ctx.fields || []).map(f => {
            const fid  = f.id   ? `id="${escHtml(f.id)}"` : '';
            // [KEAMANAN] fval/ph/label di-escape — sebelumnya disisipkan
            // apa adanya ke atribut HTML (mis. value="${fval}"), jadi
            // value pra-isi yang mengandung `">` bisa keluar dari atribut
            // dan menyisipkan tag/atribut baru (mis. onload=...).
            const fval = f.value !== undefined ? escHtml(String(f.value)) : '';
            const req  = f.required ? 'required' : '';
            const ph   = f.placeholder ? `placeholder="${escHtml(f.placeholder)}"` : '';

            // Hidden: tidak butuh label atau wrapper
            if (f.type === 'hidden')
                return `<input type="hidden" ${fid} value="${fval}">`;

            const starMark = f.required
                ? ' <span style="color:var(--orange,#f90)">*</span>' : '';
            const label = f.label
                ? `<label class="a-label">${escHtml(f.label)}${starMark}</label>` : '';

            let input;
            const fname = f.name ? `name="${escHtml(f.name)}"` : '';

            if (f.type === 'select') {
                const opts = (f.options || []).map(o => {
                    const v   = typeof o === 'object' ? o.value : o;
                    const l   = typeof o === 'object' ? o.label  : o;
                    const sel = fval == escHtml(String(v)) ? 'selected' : '';
                    return `<option value="${escHtml(v)}" ${sel}>${escHtml(l)}</option>`;
                }).join('');
                input = `<select ${fid} ${fname} ${req}><option value="">— pilih —</option>${opts}</select>`;
            } else if (f.type === 'textarea') {
                input = `<textarea ${fid} ${fname} rows="${f.rows || 4}" ${ph} ${req}>${fval}</textarea>`;
            } else {
                input = `<input type="${f.type || 'text'}" ${fid} ${fname} value="${fval}" ${ph} ${req}>`;
            }
            return `<div class="a-row">${label}${input}</div>`;
        }).join('');

        const onSubmit  = ctx.onSubmit || "event.preventDefault(); alert('Pesan Terkirim!')";
        const submitBtn = ctx.noSubmitBtn
            ? ''
            : `<button type="submit" class="slcBtn">${ctx.submitText || 'Kirim'}</button>`;

        return `<form class="${ctx.wrapClass || 'dynamic-form'}" onsubmit="${onSubmit}">
            ${fields}
            ${submitBtn}
        </form>`;
    },

    // [KEAMANAN] Versi bawaan ini SELALU ditimpa oleh quiz.js (lihat
    // "OVERRIDE — components.quizEngine" di quiz.js) — dibiarkan sebagai
    // stub aman (bukan implementasi lama yang membandingkan password &
    // kunci jawaban DI BROWSER) supaya kalau suatu saat quiz.js gagal
    // dimuat, halaman tidak diam-diam jatuh kembali ke kode yang bocor.
    quizEngine: () => `<div class="info-card">Modul kuis belum termuat. Muat ulang halaman.</div>`,

    // titleHero.description & hero.description TETAP dirender sebagai
    // HTML (bukan di-escape) SECARA SENGAJA — keduanya HANYA diisi oleh
    // konten statis dari pages/*.js (developer, bukan input pengguna) di
    // sebagian besar halaman. Untuk 1 pengecualian yang datang dari
    // input pengguna/dosen (deskripsi kursus di web.resolveLearningModule,
    // deskripsi kuis, dst.) — lihat courses.js/dosen.js — pemanggilnya
    // WAJIB membungkusnya dengan escHtml() SEBELUM membentuk `d.title`/
    // `d.description` di sini. title tetap teks polos (escHtml) supaya
    // tag <h1> tidak pernah bisa "pecah" dari nama akun/judul kursus.
    titleHero: (d) => `
        <div class="row page">
            <div class="artikel">
                <h1>${escHtml(d.title)}</h1>
                ${d.description ? `<p>${d.description}</p>` : ''}
            </div>
        </div>`,

    hero: (d) => {
        const media = d.img
            ? `<img src="${safeUrl(d.img)}" alt="${escHtml(d.title)}" class="img-hero">`
            : d.imgClass
                ? `<i style="max-width:300px;" class="${escHtml(d.imgClass)} kanan img"></i>`
                : '';
        return `
            <div class="row page hero">
                <div class="col-2-3 artikel">
                    <h1>${escHtml(d.title)}</h1><br>
                    <em>${escHtml(d.tagline)}</em> &mdash; ${d.description}<br><br>
                    ${d.badges.map(b => `<span class="badge">${escHtml(b)}</span>`).join(' ')}
                    <br><br>
                    <a href="?${encodeURIComponent(d.cta.link)}" onclick="event.preventDefault(); web.navigate('${escHtml(d.cta.link)}')" class="btn-cta">${escHtml(d.cta.text)}</a>
                </div>
                <div class="col-1-3 artikel">
                    ${media}
                </div>
            </div>`;
    },

    features: (d) => `
        <div class="row gading">
            ${(d.items || []).map(item => `
                <div class="col-1-3 artikel">
                    <i class="${item.icon} simg"></i>
                    <span class="judul">${formatText(item.title)}</span><br>
                    <p>${formatText(item.content)}</p>
                    <a href="javascript:void(0)" onclick="web.navigate('${item.linkTarget}')">
                        ${item.linkText}
                    </a>
                </div>`).join('')}
        </div>`,

    article: (d) => `
        <div class="row page4">
            <div class="col-1-3 artikel">
                ${d.leftCol.subtitle ? `<h2>${d.leftCol.subtitle}</h2><hr>` : ''}
                ${components.lineRenderer(d.leftCol.lines || [], d.leftCol)}
            </div>
            <div class="col-2-3 artikel">
                ${d.rightCol.subtitle ? `<h2>${d.rightCol.subtitle}</h2><hr>` : ''}
                ${components.lineRenderer(d.rightCol.lines || [], d.rightCol)}
            </div>
        </div>`,

    /**
     * articleFull — varian 'article' SATU KOLOM lebar penuh (tanpa kolom
     * kiri/kanan). Dipakai kalau suatu bagian halaman butuh lebar penuh,
     * mis. tabel besar atau daftar panjang, tanpa dipaksa ke rasio 1/3-2/3
     * seperti 'article'. Pemakaian sama seperti leftCol/rightCol pada
     * 'article' (langsung { subtitle, lines }), memakai ulang lineRenderer
     * yang sama supaya semua sintaks (table:, form:, link:, dst) tetap
     * berfungsi sama persis — cukup:
     *   { section: 'articleFull', subtitle: 'Judul', lines: [...] }
     */
    articleFull: (d) => `
        <div class="row page4">
            <div class="col-1-1 artikel">
                ${d.subtitle ? `<h2>${d.subtitle}</h2><hr>` : ''}
                ${components.lineRenderer(d.lines || [], d)}
            </div>
        </div>`,

    learningModule: (d) => {
        const slug = d.slug || 'rpl'; // fallback demi kompatibilitas mundur
        const categories = d.data.categories || [];
        let activeContent = { title: 'Materi', lines: ['Pilih materi di samping.'] };
        categories.forEach(cat => {
            const found = cat.items.find(i => i.id === d.activeId);
            if (found) activeContent = found;
        });
        // "Daftar Modul" dipindah ke modul-drawer (geser dari kanan, lihat
        // web.openModulDrawer() & #modulDrawerPanel di index.html) supaya
        // halaman materi bisa tampil satu kolom penuh (col-1-1) alih-alih
        // dibagi sidebar (col-1-3) + konten (col-2-3) seperti sebelumnya.
        return `
            <div class="row page4">
                <div class="col-1-1 artikel content">
                    <div class="module-toolbar">
                        <button type="button" class="slcBtn modul-drawer-trigger"
                            onclick="web.openModulDrawer('${slug}', '${d.activeId}')">
                            &#9776; Daftar Modul
                        </button>
                    </div>
                    <h2>${escHtml(activeContent.title)}</h2><hr>
                    <div class="module-body">${components.lineRenderer(activeContent.lines || [], activeContent)}</div>
                </div>
            </div>`;
    },

    /**
     * courseCatalog — merender card kursus di Home secara otomatis.
     * Sumber data: array `courses` (dataset.js) — jumlah card SELALU
     * mengikuti courses.length (tidak dihardcode), dan jumlah materi
     * tiap kursus dihitung langsung dari pages[slug].categories.
     * Menambah kursus baru = menambah 1 baris di `courses`, tanpa
     * menyentuh fungsi ini sama sekali.
     */
    courseCatalog: (d) => {
        const list = (typeof courses !== 'undefined') ? courses : [];
        return `
        <div class="row page4">
        <div class="artikel">
                ${d.title ? `<h2>${d.title}</h2>` : ''}
                ${d.description ? `<p>${d.description}</p>` : ''}
                <p class="course-count">${list.length} kursus tersedia</p>
                <div class="course-grid">
                    ${list.map(c => {
                        const raw = pages[c.slug] || {};
                        const materiCount = (raw.categories || [])
                            .flatMap(cat => cat.items || []).length;
                        return `
                        <div class="course-card">
                            <h3>${c.title}</h3>
                            <p>${c.description}</p>
                            <ul class="course-meta">
                                <li><strong>Harga:</strong> ${c.price}</li>
                                <li><strong>Instruktur:</strong> ${c.instructor}</li>
                                <li><strong>Periode:</strong> ${c.period}</li>
                                <li><strong>Materi:</strong> ${materiCount} modul</li>
                            </ul>
                            <a href="javascript:void(0)" class="slcBtn"
                               onclick="web.navigate('${c.slug}')">Enroll</a>
                        </div>`;
                    }).join('')}
                    </div>
                    </div>
            </div>`;
    },

    // [KEAMANAN] `rawKeys`: daftar nama kolom yang isinya MEMANG HTML
    // (kolom "Aksi" — tautan/tombol yang kita rakit sendiri di
    // dosen.js/admin.js/quiz.js, bukan input pengguna). Semua kolom LAIN
    // di-escape sebagai teks polos — sebelumnya SEMUA sel dirender apa
    // adanya (`<td>${row[k]}</td>`), jadi mis. nama peserta atau judul
    // kursus yang mengandung HTML akan tereksekusi di tabel manapun ia
    // tampil (Dashboard Admin, daftar peserta dosen, dst).
    renderTable: (dataTable, opts = {}) => {
        if (!dataTable?.length) return '';
        const allKeys  = Object.keys(dataTable[0]);
        const hidden   = new Set(opts.hiddenKeys || []);
        const keys     = opts.visibleKeys
            ? opts.visibleKeys.filter(k => !hidden.has(k))
            : allKeys.filter(k => !hidden.has(k));
        const labels   = opts.labels || {};
        const startIdx = opts.startIdx || 0;
        const rawKeys  = new Set(opts.rawKeys || ['Aksi']);

        const head = keys.map(k =>
            `<th>${escHtml(labels[k] || k.toUpperCase())}</th>`
        ).join('');

        const body = dataTable.map((row, i) => {
            const cells = keys.map(k => `<td>${rawKeys.has(k) ? (row[k] ?? '') : escHtml(row[k] ?? '')}</td>`).join('');
            const idx   = startIdx + i;
            const click = opts.onRowClick
                ? `onclick="${opts.onRowClick.replace(/\{i\}/g, idx)}" class="crud-row" title="Klik untuk edit"`
                : '';
            return `<tr ${click}>${cells}</tr>`;
        }).join('') || `<tr><td colspan="${keys.length}" style="text-align:center;color:var(--aColor)">Tidak ada data.</td></tr>`;

        return `<div class="table-container"><table>
            <thead><tr>${head}</tr></thead>
            <tbody>${body}</tbody>
        </table></div>`;
    },

    /**
     * slideViewer: Komponen presentasi DonatJS
     */
    slideViewer: (d) => {
        const data = (typeof slideData !== 'undefined') ? slideData[d.slideKey] : null;
        if (!data) return `<div class="info-card"><strong>Slide tidak ditemukan:</strong> ${d.slideKey}</div>`;

        const renderSlideBody = (s) => {
            if (s.type === 'text')  return `<p class="sv-body">${s.body}</p>`;
            if (s.type === 'code')  return `<p class="sv-body">${s.body}</p><pre class="sv-code">${s.code}</pre>`;
            if (s.type === 'cards') return `<p class="sv-body">${s.body}</p>
                <div class="sv-cards">${(s.items || []).map(c =>
                    `<div class="sv-card"><div class="sv-card-l">${c.l}</div><div class="sv-card-v">${c.v}</div></div>`
                ).join('')}</div>`;
            if (s.type === 'list')  return `<p class="sv-body">${s.body}</p>
                <ul class="sv-list">${(s.items || []).map(i =>
                    `<li class="${s.lc || ''}">${i}</li>`
                ).join('')}</ul>`;
            return `<p class="sv-body">${s.body}</p>`;
        };

        const uid = 'sv_' + d.slideKey.replace(/-/g, '_');

        return `
<div class="sv-wrap" id="${uid}">
  <div class="sv-topbar">
    <span class="sv-title-label">${data.title}</span>
    <div class="sv-prep-bar">
      <span class="sv-ps sv-ph-p sv-ps-active" id="${uid}_ps_p">P·Point</span>
      <span class="sv-ps sv-ph-r"              id="${uid}_ps_r">R·Reason</span>
      <span class="sv-ps sv-ph-e"              id="${uid}_ps_e">E·Example</span>
      <span class="sv-ps sv-ph-p2"             id="${uid}_ps_p2">P·Point</span>
    </div>
  </div>
  <div class="sv-stage" id="${uid}_stage">
    ${data.slides.map((s, i) => `
    <div class="sv-slide${i === 0 ? ' sv-active' : ''}" data-idx="${i}" data-phase="${s.phase}">
      <div class="sv-phase-label sv-ph-${s.phase}">${s.label} — ${s.phase.toUpperCase()}</div>
      <h2 class="sv-h2">${s.title}</h2>
      <div class="sv-scroll">${renderSlideBody(s)}</div>
      <div class="sv-num">${String(i + 1).padStart(2, '0')} / ${String(data.slides.length).padStart(2, '0')}</div>
    </div>`).join('')}
  </div>
  <div class="sv-nav">
    <button class="sv-btn" id="${uid}_prev" onclick="svNav('${uid}',-1)" disabled>&#8592;</button>
    <div class="sv-dots" id="${uid}_dots">
      ${data.slides.map((_, i) =>
          `<div class="sv-dot${i === 0 ? ' sv-dot-active' : ''}" onclick="svGoto('${uid}',${i})"></div>`
      ).join('')}
    </div>
    <span class="sv-counter" id="${uid}_counter">1 / ${data.slides.length}</span>
    <button class="sv-btn" id="${uid}_next" onclick="svNav('${uid}',1)"${data.slides.length <= 1 ? ' disabled' : ''}>&#8594;</button>
  </div>
</div>`;
    },

    /**
     * [PATCH CERT-FIX] Komponen tampilan sertifikat
     */
    // [KEAMANAN] d.name = nama profil PESERTA (bisa diubah bebas lewat
    // Pengaturan Profil) dan d.exam = judul kuis (bisa diubah DOSEN) —
    // keduanya input pengguna, ditampilkan di halaman verifikasi PUBLIK
    // (/?cert/<id>, tanpa login). Sebelumnya disisipkan apa adanya —
    // siapa pun bisa mendaftar, mengisi nama profil dengan payload HTML/
    // JS, lulus 1 kuis, lalu membagikan tautan sertifikatnya sebagai
    // stored XSS ke siapa pun yang membuka tautan itu. Di-escape semua.
    certificate: (d) => `
        <div class="row page">
            <div class="cert-border" id="cert-capture-${d.id}">
                <i class="di-sls img-64"></i>
                <h1>SERTIFIKAT HASIL UJIAN</h1><hr>
                <p>Diberikan kepada:</p>
                <h2 class="cert-name">${escHtml(d.name)}</h2>
                <p>Materi: <b>${escHtml(d.exam)}</b></p>
                <div class="cert-score">SKOR: ${escHtml(d.score)}</div>
                <p>Tanggal: ${escHtml(d.date)}</p>
                <small>ID: ${escHtml(d.id)}</small><br><br>
                <div class="cert-actions no-print">
                    <button class="slcBtn" onclick="window.print()">Cetak</button>
                    <button class="slcBtn" onclick="web.downloadCertificatePDF('cert-capture-${d.id}','${d.id}',this)">Unduh PDF</button>
                </div>
            </div>
        </div>`,

    editor: (d) => `
        <div class="row page">
            <div class="row">
                <h3>Dataset Editor</h3>
                <div style="margin-bottom:10px; display:flex; gap:8px; align-items:center;">
                    <label>Halaman:</label>
                    <select id="page-select"
                        onchange="web.loadPageToEditor(this.value)"
                        style="padding:6px 10px; font-size:14px;">
                        ${(typeof pageFiles !== 'undefined' ? pageFiles : Object.keys(pages))
                            .map(key => `<option value="${key}">${key.charAt(0).toUpperCase() + key.slice(1)}</option>`)
                            .join('')}
                    </select>
                </div>
                <textarea id="json-input"
                    style="width:100%; height:400px; font-family:monospace; padding:10px;"
                >${d.json}</textarea>
                <button class="slcBtn" onclick="web.updateDataset()">Update Preview</button>
                <button class="slcBtn" style="background:#555;" onclick="web.downloadDataset()">Download dataset.js</button>
                <button class="slcBtn" style="background:#555;" onclick="web.downloadPage()">Download halaman</button>
            </div>
            <div class="row">
                <h3>Preview</h3>
                <div id="preview-area" style="background:#fff; padding:20px; border:1px solid #ccc; min-height:400px;"></div>
            </div>
        </div>`
};


// ============================================================
// UI — Render Engine
// ============================================================

const ui = {
    // [PATCH D1] async: components.courseCatalog sekarang async (courses.js),
    // sisanya (titleHero, article, dst.) tetap sinkron seperti semula.
    // Promise.resolve() membungkus KEDUANYA secara seragam supaya baris ini
    // tidak perlu tahu komponen mana yang async dan mana yang tidak.
    render: async (id, dataArray) => {
        const el = web.gebi(id);
        if (el && Array.isArray(dataArray)) {
            const rendered = await Promise.all(
                dataArray.map(d => Promise.resolve(components[d.section]?.(d) || ''))
            );
            el.innerHTML = rendered.join('');
        }
    }
};


// ============================================================
// SLIDE VIEWER — Navigasi Global
// ============================================================

function svRender(uid, idx) {
    const stage = document.getElementById(uid + '_stage');
    if (!stage) return;
    const slides = stage.querySelectorAll('.sv-slide');
    const total  = slides.length;

    slides.forEach((s, i) => {
        s.classList.remove('sv-active', 'sv-exit-left', 'sv-exit-right');
        if (i === idx) s.classList.add('sv-active');
    });

    const dots = document.querySelectorAll('#' + uid + '_dots .sv-dot');
    dots.forEach((d, i) => d.classList.toggle('sv-dot-active', i === idx));

    const counter = document.getElementById(uid + '_counter');
    if (counter) counter.textContent = `${idx + 1} / ${total}`;

    const prevBtn = document.getElementById(uid + '_prev');
    const nextBtn = document.getElementById(uid + '_next');
    if (prevBtn) prevBtn.disabled = idx === 0;
    if (nextBtn) nextBtn.disabled = idx === total - 1;

    const phase = slides[idx]?.dataset?.phase || 'p';
    ['p', 'r', 'e', 'p2'].forEach(ph => {
        const el = document.getElementById(uid + '_ps_' + ph);
        if (el) el.classList.toggle('sv-ps-active', ph === phase);
    });

    stage.dataset.cur = idx;
}

function svNav(uid, dir) {
    const stage = document.getElementById(uid + '_stage');
    if (!stage) return;
    const cur      = parseInt(stage.dataset.cur || '0');
    const total    = stage.querySelectorAll('.sv-slide').length;
    const nextIdx  = Math.max(0, Math.min(total - 1, cur + dir));
    if (nextIdx !== cur) svRender(uid, nextIdx);
}

function svGoto(uid, idx) {
    svRender(uid, idx);
}


window.addEventListener('load',     () => web.navigate());
window.addEventListener('popstate', () => web.navigate());

// Tutup form drawer dengan tombol Escape (di samping klik overlay/tombol Tutup).
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') web.closeDrawer?.();
});

document.addEventListener('click', (e) => {
    const burger = web.gebi('burgerBtn');
    const nav    = web.gebi('navLinks');
    if (burger?.contains(e.target)) {
        nav.classList.toggle('active');
        e.stopPropagation();
    } else if (nav?.classList.contains('active') && !nav.contains(e.target)) {
        nav.classList.remove('active');
    }
});
