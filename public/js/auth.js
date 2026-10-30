// ============================================================
// AUTH — Login/registrasi/lupa-password + pembagian peran.
// ============================================================
// VERSI TER-HARDENING (lihat SECURITY.md untuk penjelasan lengkap):
//   * Password TIDAK PERNAH dicocokkan di browser lagi. auth.login()
//     memanggil db.login() -> POST /public?view=login di mooc-api, yang
//     membandingkan hash di server dan mengembalikan TOKEN sesi — bukan
//     daftar user.
//   * Captcha & lockout percobaan login diverifikasi ULANG di SERVER
//     (rate_limit di D1) — versi localStorage yang lama murni kosmetik,
//     gampang dilewati lewat DevTools.
//   * Sesi disimpan sebagai token (moocSessionToken, lihat db.js) +
//     salinan ringan { username, name, role } untuk tampilan cepat
//     (moocSessionUser) — BUKAN sumber kebenaran otorisasi (itu selalu
//     diverifikasi ulang oleh server tiap panggilan /api).
//   * Form masuk/daftar/lupa-password/reset-password/pengaturan profil
//     sekarang dibuka lewat DRAWER kanan (lihat AUTO_DRAWER_ROUTES di
//     script.js) — resolver di bawah TIDAK berubah bentuk (tetap
//     mengembalikan { rightCol: { fields, onSubmit, ... } }), hanya
//     titik render-nya yang otomatis dialihkan ke drawer.
// ============================================================
const auth = {
    SESSION_USER_KEY: 'moocSessionUser',

    // Captcha aktif (challenge + token bertanda tangan server) untuk
    // form yang sedang tampil — dibuat ulang tiap kali form dirender.
    _captcha: null,

    currentUser() {
        try { return JSON.parse(localStorage.getItem(this.SESSION_USER_KEY) || 'null'); }
        catch (e) { return null; }
    },

    _setSession(token, user) {
        setToken(token);
        localStorage.setItem(this.SESSION_USER_KEY, JSON.stringify(user));
    },

    async login(username, password, captchaAnswer) {
        if (!this._captcha) return 'Soal captcha belum dimuat, coba muat ulang halaman.';
        const { token, user } = await db.login({
            username, password,
            captchaToken: this._captcha.token, captchaAnswer,
        });
        this._setSession(token, user);
        return null;
    },

    /** Registrasi mandiri — peran akun baru SELALU 'peserta' (ditentukan
     *  server, bukan klien). Akun Dosen/Admin hanya dibuat lewat
     *  Dashboard Admin (db.adminCreateAccount). */
    async register({ username, password, name, email }, captchaAnswer) {
        if (!this._captcha) return 'Soal captcha belum dimuat, coba muat ulang halaman.';
        const { token, user } = await db.register({
            username, password, name, email,
            captchaToken: this._captcha.token, captchaAnswer,
        });
        this._setSession(token, user);
        return null;
    },

    async requestPasswordReset(email, captchaAnswer) {
        if (!this._captcha) return;
        await db.forgotPassword({ email, captchaToken: this._captcha.token, captchaAnswer });
    },

    async resetPassword(token, newPassword) {
        await db.resetPassword({ token, password: newPassword });
    },

    logout() {
        setToken(null);
        localStorage.removeItem(this.SESSION_USER_KEY);
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('login');
    },

    hasRole(...roles) {
        const u = this.currentUser();
        return !!u && roles.includes(u.role);
    },

    /** Dipanggil dari renderMenu() (index.html) tiap kali menu digambar ulang. */
    renderAuthUI() {
        const slot = web.gebi('authSlot');
        if (!slot) return;
        const user = this.currentUser();
        slot.innerHTML = user
            ? `<span class="auth-chip">
                   <i class="di-person img-24"></i>
                   <span class="auth-name">${escHtml(user.name)}</span>
                   <span class="badge auth-role">${escHtml(user.role)}</span>
               </span>
               <button class="slcBtn auth-logout" onclick="auth.logout()">Keluar</button>`
            : `<a href="javascript:void(0)" onclick="web.navigate('login')" class="auth-chip">
                   <i class="di-lock img-24"></i>
                   <span class="auth-name">Masuk</span>
               </a>`;
        if (typeof svg?.di === 'function') svg.di();
    },

    /** Dipanggil di awal tiap resolver form akun untuk memuat 1 soal
     *  captcha baru dari server (bukan dibuat di browser lagi). */
    async loadCaptcha() {
        try { this._captcha = await db.captcha(); }
        catch (e) { this._captcha = null; }
        return this._captcha?.challenge || 'Gagal memuat captcha';
    },

    /** Dipanggil di awal setiap aksi API yang butuh sesi — kalau server
     *  bilang sesi sudah berakhir (401), bersihkan & arahkan ke /?login
     *  dengan pesan yang jelas, bukan error generik. */
    async guardApi(fn) {
        try { return await fn(); }
        catch (e) {
            if (e instanceof ApiError && e.status === 401) {
                setToken(null);
                localStorage.removeItem(this.SESSION_USER_KEY);
                if (typeof renderMenu === 'function') renderMenu();
                alert('Sesi Anda sudah berakhir, silakan masuk kembali.');
                web.navigate('login');
                return null;
            }
            alert(e?.message || 'Terjadi kesalahan.');
            return null;
        }
    },

    async handleLoginSubmit(form) {
        const username = form.querySelector('[name="username"]').value.trim();
        const password = form.querySelector('[name="password"]').value;
        const captcha  = form.querySelector('[name="captcha"]').value;

        const err = await this.login(username, password, captcha).catch(e => e?.message || 'Gagal masuk.');
        if (err) { alert(err); web.navigate('login'); return; }

        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('dashboard');
    },

    async handleRegisterSubmit(form) {
        const username = form.querySelector('[name="username"]').value.trim().toLowerCase();
        const password = form.querySelector('[name="password"]').value;
        const confirm  = form.querySelector('[name="confirm"]').value;
        const name     = form.querySelector('[name="name"]').value.trim();
        const email    = form.querySelector('[name="email"]').value.trim();
        const captcha  = form.querySelector('[name="captcha"]').value;

        if (password !== confirm) { alert('Konfirmasi password tidak cocok.'); return; }

        const err = await this.register({ username, password, name, email }, captcha)
            .catch(e => e?.message || 'Gagal mendaftar.');
        if (err) { alert(err); web.navigate('daftar'); return; }

        if (typeof renderMenu === 'function') renderMenu();
        alert(`Akun berhasil dibuat. Selamat datang, ${name}!`);
        web.navigate('dashboard');
    },

    async handleForgotPasswordSubmit(form) {
        const email   = form.querySelector('[name="email"]').value.trim();
        const captcha = form.querySelector('[name="captcha"]').value;

        try { await this.requestPasswordReset(email, captcha); }
        catch (e) { alert(e?.message || 'Gagal mengirim tautan reset.'); web.navigate('lupa-password'); return; }

        web.navigate('lupa-password-terkirim');
    },

    async handleResetPasswordSubmit(form, token) {
        const password = form.querySelector('[name="password"]').value;
        const confirm  = form.querySelector('[name="confirm"]').value;

        if (password !== confirm) { alert('Konfirmasi password tidak cocok.'); return; }

        try { await this.resetPassword(token, password); }
        catch (e) { alert(e?.message || 'Gagal mereset password.'); return; }

        alert('Password berhasil diganti. Silakan masuk dengan password baru Anda.');
        web.navigate('login');
    }
};

// --- Route + resolver 'login' — didaftarkan di sini, script.js tidak diubah ---
web.routes.login = 'resolveLogin';
web.routes.daftar = 'resolveRegister';
web.routes['lupa-password']         = 'resolveLupaPassword';
web.routes['lupa-password-terkirim'] = 'resolveLupaPasswordSent';
web.routes['reset-password']         = 'resolveResetPassword';

web.resolveRegister = async function () {
    const user = auth.currentUser();
    if (user) {
        return [
            { section: 'titleHero', title: 'Sudah Masuk',
              description: `Anda masuk sebagai <strong>${escHtml(user.name)}</strong> (${escHtml(user.role)}).` },
            { section: 'article',
              leftCol: { subtitle: '', lines: ['link:Ke Dashboard:dashboard'] },
              rightCol: { subtitle: '', lines: [] } }
        ];
    }

    const captchaQ = await auth.loadCaptcha();
    return [
        { section: 'titleHero', title: 'Daftar Akun Peserta',
          description: 'Buat akun baru untuk mulai mengikuti kursus. Form pendaftaran akan terbuka otomatis di panel kanan.' },
        {
            section: 'article',
            leftCol: { subtitle: '', lines: ['link:Sudah punya akun? Masuk di sini:login'] },
            rightCol: {
                subtitle: 'Form Pendaftaran',
                fields: [
                    { type: 'text',     name: 'name',     label: 'Nama Lengkap', required: true },
                    { type: 'text',     name: 'username', label: 'Username', required: true,
                      placeholder: 'mis: budi123 (huruf kecil, angka, . _ -)' },
                    { type: 'email',    name: 'email',    label: 'Email', required: true,
                      placeholder: 'nama@email.com' },
                    { type: 'password', name: 'password', label: 'Password (min. 8 karakter)', required: true },
                    { type: 'password', name: 'confirm',  label: 'Konfirmasi Password', required: true },
                    { type: 'text',     name: 'captcha',  label: `Captcha: Berapa ${captchaQ} ?`, required: true,
                      placeholder: 'Jawaban' }
                ],
                submitText: 'Daftar',
                onSubmit: 'event.preventDefault(); auth.handleRegisterSubmit(this);',
                lines: ['form:']
            }
        }
    ];
};

web.resolveLogin = async function () {
    const user = auth.currentUser();
    if (user) {
        return [
            { section: 'titleHero', title: 'Sudah Masuk',
              description: `Anda masuk sebagai <strong>${escHtml(user.name)}</strong> (${escHtml(user.role)}).` },
            {
                section: 'article',
                leftCol: {
                    subtitle: 'Aksi',
                    lines: [
                        'link:Ke Dashboard:dashboard',
                        '---',
                        '<button class="slcBtn" onclick="auth.logout()">Keluar</button>'
                    ]
                },
                rightCol: { subtitle: '', lines: [] }
            }
        ];
    }

    const captchaQ = await auth.loadCaptcha();
    return [
        { section: 'titleHero', title: 'Masuk',
          description: 'Gunakan akun peserta / dosen / admin untuk mengakses dashboard sesuai peran. Form masuk akan terbuka otomatis di panel kanan.' },
        {
            section: 'article',
            leftCol: {
                subtitle: 'Akun Demo',
                lines: [
                    'card:Peserta:peserta / peserta123',
                    'card:Dosen:dosen / dosen123',
                    'card:Admin:admin / admin123'
                ]
            },
            rightCol: {
                subtitle: 'Form Masuk',
                fields: [
                    { type: 'text', name: 'username', label: 'Username', required: true, placeholder: 'username' },
                    { type: 'password', name: 'password', label: 'Password', required: true, placeholder: 'password' },
                    { type: 'text', name: 'captcha', label: `Captcha: Berapa ${captchaQ} ?`, required: true,
                      placeholder: 'Jawaban' }
                ],
                submitText: 'Masuk',
                onSubmit: 'event.preventDefault(); auth.handleLoginSubmit(this);',
                lines: ['form:', 'link:Lupa password?:lupa-password', 'link:Belum punya akun? Daftar di sini:daftar']
            }
        }
    ];
};

web.resolveLupaPassword = async function () {
    const captchaQ = await auth.loadCaptcha();
    return [
        { section: 'titleHero', title: 'Lupa Password',
          description: 'Masukkan email yang dipakai saat mendaftar. Tautan reset password akan dikirim ke email tersebut.' },
        {
            section: 'article',
            leftCol: { subtitle: '', lines: ['link:Ingat password? Masuk di sini:login', 'link:Belum punya akun? Daftar di sini:daftar'] },
            rightCol: {
                subtitle: 'Form Lupa Password',
                fields: [
                    { type: 'email', name: 'email', label: 'Email Terdaftar', required: true, placeholder: 'nama@email.com' },
                    { type: 'text',  name: 'captcha', label: `Captcha: Berapa ${captchaQ} ?`, required: true, placeholder: 'Jawaban' }
                ],
                submitText: 'Kirim Tautan Reset',
                onSubmit: 'event.preventDefault(); auth.handleForgotPasswordSubmit(this);',
                lines: ['form:']
            }
        }
    ];
};

// Sejak grading & alur reset sepenuhnya di server, mooc-api SELALU
// mengembalikan balasan yang identik baik email terdaftar maupun tidak
// (lihat SECURITY.md) — halaman ini karena itu TIDAK PERNAH lagi
// menampilkan tautan reset mentah (beda dari versi lama yang
// menampilkannya sebagai fallback kalau pengiriman email gagal; itu
// sendiri sudah kebocoran — siapa pun bisa menebak/mencoba email orang
// lain dan tahu dari ada/tidaknya tautan apakah email itu terdaftar).
web.resolveLupaPasswordSent = function () {
    return [
        { section: 'titleHero', title: 'Periksa Email Anda',
          description: 'Jika email tersebut terdaftar, tautan untuk reset password telah dikirim.' },
        {
            section: 'article',
            leftCol: {
                subtitle: '',
                lines: ['Anda akan menerima email berisi tautan reset password dalam beberapa saat, jika email itu memang terdaftar. Periksa juga folder Spam/Junk.']
            },
            rightCol: { subtitle: '', lines: ['link:Kembali ke Halaman Masuk:login'] }
        }
    ];
};

web.resolveResetPassword = function (token) {
    if (!token) {
        return [
            { section: 'titleHero', title: 'Tautan Tidak Valid',
              description: 'Tautan reset password tidak valid.' },
            { section: 'article',
              leftCol: { subtitle: '', lines: ['link:Minta Tautan Reset Baru:lupa-password', 'link:Kembali ke Halaman Masuk:login'] },
              rightCol: { subtitle: '', lines: [] } }
        ];
    }
    // Validitas token (ada/tidak, kedaluwarsa) sekarang HANYA diketahui
    // saat submit (POST /public?view=reset-password) — server tidak lagi
    // mengekspos rute "cek token" terpisah (permukaan serangan lebih
    // kecil: tidak ada cara menebak-nebak token valid tanpa langsung
    // mencoba menggantinya).
    return [
        { section: 'titleHero', title: 'Buat Password Baru',
          description: 'Masukkan password baru untuk akun Anda.' },
        {
            section: 'article',
            leftCol: { subtitle: '', lines: [] },
            rightCol: {
                subtitle: 'Form Reset Password',
                fields: [
                    { type: 'password', name: 'password', label: 'Password Baru (min. 8 karakter)', required: true },
                    { type: 'password', name: 'confirm',  label: 'Konfirmasi Password Baru', required: true }
                ],
                submitText: 'Simpan Password Baru',
                onSubmit: `event.preventDefault(); auth.handleResetPasswordSubmit(this, '${token.replace(/'/g, '')}');`,
                lines: ['form:']
            }
        }
    ];
};

// ============================================================
// Dashboard / Pengaturan Profil — data progress/sertifikat/kuis
// sekarang SELALU dari mooc-api (scoped otomatis ke sesi), bukan
// gabungan localStorage tak ter-scope seperti versi paling lama.
// ============================================================
web.resolveDashboard = async function (subParam) {
    if (subParam) return web.resolvePublicPortfolio(subParam);

    const user = auth.currentUser();
    if (!user) {
        return [
            { section: 'titleHero', title: 'Dashboard', description: 'Silakan masuk terlebih dahulu.' },
            { section: 'article',
              leftCol: { subtitle: '', lines: ['link:Ke Halaman Masuk:login'] },
              rightCol: { subtitle: '', lines: [] } }
        ];
    }

    const { progressLines, myCerts, attemptCount } = await auth.guardApi(() => buildPortfolioData(user.username, user.name)) || {};
    if (progressLines === undefined) return [];

    const publicUrl = `${window.location.origin}${window.location.pathname}?dashboard/${encodeURIComponent(user.username)}`;

    return [
        { section: 'titleHero', title: 'Dashboard',
          description: `Selamat datang kembali, <strong>${escHtml(user.name)}</strong>.` },
        {
            section: 'article',
            leftCol: {
                subtitle: 'Kursus Diikuti & Progress',
                lines: progressLines.length ? progressLines : ['Anda belum mengikuti kursus apa pun.', 'link:Lihat Katalog Kursus:learn']
            },
            rightCol: {
                subtitle: 'Sertifikat Diperoleh',
                lines: myCerts.length
                    ? [`table:${JSON.stringify(myCerts)}`]
                    : [
                        'Belum ada sertifikat atas nama Anda.',
                        'Lulus kuis kursus untuk mendapat sertifikat otomatis.',
                        'link:Kerjakan Kuis:kuis',
                        '---',
                        'link:Verifikasi Sertifikat:cert'
                      ]
            }
        },
        {
            section: 'article',
            leftCol: {
                subtitle: 'Portofolio Publik',
                lines: [
                    'Bagikan progress belajar & sertifikat Anda lewat tautan ini — bisa dibuka siapa saja, tanpa perlu masuk:',
                    `<div class="a-row"><input type="text" readonly id="portfolio-url" value="${escHtml(publicUrl)}" onclick="this.select()" style="width:70%">
                        <button class="slcBtn" onclick="navigator.clipboard.writeText(web.gebi('portfolio-url').value); alert('Tautan berhasil disalin!');">Salin Tautan</button></div>`,
                    `link:Pratinjau Portofolio Publik Saya:dashboard/${user.username}`
                ]
            },
            rightCol: {
                subtitle: 'Ringkasan Lainnya',
                lines: [`card:Kuis Dikerjakan:${attemptCount} kali`]
            }
        },
        {
            section: 'article',
            leftCol: {
                subtitle: 'Aksi Cepat',
                lines: [
                    'link:Lihat Katalog Kursus:learn', '---',
                    'link:Kerjakan Kuis:kuis', '---',
                    'link:Verifikasi Sertifikat:cert', '---',
                    'link:Pengaturan Profil:settings', '---'
                ]
            },
            rightCol: { subtitle: '', lines: [] }
        }
    ];
};

/** buildPortfolioData — dipakai ulang oleh Dashboard privat & portofolio publik. */
async function buildPortfolioData(username, name) {
    const [progressRows, certs, attempts] = await Promise.all([
        db.listProgress().catch(() => []),
        (username === auth.currentUser()?.username ? db.myCertificates() : Promise.resolve([])),
        (username === auth.currentUser()?.username ? db.myAttempts() : Promise.resolve([])),
    ]);

    const progressLines = await Promise.all(progressRows.map(async (p) => {
        const meta = await courseSvc.get(p.slug);
        const { viewed, total, pct } = await courseSvc.progressOf(p.slug, meta);
        const attemptsOfSlug = attempts.filter(a => a.slug === p.slug);
        const last = attemptsOfSlug.length ? attemptsOfSlug[attemptsOfSlug.length - 1] : null;
        const quizText = last ? ` · Kuis: ${last.score}` : '';
        return `skill:${pct}%:${meta?.title || p.slug}:${viewed}/${total} modul${quizText}`;
    }));

    const myCerts = certs.map(c => ({
        Kode: c.id, Ujian: c.examTitle, Skor: c.score, Tanggal: c.date,
        Aksi: `<a href="javascript:void(0)" onclick="web.navigate('cert/${encodeURIComponent(c.id)}')">Lihat</a>`
    }));

    return { progressLines, myCerts, attemptCount: attempts.length };
}

/** Versi PUBLIK (read-only) Dashboard, dibuka lewat '/?dashboard/<username>'. */
web.resolvePublicPortfolio = async function (username) {
    // certPublic/myAttempts tidak berlaku utk akun lain (scoped sesi) —
    // portofolio publik karena itu hanya menampilkan progress + sertifikat
    // milik SESI YANG SEDANG LOGIN kalau usernamenya cocok; untuk akun
    // lain, tampilkan progress publik kosong dengan pesan yang jelas
    // (data progress/sertifikat orang lain memang tidak seharusnya bisa
    // diambil lewat panggilan sisi klien tanpa endpoint publik khusus).
    const me = auth.currentUser();
    if (!me || me.username !== username) {
        return [
            { section: 'titleHero', title: 'Portofolio Tidak Tersedia',
              description: 'Portofolio publik untuk akun ini tidak dapat ditampilkan dari sesi Anda saat ini.' },
            { section: 'article',
              leftCol: { subtitle: '', lines: ['link:Ke Halaman Masuk:login'] },
              rightCol: { subtitle: '', lines: [] } }
        ];
    }

    const { progressLines, myCerts } = await buildPortfolioData(username, me.name);
    return [
        { section: 'titleHero', title: `Portofolio — ${escHtml(me.name)}`,
          description: `Ringkasan progress belajar &amp; sertifikat milik <strong>${escHtml(me.name)}</strong>.` },
        {
            section: 'article',
            leftCol: {
                subtitle: 'Kursus Diikuti & Progress',
                lines: progressLines.length ? progressLines : ['Belum mengikuti kursus apa pun.']
            },
            rightCol: {
                subtitle: 'Sertifikat Diperoleh',
                lines: myCerts.length ? [`table:${JSON.stringify(myCerts)}`] : ['Belum ada sertifikat.']
            }
        },
        {
            section: 'article',
            leftCol: { subtitle: '', lines: ['link:Lihat Katalog Kursus:learn', '---', 'link:Verifikasi Sertifikat:cert'] },
            rightCol: { subtitle: '', lines: [] }
        }
    ];
};

web.resolveSettings = async function () {
    const user = auth.currentUser();
    if (!user) {
        return [
            { section: 'titleHero', title: 'Pengaturan / Profil', description: 'Silakan masuk terlebih dahulu.' },
            { section: 'article',
              leftCol: { subtitle: '', lines: ['link:Ke Halaman Masuk:login'] },
              rightCol: { subtitle: '', lines: [] } }
        ];
    }
    // name & email SELALU segar dari server (bukan cache localStorage) —
    // satu-satunya sumber kebenaran sekarang tabel `users` di D1.
    const record = await auth.guardApi(() => db.me()) || user;

    return [
        { section: 'titleHero', title: 'Pengaturan / Profil',
          description: 'Kelola informasi akun Anda. Form akan terbuka otomatis di panel kanan.' },
        {
            section: 'article',
            leftCol: {
                subtitle: 'Info',
                lines: [
                    'link:Lihat Katalog Kursus:learn', '---',
                    'link:Kerjakan Kuis:kuis', '---',
                    'link:Verifikasi Sertifikat:cert', '---',
                    'link:Pengaturan Profil:settings', '---'
                ]
            },
            rightCol: {
                subtitle: 'Profil Saya',
                fields: [
                    { type: 'text',  name: 'name',  id: 'set-name',  label: 'Nama Lengkap',
                      value: record?.name || user.name || '', placeholder: 'Nama Anda', required: true },
                    { type: 'email', name: 'email', id: 'set-email', label: 'Email',
                      value: record?.email || '', placeholder: 'nama@email.com' }
                ],
                submitText: 'Simpan Perubahan',
                onSubmit:   'event.preventDefault(); web.saveProfile(this);',
                lines: ['form:']
            }
        }
    ];
};

web.saveProfile = async function (form) {
    const user = auth.currentUser();
    if (!user) { alert('Sesi Anda sudah berakhir, silakan masuk kembali.'); return web.navigate('login'); }

    const name  = form.querySelector('[name="name"]')?.value.trim()  || '';
    const email = form.querySelector('[name="email"]')?.value.trim() || '';
    if (!name) { alert('Nama tidak boleh kosong.'); return; }

    const updated = await auth.guardApi(() => db.saveProfile({ name, email }));
    if (!updated) return;

    // Sinkronkan sesi lokal supaya nama baru langsung tampil tanpa perlu
    // masuk ulang (role/username tidak berubah, ambil dari sesi lama).
    localStorage.setItem(auth.SESSION_USER_KEY, JSON.stringify({ ...user, name: updated.name }));
    if (typeof renderMenu === 'function') renderMenu();

    alert('Profil berhasil disimpan.');
    web.navigate('dashboard');
};
