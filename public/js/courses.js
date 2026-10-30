// ============================================================
// courseSvc — Penggabung kursus STATIS (var `courses` di pages/learn.js
// + pages[slug].categories) dengan kursus/materi TAMBAHAN dari dosen
// (sekarang lewat mooc-api, bukan lagi CRUD generik tanpa otentikasi).
// ============================================================
// VERSI TER-HARDENING: katalog kursus tambahan/override dibaca lewat
// /public?view=courses (data publik, tidak butuh sesi — memang untuk
// ditampilkan ke siapa saja). Menulis (create/update/hapus) SELALU
// lewat /api (butuh sesi dosen/admin), dan SERVER yang memverifikasi
// kepemilikan (instructorUsername === session.username) — bukan lagi
// asumsi UI semata (requireOwnedCourse di dosen.js sekarang murni
// kenyamanan tampilan, tetap didukung penuh oleh pengecekan server).
// ============================================================
const courseSvc = {
    _cache: null, // cache ringan 1 halaman-muat, dibersihkan di invalidate()

    async _dbCourses() {
        if (!this._cache) this._cache = await db.coursesCatalog();
        return this._cache;
    },
    invalidate() { this._cache = null; },

    /** Daftar kursus gabungan: statis (courses) + override/tambahan (DB, publik). */
    async list() {
        const staticList = (typeof courses !== 'undefined') ? courses : [];
        const dbList = await this._dbCourses();

        const merged = staticList.map(c => {
            const override = dbList.find(d => d.slug === c.slug);
            return override ? { ...c, ...override } : { ...c };
        });
        dbList.forEach(d => {
            if (!merged.some(m => m.slug === d.slug)) merged.push({ ...d });
        });

        return merged.filter(c => !c.deleted);
    },

    async get(slug) {
        const list = await this.list();
        return list.find(c => c.slug === slug) || null;
    },

    /** Kategori/materi gabungan suatu kursus — statis (pages[slug]) + tambahan dosen (DB). */
    async categoriesOf(slug) {
        const staticCats = (pages[slug] && Array.isArray(pages[slug].categories)) ? pages[slug].categories : [];
        const dbList = await this._dbCourses();
        const dbCourse = dbList.find(c => c.slug === slug);
        const extraCats = (dbCourse && Array.isArray(dbCourse.categories)) ? dbCourse.categories : [];
        return [...staticCats, ...extraCats];
    },

    /** Buat kursus baru milik dosen yang sedang login. `instructorUsername`
     *  TIDAK dikirim — server selalu mengisinya dari sesi. */
    async create({ slug, title, description, price, period }) {
        const record = await db.courseCreateOrUpsert({ slug, title, description, price, period });
        this.invalidate();
        return record;
    },

    async update(slug, patch) {
        const record = await db.courseUpdate(slug, patch);
        this.invalidate();
        return record;
    },

    /** Tambah 1 materi (pdf/youtube) ke kategori "Materi Tambahan" milik sebuah kursus. */
    async addMaterial(slug, { title, type, url }) {
        const cats = await this.categoriesOf(slug);
        const dbCats = cats.filter(c => c.name === 'Materi Tambahan'); // hanya bagian dari DB yang boleh ditulis ulang
        const categories = (await this._dbCourses()).find(c => c.slug === slug)?.categories || [];
        const list = Array.isArray(categories) ? [...categories] : [];
        let cat = list.find(c => c.name === 'Materi Tambahan');
        if (!cat) { cat = { name: 'Materi Tambahan', items: [] }; list.push(cat); }

        const line = type === 'youtube' ? `video:youtube:${url}` : `pdf:${url}`;
        cat.items = [...cat.items, { title, lines: [line] }]; // id diisi SERVER (normalizeCategories)

        const existing = (await this._dbCourses()).find(c => c.slug === slug);
        const payload = existing
            ? { categories: list }
            : { slug, title: (await this.get(slug))?.title, categories: list };
        const record = existing ? await db.courseUpdate(slug, payload) : await db.courseCreateOrUpsert(payload);
        this.invalidate();
        return record;
    },

    isEditableMaterial(itemId) {
        return typeof itemId === 'string' && itemId.startsWith('materi_');
    },

    _parseMaterialLine(item) {
        const line = (item.lines || [])[0] || '';
        if (line.startsWith('video:youtube:')) return { type: 'youtube', url: line.slice('video:youtube:'.length) };
        return { type: 'pdf', url: line.startsWith('pdf:') ? line.slice('pdf:'.length) : '' };
    },

    async getMaterial(slug, itemId) {
        const cats = await this.categoriesOf(slug);
        const cat  = cats.find(c => c.name === 'Materi Tambahan');
        const item = (cat?.items || []).find(i => i.id === itemId);
        return item ? { ...item, ...this._parseMaterialLine(item) } : null;
    },

    async updateMaterial(slug, itemId, { title, type, url }) {
        const dbCourse = (await this._dbCourses()).find(c => c.slug === slug);
        if (!dbCourse) return null;
        const categories = (dbCourse.categories || []).map(cat => cat.name !== 'Materi Tambahan' ? cat : {
            ...cat,
            items: cat.items.map(i => i.id !== itemId ? i : {
                ...i, id: itemId, title, lines: [type === 'youtube' ? `video:youtube:${url}` : `pdf:${url}`]
            })
        });
        const record = await db.courseUpdate(slug, { categories });
        this.invalidate();
        return record;
    },

    async removeMaterial(slug, itemId) {
        const dbCourse = (await this._dbCourses()).find(c => c.slug === slug);
        if (!dbCourse) return null;
        const categories = (dbCourse.categories || []).map(cat => cat.name !== 'Materi Tambahan' ? cat : {
            ...cat, items: cat.items.filter(i => i.id !== itemId)
        });
        const record = await db.courseUpdate(slug, { categories });
        this.invalidate();
        return record;
    },

    /** Daftarkan slug kursus TAMBAHAN ke web.routes, sama seperti kursus statis. */
    async registerRoutes() {
        const rows = await this._dbCourses();
        rows.forEach(c => {
            if (c.slug && !web.routes[c.slug]) web.routes[c.slug] = 'resolveLearningModule';
        });
    },

    /** Hapus (soft delete di server) — berlaku sama utk kursus statis
     *  maupun buatan dosen murni, lihat mooc-api worker.js DELETE ?table=courses. */
    async remove(slug) {
        await db.courseSoftDelete(slug);
        this.invalidate();
        return true;
    },

    isOwner(course, user) {
        if (!user) return false;
        if (user.role === 'admin') return true;
        return course.instructorUsername === user.username || course.instructor === user.name;
    },

    async myCourses(user) {
        const list = await this.list();
        return list.filter(c => this.isOwner(c, user));
    },

    /** Daftar peserta (nama + progress) suatu kursus — sekarang 1
     *  panggilan server (?view=participants), bukan N+1 query klien. */
    async participantsOf(slug) {
        const total = (await this.categoriesOf(slug)).flatMap(c => c.items || []).length;
        const rows = await auth.guardApi(() => db.participantsOf(slug)) || [];
        return rows.map(r => ({
            Nama: r.name, Progress: total ? Math.round((r.viewed / total) * 100) + '%' : '0%',
            'Modul Dilihat': `${r.viewed}/${total}`
        }));
    },

    /** Progress belajar akun yang SEDANG LOGIN pada 1 kursus: { viewed, total, pct }.
     *  `courseMeta` opsional (hindari fetch ulang kalau pemanggil sudah punya). */
    async progressOf(slug, courseMeta) {
        const cats     = await this.categoriesOf(slug);
        const allItems = cats.flatMap(cat => cat.items || []);
        const total    = allItems.length;
        const rows     = await db.listProgress().catch(() => []);
        const row      = rows.find(p => p.slug === slug);
        const viewed   = row ? (row.viewed || []).filter(id => allItems.some(i => i.id === id)).length : 0;
        return { viewed, total, pct: total ? Math.round((viewed / total) * 100) : 100 };
    }
};

// ============================================================
// OVERRIDE 1 — components.courseCatalog: kursus buatan dosen ikut
// tampil, SEMUA teks (title/description/price/instructor/period) yang
// bisa berasal dari input dosen di-escape.
// ============================================================
components.courseCatalog = async (d) => {
    const list = await courseSvc.list();
    const cards = await Promise.all(list.map(async c => {
        const materiCount = (await courseSvc.categoriesOf(c.slug)).flatMap(cat => cat.items || []).length;
        return `
        <div class="course-card">
            <h3>${escHtml(c.title)}</h3>
            <p>${escHtml(c.description)}</p>
            <ul class="course-meta">
                <li><strong>Harga:</strong> ${escHtml(c.price)}</li>
                <li><strong>Instruktur:</strong> ${escHtml(c.instructor)}</li>
                <li><strong>Periode:</strong> ${escHtml(c.period)}</li>
                <li><strong>Materi:</strong> ${materiCount} modul</li>
            </ul>
            <a href="javascript:void(0)" class="slcBtn"
               onclick="web.navigate('${c.slug.replace(/'/g, '')}')">Enroll</a>
        </div>`;
    }));

    return `
    <div class="row page4">
    <div class="artikel">
            ${d.title ? `<h2>${escHtml(d.title)}</h2>` : ''}
            ${d.description ? `<p>${escHtml(d.description)}</p>` : ''}
            <p class="course-count">${list.length} kursus tersedia</p>
            <div class="course-grid">
                ${cards.join('')}
                </div>
                </div>
        </div>`;
};

// ============================================================
// OVERRIDE 2 — web.resolveLearningModule: progress belajar ditulis
// lewat db.saveProgress() (scoped otomatis ke sesi di server — klien
// tidak lagi mengirim `username`).
// ============================================================
web.resolveLearningModule = async function (id, slug = 'rpl') {
    const courseMeta = await courseSvc.get(slug);
    if (!courseMeta) {
        return [{ section: 'titleHero', title: 'Kursus Tidak Ditemukan',
                   description: 'Kursus ini tidak tersedia atau sudah dihapus.' }];
    }

    const categories = await courseSvc.categoriesOf(slug);
    const allItems   = categories.flatMap(cat => cat.items || []);
    const defaultId  = allItems[0]?.id || '';
    const activeId   = id || defaultId;
    const exists     = allItems.some(i => i.id === activeId);

    if (exists && auth.currentUser()) {
        const rows = await db.listProgress().catch(() => []);
        const row = rows.find(p => p.slug === slug);
        const viewed = row ? Array.from(new Set([...(row.viewed || []), activeId])) : [activeId];
        await db.saveProgress(slug, { viewed, lastId: activeId }).catch(() => {});
    }

    return [
        {
            section: 'titleHero',
            title: exists ? (courseMeta?.title || 'Learning Module') : 'Modul Tidak Ditemukan'
        },
        {
            section: 'learningModule',
            activeId: exists ? activeId : defaultId,
            slug: slug,
            data: { categories }
        }
    ];
};

(async () => { await courseSvc.registerRoutes(); })();
