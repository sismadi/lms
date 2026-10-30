// ============================================================
// QUIZ — Kuis per KURSUS.
// ============================================================
// [KRITIS — lihat mooc-api/SECURITY.md temuan KRITIS 3] Versi lama
// mengirim SELURUH `quiz.questions` (termasuk field `ans`, base64 dari
// jawaban benar) ke peserta, lalu mencocokkan jawaban DI BROWSER —
// siapa pun bisa membuka DevTools dan membaca kunci jawabannya.
//
// Versi ini:
//   * Peserta mengambil soal lewat db.quizPublic(slug, password?) ->
//     GET /public?view=quiz — SERVER membuang field `ans` sebelum
//     mengirim, dan `password` kuis tidak pernah dikirim mentah (hanya
//     status `locked: true/false`).
//   * Submit jawaban lewat db.quizSubmit(slug, answers, password?) ->
//     POST /public?view=quiz-submit — SERVER yang menghitung skor,
//     mencatat percobaan (quizAttempts), & menerbitkan sertifikat kalau
//     lulus. Klien hanya menerima hasil akhir (skor, lulus/tidak).
//   * Dosen mengelola soal (termasuk melihat/mengubah jawaban benar)
//     lewat db.quizAdminGet/quizAdminSave -> /api?view=quiz-admin,
//     yang memverifikasi kepemilikan kursus di server.
// ============================================================
const quizSvc = {
    async of(slug) { return db.quizPublic(slug); },
    async admin(slug) { return db.quizAdminGet(slug); },
    async upsert(slug, payload) { return db.quizAdminSave(slug, payload); },
};

const certSvc = {
    async of() { return db.myCertificates(); },
    async get(id) { return db.certPublic(id).catch(() => null); },
};

// ============================================================
// [KRITIS] Rendering & submit kuis untuk PESERTA — lihat catatan di
// atas. `web._quizPasswords` menyimpan sandi yang BERHASIL dipakai
// membuka kuis (di memori, per slug) supaya bisa disertakan lagi saat
// submit (server memverifikasi ULANG password saat grading, bukan
// hanya saat menampilkan soal).
// ============================================================
web._quizPasswords = {};

function renderQuizForm(quiz, slug, containerId) {
    const randomized = [...(quiz.questions || [])].sort(() => Math.random() - 0.5);
    return `
        <form id="${containerId}-form" class="dynamic-form"
            onsubmit="event.preventDefault(); web.submitQuiz('${slug}', this, '${containerId}');">
            ${randomized.map((q, i) => `
                <div class="quiz-box">
                    <p><strong>${i + 1}. ${escHtml(q.q)}</strong></p>
                    ${(q.options || []).map(opt =>
                        `<label><input type="radio" name="qid-${q.qid}" value="${escHtml(opt)}" required> ${escHtml(opt)}</label>`
                    ).join('')}
                </div>`).join('')}
            <button type="submit" class="slcBtn">Kirim</button>
        </form>`;
}

// OVERRIDE — components.quizEngine (menimpa stub di script.js).
components.quizEngine = (ctx) => {
    const quiz = ctx.quiz;
    const slug = ctx.slug;
    if (!quiz) return `<div class="info-card">Kuis tidak ditemukan.</div>`;

    const containerId = 'quiz-engine-' + Math.random().toString(36).slice(2, 9);
    if (quiz.locked) {
        return `
            <div id="${containerId}">
                <div class="card-input">
                    <p><strong>Ujian Terproteksi.</strong> Masukkan sandi:</p>
                    <input type="password" id="${containerId}-pass" style="width:200px">
                    <button class="slcBtn" onclick="web.unlockQuiz('${slug}','${containerId}')">Buka</button>
                </div>
            </div>`;
    }
    return `<div id="${containerId}">${renderQuizForm(quiz, slug, containerId)}</div>`;
};

web.unlockQuiz = async function (slug, containerId) {
    const password = web.gebi(`${containerId}-pass`)?.value || '';
    let quiz;
    try { quiz = await db.quizPublic(slug, password); }
    catch (e) { alert(e?.message || 'Gagal membuka kuis.'); return; }

    if (quiz.locked) { alert('Sandi salah.'); return; }
    web._quizPasswords[slug] = password;
    const el = web.gebi(containerId);
    if (el) el.innerHTML = renderQuizForm(quiz, slug, containerId);
};

web.submitQuiz = async function (slug, form, containerId) {
    const inputs = form.querySelectorAll('input[type="radio"]:checked');
    const answers = Array.from(inputs).map(input => ({
        qid: Number(input.name.replace('qid-', '')),
        selected: input.value,
    }));

    const btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }

    let result;
    try {
        result = await db.quizSubmit(slug, answers, web._quizPasswords[slug]);
    } catch (e) {
        alert(e?.message || 'Gagal mengirim jawaban.');
        if (btn) { btn.disabled = false; btn.textContent = 'Kirim'; }
        return;
    }

    alert(result.lulus
        ? `Ujian Selesai!\nSkor Anda: ${result.score} (Passing Grade: ${result.passingGrade})\nSelamat, Anda LULUS! Sertifikat sudah tersedia di Dashboard.`
        : `Ujian Selesai!\nSkor Anda: ${result.score} (Passing Grade: ${result.passingGrade})`);
    web.navigate('kuis');
};

// ============================================================
// ROUTE PUBLIK — '/?kuis' & '/?kuis/<slug>'
// ============================================================
web.routes.kuis = 'resolveKuisDashboard';

web.resolveKuisDashboard = async function (subParam) {
    const user = auth.currentUser();

    // --- Halaman pengerjaan kuis 1 kursus -------------------------------
    if (subParam) {
        const slug = subParam.split('?')[0];
        const c = await courseSvc.get(slug);
        if (!c) return [{ section: 'titleHero', title: 'Kuis Tidak Ditemukan' }];

        let quiz;
        try { quiz = await db.quizPublic(slug); }
        catch (e) { quiz = null; }
        if (!quiz) {
            return [{ section: 'titleHero', title: 'Kuis Tidak Ditemukan',
                       description: 'Kursus ini belum memiliki kuis.' }];
        }
        if (!user) {
            return [
                { section: 'titleHero', title: `Kuis — ${escHtml(c.title)}`,
                  description: 'Silakan masuk terlebih dahulu untuk mengerjakan kuis.' },
                { section: 'article',
                  leftCol: { subtitle: '', lines: ['link:Ke Halaman Masuk:login'] },
                  rightCol: { subtitle: '', lines: [] } }
            ];
        }

        // Gerbang UX (progress 100%) — lihat catatan "Batas yang masih
        // ada" di mooc-api/SECURITY.md: ini kenyamanan tampilan, BUKAN
        // batas keamanan (grading & kunci jawaban tetap sepenuhnya aman
        // di server terlepas dari gerbang ini).
        const { viewed, total, pct } = await courseSvc.progressOf(slug, c);
        if (pct < 100) {
            return [
                { section: 'titleHero', title: `Kuis — ${escHtml(quiz.title)}`,
                  description: 'Selesaikan seluruh materi kursus ini terlebih dahulu sebelum mengerjakan kuis.' },
                {
                    section: 'article',
                    leftCol: { subtitle: 'Progress Kursus', lines: [`skill:${pct}%:${c.title}:${viewed}/${total} modul`] },
                    rightCol: {
                        subtitle: 'Kuis Terkunci',
                        lines: [
                            `Progress belajar Anda baru **${pct}%**. Kuis akan terbuka otomatis setelah seluruh materi (100%) selesai dipelajari.`,
                            `link:Lanjutkan Belajar — ${c.title}:${slug}`, '---', 'link:&laquo; Kembali ke Daftar Kuis:kuis'
                        ]
                    }
                }
            ];
        }

        const attempts = await db.myAttempts().catch(() => []);
        const ofSlug = attempts.filter(a => a.slug === slug);
        const last = ofSlug.length ? ofSlug[ofSlug.length - 1] : null;

        return [
            { section: 'titleHero', title: `Kuis — ${escHtml(quiz.title)}` },
            {
                section: 'article',
                leftCol: {
                    subtitle: 'Informasi Ujian',
                    lines: [
                        `**Kursus:** ${c.title}`,
                        `**Passing Grade:** ${quiz.passingGrade}%`,
                        `**Skor Terakhir Anda:** ${last ? last.score : 'Belum pernah mengerjakan'}`,
                        '---', 'link:&laquo; Kembali ke Daftar Kuis:kuis'
                    ]
                },
                rightCol: { subtitle: 'Kerjakan Kuis', lines: ['form:quiz'], quiz, slug }
            }
        ];
    }

    // --- Daftar semua kuis (lintas kursus) ------------------------------
    const allCourses = await courseSvc.list();
    const withQuiz = await Promise.all(allCourses.map(async c => ({ c, quiz: await db.quizPublic(c.slug).catch(() => null) })));
    const attempts = user ? await db.myAttempts().catch(() => []) : [];

    const rows = await Promise.all(
        withQuiz.filter(x => x.quiz).map(async ({ c, quiz }) => {
            const ofSlug = attempts.filter(a => a.slug === c.slug);
            const last = ofSlug.length ? ofSlug[ofSlug.length - 1] : null;
            const pct = user ? (await courseSvc.progressOf(c.slug, c)).pct : null;
            return {
                Kursus: c.title,
                'Passing Grade': quiz.passingGrade + '%',
                'Progress Anda': user ? pct + '%' : '-',
                'Skor Terakhir': last ? last.score : '-',
                Aksi: (user && pct < 100)
                    ? `<span style="color:var(--aColor)">Selesaikan materi dulu</span>`
                    : `<a href="javascript:void(0)" onclick="web.navigate('kuis/${c.slug.replace(/'/g, '')}')">Kerjakan</a>`
            };
        })
    );

    return [
        { section: 'titleHero', title: 'Kuis', description: 'Pilih kursus untuk mengerjakan kuisnya.' },
        {
            section: 'article',
            leftCol: { subtitle: '', lines: ['link:Lihat Katalog Kursus:learn'] },
            rightCol: {
                subtitle: 'Daftar Kuis Tersedia',
                lines: rows.length ? [`table:${JSON.stringify(rows)}`] : ['Belum ada kuis yang tersedia untuk kursus manapun.']
            }
        }
    ];
};

// ============================================================
// VERIFIKASI SERTIFIKAT — override resolveCertificate (script.js) agar
// mengenali kode sertifikat kuis (lewat mooc-api, publik & aman untuk
// diverifikasi siapa saja tanpa login).
// ============================================================
const _baseResolveCertificate = web.resolveCertificate;
web.resolveCertificate = async function (id) {
    if (id) {
        const c = await certSvc.get(id);
        if (c) return [{ section: 'certificate', id: c.id, name: c.name, exam: c.examTitle, score: c.score, date: c.date }];
    }
    return _baseResolveCertificate.call(this, id);
};

// ============================================================
// DASHBOARD DOSEN — "Kelola Kuis" per kursus. Ditambahkan ke
// dosenView/dosenAction (dosen.js) — sekarang lewat db.quizAdminGet/
// quizAdminSave (dosen/admin only, kepemilikan diverifikasi server).
// ============================================================
dosenView.formKelolaKuis = async function (param, user) {
    const [slug, subAction, idxStr] = String(param || '').split(':');
    if (subAction === 'edit') return dosenView.formEditSoal(slug, Number(idxStr), user);
    return dosenView.listKelolaKuis(slug, user);
};

dosenView.listKelolaKuis = async function (slug, user) {
    const guard = await requireOwnedCourse(slug, user);
    if (guard.denied) return guard.denied;
    const c = guard.course;

    const quiz = await auth.guardApi(() => quizSvc.admin(slug))
        || { title: `Kuis ${c.title}`, passingGrade: 75, password: '', questions: [] };

    const rows = (quiz.questions || []).map((q, i) => ({
        No: i + 1, Pertanyaan: q.q, 'Jml Opsi': (q.options || []).length,
        Aksi: `<a href="javascript:void(0)" onclick="dosenAction.bukaEditSoal('${slug}',${i})">Edit</a> ·
               <a href="javascript:void(0)" onclick="dosenAction.hapusSoal('${slug}',${i})">Hapus</a>`
    }));

    return [
        { section: 'titleHero', title: `Kelola Kuis — ${c.title}` },
        {
            section: 'article',
            leftCol: {
                subtitle: 'Pengaturan Kuis',
                lines: [
                    `**Judul Kuis** ${quiz.title}`,
                    `**Passing Grade** ${quiz.passingGrade}%`,
                    `**Password Kuis** — ${quiz.password ? 'Terpasang (terproteksi)' : 'Tanpa proteksi'}`,
                    `<button type="button" class="slcBtn" onclick="dosenAction.bukaPengaturanKuis('${slug}')">Edit Pengaturan Kuis</button>`,
                    '---', 'link:&laquo; Kembali ke Kursusku:dosen'
                ]
            },
            rightCol: {
                subtitle: 'Daftar Soal',
                lines: [
                    `<button type="button" class="slcBtn" onclick="dosenAction.bukaTambahSoal('${slug}')">+ Tambah Soal Baru</button>`,
                    ...(rows.length ? [`table:${JSON.stringify(rows)}`] : ['Belum ada soal.'])
                ]
            }
        }
    ];
};

dosenView.formPengaturanKuis = async function (slug, user) {
    const guard = await requireOwnedCourse(slug, user);
    if (guard.denied) return guard.denied;
    const c = guard.course;
    const quiz = await auth.guardApi(() => quizSvc.admin(slug)) || { title: `Kuis ${c.title}`, passingGrade: 75, password: '' };

    return [
        { section: 'titleHero', title: `Pengaturan Kuis — ${c.title}` },
        {
            section: 'article',
            leftCol: { subtitle: '', lines: [] },
            rightCol: {
                subtitle: 'Pengaturan Kuis',
                fields: [
                    { type: 'text', name: 'title', label: 'Judul Kuis', value: quiz.title, required: true },
                    { type: 'text', name: 'passingGrade', label: 'Passing Grade (%)', value: quiz.passingGrade },
                    { type: 'text', name: 'password', label: 'Password Kuis (kosongkan = tanpa proteksi)', value: quiz.password }
                ],
                submitText: 'Simpan Pengaturan',
                onSubmit: `event.preventDefault(); dosenAction.submitKuisSettings(this,'${slug}');`,
                lines: ['form:']
            }
        }
    ];
};

dosenView.formTambahSoal = async function (slug, user) {
    const guard = await requireOwnedCourse(slug, user);
    if (guard.denied) return guard.denied;
    const c = guard.course;
    return [
        { section: 'titleHero', title: `Tambah Soal — ${c.title}` },
        {
            section: 'article',
            leftCol: { subtitle: '', lines: [] },
            rightCol: {
                subtitle: 'Tambah Soal Baru',
                fields: [
                    { type: 'text', name: 'q', label: 'Pertanyaan', required: true },
                    { type: 'textarea', name: 'options', label: 'Pilihan Jawaban (satu per baris, min. 2)', rows: 4, required: true,
                      placeholder: 'Opsi A\nOpsi B\nOpsi C\nOpsi D' },
                    { type: 'text', name: 'correctAnswer', label: 'Jawaban Benar (sama persis dgn salah satu pilihan)', required: true }
                ],
                submitText: 'Tambah Soal',
                onSubmit: `event.preventDefault(); dosenAction.submitTambahSoal(this,'${slug}');`,
                lines: ['form:']
            }
        }
    ];
};

/** Form edit 1 soal. [KEAMANAN] Jawaban benar TIDAK PERNAH di-pre-isi
 *  (versi lama men-decode base64 & menaruhnya sebagai `value` — walau
 *  dosen berhak melihatnya, memuatnya ke atribut HTML `value="..."`
 *  tanpa escaping adalah pola berisiko yang sama seperti field lain;
 *  lebih aman & lebih sederhana: dosen cukup mengetik ulang jawaban
 *  benar setiap kali mengedit soal). */
dosenView.formEditSoal = async function (slug, index, user) {
    const guard = await requireOwnedCourse(slug, user);
    if (guard.denied) return guard.denied;
    const c = guard.course;

    const quiz = await auth.guardApi(() => quizSvc.admin(slug));
    const item = quiz?.questions?.[index];
    if (!item) return [{ section: 'titleHero', title: 'Soal Tidak Ditemukan' }];

    return [
        { section: 'titleHero', title: `Edit Soal — ${c.title}` },
        {
            section: 'article',
            leftCol: { subtitle: '', lines: [`link:&laquo; Kembali ke Kelola Kuis:dosen/kuis:${slug}`] },
            rightCol: {
                subtitle: `Edit Soal #${index + 1}`,
                fields: [
                    { type: 'text', name: 'q', label: 'Pertanyaan', value: item.q, required: true },
                    { type: 'textarea', name: 'options', label: 'Pilihan Jawaban (satu per baris, min. 2)', rows: 4, required: true,
                      value: (item.options || []).join('\n') },
                    { type: 'text', name: 'correctAnswer', label: 'Jawaban Benar (ketik ulang salah satu pilihan di atas)', required: true }
                ],
                submitText: 'Simpan Perubahan',
                onSubmit: `event.preventDefault(); dosenAction.submitEditSoal(this,'${slug}',${index});`,
                lines: ['form:']
            }
        }
    ];
};

dosenAction.bukaPengaturanKuis = async function (slug) {
    web.openFormFromPage(await dosenView.formPengaturanKuis(slug, auth.currentUser()));
};
dosenAction.bukaTambahSoal = async function (slug) {
    web.openFormFromPage(await dosenView.formTambahSoal(slug, auth.currentUser()));
};
dosenAction.bukaEditSoal = async function (slug, index) {
    web.openFormFromPage(await dosenView.formEditSoal(slug, index, auth.currentUser()));
};

dosenAction.submitKuisSettings = async function (form, slug) {
    const existing = await auth.guardApi(() => quizSvc.admin(slug));
    const ok = await auth.guardApi(() => quizSvc.upsert(slug, {
        title: form.querySelector('[name="title"]').value.trim(),
        passingGrade: form.querySelector('[name="passingGrade"]').value,
        password: form.querySelector('[name="password"]').value.trim(),
        questions: existing?.questions || []
    }));
    if (!ok) return;
    alert('Pengaturan kuis berhasil disimpan.');
    web.navigate('dosen/kuis:' + slug);
};

dosenAction.submitTambahSoal = async function (form, slug) {
    const q       = form.querySelector('[name="q"]').value.trim();
    const options = form.querySelector('[name="options"]').value.split('\n').map(s => s.trim()).filter(Boolean);
    const correctAnswer = form.querySelector('[name="correctAnswer"]').value.trim();
    if (options.length < 2) { alert('Minimal 2 pilihan jawaban.'); return; }
    if (!options.includes(correctAnswer)) { alert('Jawaban benar harus sama persis dengan salah satu pilihan di atas.'); return; }

    const existing = await auth.guardApi(() => quizSvc.admin(slug));
    const questions = [...(existing?.questions || []), { q, options, correctAnswer }];
    const ok = await auth.guardApi(() => quizSvc.upsert(slug, {
        title: existing?.title, passingGrade: existing?.passingGrade, password: existing?.password, questions
    }));
    if (!ok) return;
    alert('Soal berhasil ditambahkan.');
    web.navigate('dosen/kuis:' + slug);
};

dosenAction.submitEditSoal = async function (form, slug, index) {
    const q       = form.querySelector('[name="q"]').value.trim();
    const options = form.querySelector('[name="options"]').value.split('\n').map(s => s.trim()).filter(Boolean);
    const correctAnswer = form.querySelector('[name="correctAnswer"]').value.trim();
    if (options.length < 2) { alert('Minimal 2 pilihan jawaban.'); return; }
    if (!options.includes(correctAnswer)) { alert('Jawaban benar harus sama persis dengan salah satu pilihan di atas.'); return; }

    const existing = await auth.guardApi(() => quizSvc.admin(slug));
    if (!existing || !existing.questions[index]) { alert('Soal tidak ditemukan.'); return; }

    const questions = existing.questions.map((item, i) => i !== index ? item : { q, options, correctAnswer });
    const ok = await auth.guardApi(() => quizSvc.upsert(slug, {
        title: existing.title, passingGrade: existing.passingGrade, password: existing.password, questions
    }));
    if (!ok) return;
    alert('Soal berhasil diperbarui.');
    web.navigate('dosen/kuis:' + slug);
};

dosenAction.hapusSoal = async function (slug, index) {
    if (!confirm('Hapus soal ini? Tindakan tidak bisa dibatalkan.')) return;
    const existing = await auth.guardApi(() => quizSvc.admin(slug));
    if (!existing) return;
    const questions = existing.questions.filter((_, i) => i !== index);
    const ok = await auth.guardApi(() => quizSvc.upsert(slug, {
        title: existing.title, passingGrade: existing.passingGrade, password: existing.password, questions
    }));
    if (!ok) return;
    alert('Soal berhasil dihapus.');
    web.navigate('dosen/kuis:' + slug);
};
