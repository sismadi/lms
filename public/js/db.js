// ============================================================
// DB — Lapisan akses API untuk mooc-app.
// ============================================================
// VERSI TER-HARDENING: backend lama (satu rute generik /api/:table utk
// SEMUA tabel, tanpa login) diganti server yang membedakan data publik
// (/public) dari data yang butuh sesi (/api) — lihat mooc-api/SECURITY.md
// utk alasan lengkap. Bentuk publik di sini menyesuaikan: TIDAK ADA lagi
// `db.all('users')`/`db.find('users', ...)` generik (tabel itu sekarang
// diblokir total dari klien) — kredensial & jawaban kuis tidak pernah
// diunduh ke browser peserta.
//
// mooc-app (frontend statis) dan mooc-api (Worker) tetap 2 origin
// berbeda — API_BASE harus URL absolut, bukan path relatif.
// ============================================================
// Frontend & API satu Worker (satu origin) -> path relatif, tanpa CORS.
const PUBLIC_BASE = '/public';
const PRIVATE_BASE = '/api';

const SESSION_TOKEN_KEY = 'moocSessionToken';

function getToken() {
    return localStorage.getItem(SESSION_TOKEN_KEY) || '';
}
function setToken(token) {
    if (token) localStorage.setItem(SESSION_TOKEN_KEY, token);
    else localStorage.removeItem(SESSION_TOKEN_KEY);
}

/** Error terstruktur supaya pemanggil bisa membaca pesan dari server
 *  (mis. "Password minimal 8 karakter") alih-alih "HTTP 400" generik. */
class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
}

async function readJsonSafe(res) {
    try { return await res.json(); } catch (e) { return null; }
}

/** Panggilan TANPA sesi — captcha, katalog, login, register, dst. */
async function apiPublic(view, { method = 'GET', body, params } = {}) {
    const url = new URL(PUBLIC_BASE, location.origin);
    url.searchParams.set('view', view);
    if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);

    const res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throw new ApiError(data?.error || `Permintaan gagal (${res.status})`, res.status);
    return data;
}

/** Panggilan YANG BUTUH sesi — otomatis menyisipkan header Authorization.
 *  401 (sesi berakhir/tidak valid) otomatis membersihkan sesi lokal &
 *  melempar error khusus supaya pemanggil bisa mengarahkan ke /?login. */
async function apiAuth(view, { method = 'GET', body, params, table } = {}) {
    const url = new URL(PRIVATE_BASE, location.origin);
    if (view) url.searchParams.set('view', view);
    if (table) url.searchParams.set('table', table);
    if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);

    const token = getToken();
    const res = await fetch(url, {
        method,
        headers: {
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await readJsonSafe(res);
    if (res.status === 401) {
        setToken(null);
        throw new ApiError('SESSION_EXPIRED', 401);
    }
    if (!res.ok) throw new ApiError(data?.error || `Permintaan gagal (${res.status})`, res.status);
    return data;
}

const db = {
    // --- Progress belajar (peserta, scoped otomatis ke akun sesi) ------
    async listProgress() { return apiAuth(null, { table: 'progress' }); },
    async saveProgress(slug, patch) {
        return apiAuth(null, { table: 'progress', method: 'POST', body: { slug, ...patch } });
    },

    // --- Kursus (dosen/admin) ------------------------------------------
    async coursesCatalog() { return (await apiPublic('courses')).courses; },
    async courseCreateOrUpsert(payload) {
        return apiAuth(null, { table: 'courses', method: 'POST', body: payload });
    },
    async courseUpdate(slug, patch) {
        return apiAuth(null, { table: 'courses', method: 'PATCH', params: { slug }, body: patch });
    },
    async courseSoftDelete(slug) {
        return apiAuth(null, { table: 'courses', method: 'DELETE', params: { slug } });
    },

    // --- Kuis (publik utk peserta, admin utk dosen) ---------------------
    async quizPublic(slug, password) { return apiPublic('quiz', { params: { slug, password } }); },
    async quizSubmit(slug, answers, password) {
        return apiPublic('quiz-submit', { method: 'POST', body: { slug, answers, password } });
    },
    async quizAdminGet(slug) { return apiAuth('quiz-admin', { params: { slug } }); },
    async quizAdminSave(slug, payload) {
        return apiAuth('quiz-admin', { method: 'POST', params: { slug }, body: payload });
    },

    // --- Sertifikat & riwayat kuis milik sendiri ------------------------
    async certPublic(id) { return (await apiPublic('cert', { params: { id } })).certificate; },
    async myAttempts() { return apiAuth('my-attempts'); },
    async myCertificates() { return apiAuth('my-certificates'); },

    // --- Peserta suatu kursus (dosen/admin) -----------------------------
    async participantsOf(slug) { return apiAuth('participants', { params: { slug } }); },

    // --- Profil akun sendiri ---------------------------------------------
    async me() { return apiAuth('me'); },
    async saveProfile(patch) { return apiAuth('profile', { method: 'PATCH', body: patch }); },

    // --- Admin ------------------------------------------------------------
    async adminStats() { return apiAuth('admin-stats'); },
    async adminCreateAccount(payload) { return apiAuth('admin-create-account', { method: 'POST', body: payload }); },
    async adminSetRole(id, role) { return apiAuth('admin-set-role', { method: 'PATCH', params: { id }, body: { role } }); },

    // --- Auth (dipakai auth.js) --------------------------------------------
    async captcha() { return apiPublic('captcha'); },
    async login(body) { return apiPublic('login', { method: 'POST', body }); },
    async register(body) { return apiPublic('register', { method: 'POST', body }); },
    async forgotPassword(body) { return apiPublic('forgot-password', { method: 'POST', body }); },
    async resetPassword(body) { return apiPublic('reset-password', { method: 'POST', body }); },
};
