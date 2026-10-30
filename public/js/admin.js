// ============================================================
// ADMIN DASHBOARD — /?admin
// ============================================================
// [KEAMANAN + BUG] Versi lama memanggil db.all('users')/courseSvc.
// participantsOf(...) dkk secara SINKRON padahal db.js versi Worker
// sudah async (mengembalikan Promise) — bug laten yang membuat
// Dashboard Admin berpotensi rusak di produksi (lihat mooc-api/
// SECURITY.md temuan RENDAH 10). Sekaligus, `db.all('users')`
// mengunduh SELURUH tabel users (dulu termasuk password plaintext) ke
// browser admin hanya untuk dihitung jumlahnya per peran.
//
// Versi ini memakai SATU panggilan teragregasi (db.adminStats() ->
// /api?view=admin-stats, admin-only) yang sudah menghitung semuanya di
// server dan tidak pernah mengembalikan passwordHash sama sekali.
// ============================================================
web.routes.admin = 'resolveAdminDashboard';

components.statGrid = (d) => `
    <div class="row page4 artikel">
        <div class="stat-grid ">
            ${(d.stats || []).map(s => `
                <div class="stat-card">
                    <div class="stat-value">${escHtml(s.value)}</div>
                    <div class="stat-label">${escHtml(s.label)}</div>
                </div>`).join('')}
        </div>
    </div>`;

components.barChart = (d) => {
    const items  = d.items || [];
    const max    = Math.max(100, ...items.map(i => i.value));
    const barH   = 28, gap = 10, leftW = 170, chartW = 380, topPad = 10;
    const height = items.length * (barH + gap) + topPad || (barH + topPad);

    const bars = items.map((it, i) => {
        const y = topPad + i * (barH + gap);
        const w = max ? (it.value / max) * chartW : 0;
        return `
            <text x="0" y="${y + barH / 2}" class="chart-label" text-anchor="start">${escHtml(it.label)}</text>
            <rect x="${leftW}" y="${y}" width="${w}" height="${barH}" class="chart-bar" rx="4"></rect>
            <text x="${leftW + w + 8}" y="${y + barH / 2}" class="chart-value">${it.value}%</text>`;
    }).join('');

    return `
        <div class="row page4 artikel">
            <h3>${escHtml(d.title || '')}</h3>
            <div class="chart-wrap">
                ${items.length
                    ? `<svg class="chart-svg" viewBox="0 0 ${leftW + chartW + 60} ${height}">${bars}</svg>`
                    : '<p>Belum ada data progress untuk ditampilkan.</p>'}
            </div>
        </div>`;
};

const adminAction = {
    bukaTambahAkun() {
        web.openFormFromPage(adminView.formTambahAkun());
    },

    async jadikanDosen(userId) {
        if (!confirm('Ubah peran akun ini menjadi Dosen?')) return;
        const ok = await auth.guardApi(() => db.adminSetRole(userId, 'dosen'));
        if (!ok) return;
        alert('Peran akun berhasil diubah menjadi Dosen.');
        web.navigate('admin');
    },

    async submitTambahAkun(form) {
        const username = form.querySelector('[name="username"]').value.trim().toLowerCase();
        const password = form.querySelector('[name="password"]').value;
        const name     = form.querySelector('[name="name"]').value.trim();
        const role     = form.querySelector('[name="role"]').value;
        if (!username || !password || !name || !role) { alert('Semua field wajib diisi.'); return; }

        // Validasi username/duplikasi/kekuatan password sekarang
        // ditegakkan ULANG di SERVER (lihat ?view=admin-create-account) —
        // pesan errornya (mis. "Username sudah dipakai") ditampilkan apa
        // adanya lewat auth.guardApi.
        const ok = await auth.guardApi(() => db.adminCreateAccount({ username, password, name, role }));
        if (!ok) return;
        alert('Akun berhasil dibuat.');
        web.navigate('admin');
    }
};

const adminView = {
    formTambahAkun() {
        return [
            { section: 'titleHero', title: 'Tambah Akun Baru' },
            {
                section: 'article',
                leftCol: { subtitle: '', lines: ['link:&laquo; Kembali ke Dashboard Admin:admin'] },
                rightCol: {
                    subtitle: 'Detail Akun',
                    fields: [
                        { type: 'text',     name: 'username', label: 'Username', required: true,
                          placeholder: 'mis: budi123' },
                        { type: 'password', name: 'password', label: 'Password (min. 8 karakter)', required: true },
                        { type: 'text',     name: 'name',     label: 'Nama Lengkap', required: true },
                        { type: 'select',   name: 'role',     label: 'Peran', value: 'peserta', required: true,
                          options: [
                              { value: 'peserta', label: 'Peserta' },
                              { value: 'dosen',   label: 'Dosen' },
                              { value: 'admin',   label: 'Admin' }
                          ] }
                    ],
                    submitText: 'Simpan Akun',
                    onSubmit: 'event.preventDefault(); adminAction.submitTambahAkun(this);',
                    lines: ['form:']
                }
            }
        ];
    }
};

web.resolveAdminDashboard = async function (subParam) {
    const user = auth.currentUser();
    if (!user) {
        return [
            { section: 'titleHero', title: 'Dashboard Admin', description: 'Silakan masuk terlebih dahulu.' },
            { section: 'article',
              leftCol: { subtitle: '', lines: ['link:Ke Halaman Masuk:login'] },
              rightCol: { subtitle: '', lines: [] } }
        ];
    }
    if (user.role !== 'admin') {
        return [{ section: 'titleHero', title: 'Akses Ditolak', description: 'Halaman ini khusus untuk peran Admin.' }];
    }
    if (subParam === 'tambahakun') return adminView.formTambahAkun();

    const stats = await auth.guardApi(() => db.adminStats());
    if (!stats) return [];
    const { users, courses: list, quizzes, quizAttempts, progress } = stats;

    const jumlahDosen   = users.filter(u => u.role === 'dosen').length;
    const jumlahPeserta = users.filter(u => u.role === 'peserta').length;
    const jumlahSertifikat = Object.keys(pages.certificates || {}).length; // sertifikat kuis dihitung server bila diperlukan terpisah
    const jumlahKuis    = quizzes.length;
    const avgQuizScore  = quizAttempts.length
        ? Math.round(quizAttempts.reduce((a, b) => a + Number(b.score || 0), 0) / quizAttempts.length) : 0;

    const perCourse = list.map(c => {
        const rows = progress.filter(p => p.slug === c.slug);
        const totalMateri = (c.categories || []).flatMap(cat => cat.items || []).length
            + ((pages[c.slug]?.categories) || []).flatMap(cat => cat.items || []).length;
        const avg = (rows.length && totalMateri)
            ? Math.round(rows.reduce((a, p) => a + p.viewedCount, 0) / (rows.length * totalMateri) * 100) : 0;
        return { label: c.title, value: avg };
    });
    const avgProgress = perCourse.length
        ? Math.round(perCourse.reduce((a, c) => a + c.value, 0) / perCourse.length) : 0;

    return [
        { section: 'titleHero', title: 'Dashboard Admin',
          description: `Ringkasan platform untuk <strong>${escHtml(user.name)}</strong>.` },
        { section: 'statGrid', stats: [
            { label: 'Jumlah Kursus', value: list.length },
            { label: 'Jumlah Peserta', value: jumlahPeserta },
            { label: 'Jumlah Dosen', value: jumlahDosen },
            { label: 'Jumlah Kuis', value: jumlahKuis },
            { label: 'Rata-rata Skor Kuis', value: avgQuizScore + '%' },
            { label: 'Sertifikat (statis)', value: jumlahSertifikat },
            { label: 'Rata-rata Progress', value: avgProgress + '%' }
        ]},
        { section: 'barChart', title: 'Progress Rata-rata per Kursus', items: perCourse },
        {
            section: 'articleFull',
            subtitle: 'Daftar Kursus',
            lines: [
                'link:Kelola lewat Dashboard Dosen:dosen', '---',
                ...(list.length
                    ? [`table:${JSON.stringify(list.map(c => ({
                          Kursus: c.title, Instruktur: c.instructor, Periode: c.period,
                          Aksi: `<a href="javascript:void(0)" onclick="web.navigate('dosen/modul:${c.slug}')">Modul</a> ·
                                 <a href="javascript:void(0)" onclick="dosenAction.bukaEditKursus('${c.slug}')">Edit</a> ·
                                 <a href="javascript:void(0)" onclick="dosenAction.hapusKursus('${c.slug}')">Hapus</a>`
                      })))}`]
                    : ['Belum ada kursus.'])
            ]
        },
        {
            section: 'articleFull',
            subtitle: 'Akun Terdaftar',
            lines: [
                '<button type="button" class="slcBtn" onclick="adminAction.bukaTambahAkun()">+ Tambah Akun Baru</button>',
                '---',
                ...(users.length
                    ? [`table:${JSON.stringify(users.map(u => ({
                          Nama: u.name, Username: u.username, Peran: u.role,
                          Aksi: u.role === 'peserta'
                              ? `<a href="javascript:void(0)" onclick="adminAction.jadikanDosen('${u.id}')">Jadikan Dosen</a>`
                              : '-'
                      })))}`]
                    : ['Belum ada akun.'])
            ]
        }
    ];
};
