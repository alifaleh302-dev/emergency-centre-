/**
 * finance_module.js — المرحلة M5.1
 * =============================================================================
 * 🏦 المركز المالي والسندي الشامل — Frontend (الجزء الأول: الأساس)
 * =============================================================================
 *
 * يُنفِّذ هذا الملف الجزء الأول من المرحلة M5 (الواجهة الأمامية)، ويغطي:
 *   ✅ الحالة العامة + Utilities + CSS injection.
 *   ✅ viewHub() — الشاشة الرئيسية + 6 KPIs + 4 Charts (Chart.js).
 *   ✅ لوحة الفلاتر الكاملة (12 معيار + 9 Quick Presets).
 *   ✅ شبكة البيانات الموحّدة (Sort + Pagination + Select).
 *   ✅ Drawer التفاصيل (Invoice / Ticket / Related / Audit).
 *
 * APIs المستهلكة في M5.1:
 *   - GET  /api/finance/filter_options       (مرة واحدة عند فتح الواجهة)
 *   - POST /api/finance/overview             (KPIs + 4 charts)
 *   - POST /api/finance/transactions         (الـ ledger)
 *   - POST /api/finance/transaction_detail   (drawer التفاصيل)
 *
 * ما هو مؤجل إلى M5.2 (الجلسة القادمة):
 *   - Column Manager (إظهار/إخفاء/إعادة ترتيب الأعمدة).
 *   - Saved Views (حفظ العروض في localStorage).
 *   - XLSX Export — 4 أوراق منسّقة.
 *   - Print Templates (سند مفرد + تقرير دفعة).
 *   - Ministry Report Modal.
 *
 * الاعتمادات: Core (main_core.js) + Bootstrap 5.3 + Chart.js (محمَّلة في index.html).
 *
 * لا يُسجَّل هذا الموديول في القائمة الجانبية تلقائياً — التكامل مؤجَّل إلى M6.
 * للاستخدام اليدوي/الاختبار: `Finance.viewHub()`.
 */

/* =========================================================================
 * 1. الحالة العامة (Global State)
 * ========================================================================= */
const FinanceState = {
    options: {
        doc_types: [],
        statuses: [],
        accountants: [],
        doctors: [],
        departments: [],
        categories: [],
        services: [],
        ticket_ministry_shares: { morning: 30, evening: 100 },
    },
    currencyLabel: 'ريال',
    scope: { mode: 'all', user_id: null, user_role: '' },

    filters: {
        period: 'month',
        from: null,
        to: null,
        doc_codes: [],
        statuses: [],
        accountant_ids: [],
        doctor_ids: [],
        service_ids: [],
        category_ids: [],
        department_ids: [],
        amount_min: null,
        amount_max: null,
        has_ministry_share: false,
        query: '',
    },

    sortBy: 'txn_timestamp',
    sortDir: 'DESC',
    page: 1,
    perPage: 50,

    lastResponse: null,
    lastOverview: null,
    rows: [],
    selectedIds: new Set(),

    charts: {
        revenue30: null,
        typeDist: null,
        topServices: null,
        accountants: null,
    },

    // إعدادات الأعمدة الافتراضية لـ M5.1 (Column Manager في M5.2).
    columns: null,

    loading: false,
};

/* =========================================================================
 * 2. كاتالوج الأعمدة (الافتراضي لـ M5.1)
 * ========================================================================= */
const FINANCE_COLUMN_CATALOG = [
    { key: 'select',         label: '',                width: '40px',  default: true, sortable: false },
    { key: 'txn_type_label', label: 'نوع الحركة',       width: '120px', default: true, sortable: false },
    { key: 'doc_code',       label: 'كود',             width: '60px',  default: true, sortable: false },
    { key: 'serial_number',  label: 'التسلسل',          width: '90px',  default: true, sortable: true,  sortField: 'serial_number' },
    { key: 'patient_name',   label: 'المريض',           width: '180px', default: true, sortable: true,  sortField: 'patient_name' },
    { key: 'total',          label: 'الإجمالي',         width: '110px', default: true, sortable: true,  sortField: 'total', numeric: true },
    { key: 'cash_amount',    label: 'الكاش',            width: '110px', default: true, sortable: true,  sortField: 'cash_amount', numeric: true },
    { key: 'exempt_amount',  label: 'الإعفاء',          width: '110px', default: true, sortable: true,  sortField: 'exempt_amount', numeric: true },
    { key: 'center_share',   label: 'حصة المركز',       width: '120px', default: true, sortable: false, numeric: true },
    { key: 'ministry_share', label: 'حصة الوزارة',      width: '120px', default: true, sortable: false, numeric: true },
    { key: 'accountant_name',label: 'المحاسب',          width: '140px', default: false, sortable: false },
    { key: 'doctor_name',    label: 'الطبيب',           width: '140px', default: false, sortable: false },
    { key: 'txn_timestamp',  label: 'التاريخ والوقت',   width: '160px', default: true, sortable: true,  sortField: 'txn_timestamp' },
    { key: 'status',         label: 'الحالة',           width: '100px', default: true, sortable: false },
    { key: 'actions',        label: 'إجراءات',          width: '90px',  default: true, sortable: false },
];

/* =========================================================================
 * 3. حقن الأنماط (CSS)
 * ========================================================================= */
function injectFinanceStyles() {
    if (document.getElementById('finance-hub-styles')) return;
    const css = `
    .fh-page { padding: 0; }
    .fh-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:12px; }
    .fh-header h2 { margin:0; font-weight:800; color:#2b4196; display:flex; align-items:center; gap:10px; }
    .fh-header h2 i { font-size:1.6rem; }
    [data-theme="dark"] .fh-header h2 { color:#93c5fd; }
    .fh-header-actions { display:flex; gap:8px; flex-wrap:wrap; }

    .fh-kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; margin-bottom:20px; }
    .fh-kpi { background:#fff; border-radius:14px; padding:16px 18px; box-shadow:0 6px 14px rgba(0,0,0,0.05); border-right:5px solid var(--kpi-color,#4160e0); transition:transform .2s ease,box-shadow .2s ease; position:relative; overflow:hidden; }
    .fh-kpi:hover { transform:translateY(-3px); box-shadow:0 10px 20px rgba(0,0,0,0.08); }
    .fh-kpi-label { font-size:.82rem; color:#64748b; font-weight:600; margin-bottom:6px; }
    .fh-kpi-value { font-size:1.55rem; font-weight:800; color:#1e293b; line-height:1.15; word-break:break-word; }
    .fh-kpi-sub { font-size:.75rem; color:#94a3b8; margin-top:4px; }
    .fh-kpi-icon { position:absolute; top:12px; left:14px; opacity:.15; font-size:2.2rem; color:var(--kpi-color,#4160e0); }
    [data-theme="dark"] .fh-kpi { background:#2d3748; }
    [data-theme="dark"] .fh-kpi-value { color:#e2e8f0; }
    [data-theme="dark"] .fh-kpi-label { color:#94a3b8; }
    .fh-kpi-blue { --kpi-color:#3b82f6; }
    .fh-kpi-green { --kpi-color:#10b981; }
    .fh-kpi-orange { --kpi-color:#f59e0b; }
    .fh-kpi-purple { --kpi-color:#8b5cf6; }
    .fh-kpi-red { --kpi-color:#ef4444; }
    .fh-kpi-teal { --kpi-color:#14b8a6; }

    .fh-charts-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px; margin-bottom:20px; }
    .fh-chart-card { background:#fff; border-radius:14px; padding:16px; box-shadow:0 6px 14px rgba(0,0,0,0.04); min-height:280px; }
    .fh-chart-card h6 { font-weight:700; color:#475569; margin-bottom:10px; }
    [data-theme="dark"] .fh-chart-card { background:#2d3748; }
    [data-theme="dark"] .fh-chart-card h6 { color:#cbd5e1; }
    .fh-chart-wrapper { position:relative; height:220px; }

    .fh-filters { background:#fff; border-radius:14px; padding:18px; box-shadow:0 6px 14px rgba(0,0,0,0.04); margin-bottom:18px; }
    [data-theme="dark"] .fh-filters { background:#2d3748; }
    .fh-filters-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
    .fh-filters label { font-size:.82rem; font-weight:600; color:#64748b; margin-bottom:4px; }
    .fh-filters .form-control, .fh-filters .form-select { font-size:.9rem; }
    .fh-presets { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0 8px; }
    .fh-preset-btn { background:#eef2ff; color:#4338ca; border:1px solid #c7d2fe; padding:5px 12px; border-radius:18px; font-size:.82rem; font-weight:600; cursor:pointer; transition:all .2s; }
    .fh-preset-btn:hover { background:#4338ca; color:#fff; }
    .fh-preset-btn.active { background:#4338ca; color:#fff; }
    [data-theme="dark"] .fh-preset-btn { background:#374151; color:#93c5fd; border-color:#4a5568; }

    .fh-grid-card { background:#fff; border-radius:14px; padding:0; overflow:hidden; box-shadow:0 6px 14px rgba(0,0,0,0.04); }
    [data-theme="dark"] .fh-grid-card { background:#2d3748; }
    .fh-grid-toolbar { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border-bottom:1px solid #e5e7eb; flex-wrap:wrap; gap:8px; }
    [data-theme="dark"] .fh-grid-toolbar { border-color:#4a5568; }
    .fh-grid-toolbar h5 { margin:0; font-weight:700; color:#1e293b; font-size:1.05rem; }
    [data-theme="dark"] .fh-grid-toolbar h5 { color:#e2e8f0; }

    .fh-grid-scroll { overflow-x:auto; }
    .fh-table { width:100%; border-collapse:separate; border-spacing:0; font-size:.88rem; }
    .fh-table th { background:#f1f5f9; color:#475569; font-weight:700; font-size:.82rem; padding:10px 8px; border-bottom:2px solid #e2e8f0; white-space:nowrap; position:sticky; top:0; z-index:5; }
    .fh-table th.sortable { cursor:pointer; user-select:none; }
    .fh-table th.sortable:hover { background:#e0e7ff; color:#4338ca; }
    [data-theme="dark"] .fh-table th { background:#1f2937; color:#cbd5e1; border-color:#4a5568; }
    [data-theme="dark"] .fh-table th.sortable:hover { background:#374151; }

    .fh-table td { padding:9px 8px; border-bottom:1px solid #f1f5f9; color:#1f2937; vertical-align:middle; white-space:nowrap; }
    [data-theme="dark"] .fh-table td { color:#e2e8f0; border-color:#4a5568; }
    .fh-table tbody tr:hover { background:rgba(67,56,202,0.04); }
    [data-theme="dark"] .fh-table tbody tr:hover { background:rgba(147,197,253,0.06); }
    .fh-table td.numeric, .fh-table th.numeric { text-align:left; font-variant-numeric:tabular-nums; }

    .fh-table th.fh-col-select, .fh-table td.fh-col-select { position:sticky; right:0; background:#fff; z-index:4; text-align:center; }
    [data-theme="dark"] .fh-table td.fh-col-select { background:#2d3748; }
    [data-theme="dark"] .fh-table th.fh-col-select { background:#1f2937; }

    .fh-type-pill { display:inline-block; padding:3px 10px; border-radius:12px; font-size:.75rem; font-weight:700; }
    .fh-type-cash    { background:#d1fae5; color:#065f46; }
    .fh-type-partial { background:#fef3c7; color:#92400e; }
    .fh-type-full    { background:#e5e7eb; color:#374151; }
    .fh-type-ticket  { background:#dbeafe; color:#1e40af; }
    [data-theme="dark"] .fh-type-cash    { background:rgba(16,185,129,.2); color:#6ee7b7; }
    [data-theme="dark"] .fh-type-partial { background:rgba(245,158,11,.2); color:#fcd34d; }
    [data-theme="dark"] .fh-type-full    { background:rgba(156,163,175,.2); color:#d1d5db; }
    [data-theme="dark"] .fh-type-ticket  { background:rgba(59,130,246,.2); color:#93c5fd; }

    .fh-status-pill { padding:3px 10px; border-radius:12px; font-size:.72rem; font-weight:700; }
    .fh-status-paid      { background:#d1fae5; color:#065f46; }
    .fh-status-issued    { background:#dbeafe; color:#1e40af; }
    .fh-status-cancelled { background:#fee2e2; color:#991b1b; }

    .fh-table tfoot td { background:#f8fafc; font-weight:800; color:#1e293b; border-top:2px solid #cbd5e1; }
    [data-theme="dark"] .fh-table tfoot td { background:#1f2937; color:#e2e8f0; border-color:#4a5568; }

    .fh-pagination { display:flex; justify-content:space-between; align-items:center; padding:12px 18px; border-top:1px solid #e5e7eb; flex-wrap:wrap; gap:8px; }
    [data-theme="dark"] .fh-pagination { border-color:#4a5568; }
    .fh-pagination-info { color:#64748b; font-size:.85rem; }
    .fh-pagination-buttons { display:flex; gap:4px; align-items:center; }
    .fh-page-btn { min-width:32px; height:32px; padding:0 8px; border:1px solid #d1d5db; background:#fff; border-radius:6px; cursor:pointer; font-size:.85rem; display:inline-flex; align-items:center; justify-content:center; }
    .fh-page-btn:hover:not(:disabled) { background:#eef2ff; color:#4338ca; border-color:#c7d2fe; }
    .fh-page-btn.active { background:#4338ca; color:#fff; border-color:#4338ca; }
    .fh-page-btn:disabled { opacity:.5; cursor:not-allowed; }
    [data-theme="dark"] .fh-page-btn { background:#374151; color:#e2e8f0; border-color:#4a5568; }

    .fh-drawer-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:1055; opacity:0; transition:opacity .25s; backdrop-filter:blur(2px); display:none; }
    .fh-drawer-backdrop.show { opacity:1; }
    .fh-drawer { position:fixed; top:0; left:0; height:100vh; width:min(560px,95vw); background:#fff; z-index:1056; transform:translateX(-100%); transition:transform .3s; box-shadow:4px 0 20px rgba(0,0,0,0.15); display:flex; flex-direction:column; }
    .fh-drawer.show { transform:translateX(0); }
    [data-theme="dark"] .fh-drawer { background:#1e293b; color:#e2e8f0; }
    .fh-drawer-header { padding:14px 20px; border-bottom:1px solid #e5e7eb; display:flex; justify-content:space-between; align-items:center; background:linear-gradient(135deg,#4160e0 0%,#2b4196 100%); color:#fff; }
    .fh-drawer-header h5 { margin:0; font-weight:700; font-size:1.05rem; }
    .fh-drawer-body { padding:18px 20px; overflow-y:auto; flex:1; }
    .fh-drawer-footer { padding:12px 20px; border-top:1px solid #e5e7eb; display:flex; gap:8px; justify-content:flex-end; }
    [data-theme="dark"] .fh-drawer-footer, [data-theme="dark"] .fh-drawer-body { border-color:#4a5568; }

    .fh-detail-section { margin-bottom:18px; }
    .fh-detail-section h6 { font-weight:700; color:#4338ca; margin-bottom:8px; font-size:.92rem; }
    [data-theme="dark"] .fh-detail-section h6 { color:#93c5fd; }
    .fh-detail-grid { display:grid; grid-template-columns:135px 1fr; gap:6px 12px; font-size:.87rem; }
    .fh-detail-grid .label { color:#64748b; font-weight:600; }
    .fh-detail-grid .value { color:#1f2937; word-break:break-word; }
    [data-theme="dark"] .fh-detail-grid .value { color:#e2e8f0; }
    [data-theme="dark"] .fh-detail-grid .label { color:#94a3b8; }

    .fh-services-table { width:100%; font-size:.82rem; margin-top:6px; border-collapse:collapse; }
    .fh-services-table th, .fh-services-table td { padding:6px 8px; border-bottom:1px solid #e5e7eb; }
    .fh-services-table th { background:#f8fafc; font-weight:700; color:#475569; }
    [data-theme="dark"] .fh-services-table th { background:#374151; color:#cbd5e1; }
    [data-theme="dark"] .fh-services-table td, [data-theme="dark"] .fh-services-table th { border-color:#4a5568; }

    .fh-grid-state { padding:60px 20px; text-align:center; color:#64748b; }
    .fh-grid-state i { font-size:3rem; opacity:.4; display:block; margin-bottom:10px; }

    .fh-sort-asc::after  { content:' ▲'; font-size:.7rem; color:#4338ca; }
    .fh-sort-desc::after { content:' ▼'; font-size:.7rem; color:#4338ca; }

    .fh-action-btn { background:transparent; border:none; padding:4px 6px; border-radius:6px; color:#64748b; cursor:pointer; font-size:1rem; transition:all .15s; }
    .fh-action-btn:hover { background:#eef2ff; color:#4338ca; }
    [data-theme="dark"] .fh-action-btn { color:#cbd5e1; }
    [data-theme="dark"] .fh-action-btn:hover { background:#374151; color:#93c5fd; }

    .fh-soon-badge { background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:10px; font-size:.7rem; font-weight:600; margin-right:6px; }
    `;
    const style = document.createElement('style');
    style.id = 'finance-hub-styles';
    style.textContent = css;
    document.head.appendChild(style);
}

/* =========================================================================
 * 4. الـ Utilities
 * ========================================================================= */
const FinanceUtils = {
    fmtMoney(v, withLabel = true) {
        const n = Number(v || 0);
        const s = n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        return withLabel ? `${s} ${FinanceState.currencyLabel}` : s;
    },
    fmtNumber(v) {
        return Number(v || 0).toLocaleString('en-US');
    },
    fmtDateTime(raw) {
        if (!raw) return '—';
        try {
            const d = new Date(String(raw).replace(' ', 'T'));
            if (isNaN(d.getTime())) return raw;
            const date = d.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' });
            const time = d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false });
            return `${date} ${time}`;
        } catch (e) { return raw; }
    },
    fmtDate(raw) {
        if (!raw) return '—';
        try {
            const d = new Date(String(raw).replace(' ', 'T'));
            if (isNaN(d.getTime())) return raw;
            return d.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' });
        } catch (e) { return raw; }
    },
    esc(v) {
        if (v === null || v === undefined) return '';
        return String(v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    },
    debounce(fn, delay = 300) {
        let t;
        return function(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), delay);
        };
    },
    typeClass(code, status) {
        if (status === 'cancelled') return 'fh-type-full';
        switch ((code || '').toUpperCase()) {
            case 'A': return 'fh-type-cash';
            case 'B': return 'fh-type-partial';
            case 'C': return 'fh-type-full';
            case 'T': return 'fh-type-ticket';
            default:  return 'fh-type-full';
        }
    },
    statusLabel(s) {
        switch (s) {
            case 'paid':      return 'محصّل';
            case 'issued':    return 'مُصدَر';
            case 'cancelled': return 'ملغى';
            default:          return s || '—';
        }
    },
    statusClass(s) {
        switch (s) {
            case 'paid':      return 'fh-status-paid';
            case 'issued':    return 'fh-status-issued';
            case 'cancelled': return 'fh-status-cancelled';
            default:          return 'fh-status-paid';
        }
    },
    cleanFilters() {
        const f = FinanceState.filters;
        const out = {};
        if (f.period) out.period = f.period;
        if (f.from)   out.from   = f.from;
        if (f.to)     out.to     = f.to;
        if (Array.isArray(f.doc_codes)      && f.doc_codes.length)      out.doc_codes = f.doc_codes;
        if (Array.isArray(f.statuses)       && f.statuses.length)       out.statuses = f.statuses;
        if (Array.isArray(f.accountant_ids) && f.accountant_ids.length) out.accountant_ids = f.accountant_ids;
        if (Array.isArray(f.doctor_ids)     && f.doctor_ids.length)     out.doctor_ids = f.doctor_ids;
        if (Array.isArray(f.service_ids)    && f.service_ids.length)    out.service_ids = f.service_ids;
        if (Array.isArray(f.category_ids)   && f.category_ids.length)   out.category_ids = f.category_ids;
        if (Array.isArray(f.department_ids) && f.department_ids.length) out.department_ids = f.department_ids;
        if (f.amount_min !== null && f.amount_min !== '') out.amount_min = Number(f.amount_min);
        if (f.amount_max !== null && f.amount_max !== '') out.amount_max = Number(f.amount_max);
        if (f.has_ministry_share) out.has_ministry_share = true;
        if (f.query && String(f.query).trim() !== '') out.query = String(f.query).trim();
        return out;
    },
};

/* =========================================================================
 * 5. الكائن الرئيسي Finance (Public API)
 * ========================================================================= */
const Finance = {

    /* ===== viewHub: نقطة الدخول ===== */
    viewHub() {
        injectFinanceStyles();
        Core.navigateTo('viewFinanceHub', async () => {
            const main = document.getElementById('mainContent');
            main.innerHTML = `
                <div class="container-fluid fh-page animate-in" id="finance-hub-root">
                    <div class="fh-header">
                        <h2><i class="bi bi-bank2"></i> المركز المالي والسندي الشامل</h2>
                        <div class="fh-header-actions">
                            <button class="btn btn-sm btn-outline-primary" onclick="Finance.refreshAll()">
                                <i class="bi bi-arrow-clockwise"></i> تحديث
                            </button>
                            <span class="fh-soon-badge" title="ميزات قادمة في M5.2">
                                <i class="bi bi-info-circle"></i> التصدير والطباعة قريباً
                            </span>
                        </div>
                    </div>

                    <div id="fh-kpis" class="fh-kpi-grid">${Finance._kpiSkeleton()}</div>

                    <div id="fh-charts" class="fh-charts-grid">
                        <div class="fh-chart-card"><h6>إيرادات آخر 30 يوم</h6><div class="fh-chart-wrapper"><canvas id="fh-chart-revenue30"></canvas></div></div>
                        <div class="fh-chart-card"><h6>توزيع أنواع الحركات</h6><div class="fh-chart-wrapper"><canvas id="fh-chart-typedist"></canvas></div></div>
                        <div class="fh-chart-card"><h6>أعلى 10 خدمات</h6><div class="fh-chart-wrapper"><canvas id="fh-chart-topservices"></canvas></div></div>
                        <div class="fh-chart-card"><h6>أداء المحاسبين</h6><div class="fh-chart-wrapper"><canvas id="fh-chart-accountants"></canvas></div></div>
                    </div>

                    <div id="fh-filters-container"></div>
                    <div id="fh-grid-container"></div>
                </div>
            `;

            if (!FinanceState.options.doc_types || !FinanceState.options.doc_types.length) {
                await Finance.loadFilterOptions();
            }
            Finance._initColumns();
            Finance.renderFiltersPanel();
            Finance.renderGridShell();

            await Promise.all([
                Finance.loadOverview(),
                Finance.loadTransactions(),
            ]);
        });
    },

    /* ===== تحميل خيارات الفلاتر ===== */
    async loadFilterOptions() {
        try {
            const res = await Core.apiCall('finance/filter_options', 'GET');
            if (res && res.success && res.data) {
                FinanceState.options = {
                    doc_types: res.data.doc_types || [],
                    statuses: res.data.statuses || [],
                    accountants: res.data.accountants || [],
                    doctors: res.data.doctors || [],
                    departments: res.data.departments || [],
                    categories: res.data.categories || [],
                    services: res.data.services || [],
                    ticket_ministry_shares: res.data.ticket_ministry_shares || { morning: 30, evening: 100 },
                };
                FinanceState.currencyLabel = res.data.currency_label || 'ريال';
                FinanceState.scope = res.data.scope || FinanceState.scope;
            } else {
                Core.showAlert('تعذر تحميل خيارات الفلاتر.', 'error');
            }
        } catch (e) {
            console.error('loadFilterOptions:', e);
            Core.showAlert('تعذر تحميل خيارات الفلاتر.', 'error');
        }
    },

    /* ===== KPIs Skeleton ===== */
    _kpiSkeleton() {
        const cards = [
            ['blue','إجمالي اليوم','bi-cash-coin'],
            ['green','الكاش اليوم','bi-coin'],
            ['orange','الإعفاءات اليوم','bi-shield-check'],
            ['purple','التذاكر اليوم','bi-ticket-perforated'],
            ['red','حصة الوزارة (الشهر)','bi-buildings'],
            ['teal','صافي المركز (الشهر)','bi-graph-up-arrow'],
        ];
        return cards.map(([color,label,icon]) => `
            <div class="fh-kpi fh-kpi-${color}">
                <i class="bi ${icon} fh-kpi-icon"></i>
                <div class="fh-kpi-label">${label}</div>
                <div class="fh-kpi-value">—</div>
                <div class="fh-kpi-sub">جاري التحميل...</div>
            </div>`).join('');
    },

    /* ===== Overview (KPIs + Charts) ===== */
    async loadOverview() {
        try {
            const res = await Core.apiCall('finance/overview', 'POST', FinanceUtils.cleanFilters());
            if (res && res.success && res.data) {
                FinanceState.lastOverview = res.data;
                Finance.renderKpis(res.data.kpis);
                Finance.renderCharts(res.data.charts);
            } else {
                console.warn('overview failed', res);
            }
        } catch (e) {
            console.error('loadOverview:', e);
        }
    },

    renderKpis(kpis) {
        if (!kpis) return;
        const el = document.getElementById('fh-kpis');
        if (!el) return;
        const today = kpis.today || {};
        const month = kpis.month || {};
        const fmt = (v) => FinanceUtils.fmtMoney(v);
        el.innerHTML = `
            <div class="fh-kpi fh-kpi-blue">
                <i class="bi bi-cash-coin fh-kpi-icon"></i>
                <div class="fh-kpi-label">إجمالي اليوم</div>
                <div class="fh-kpi-value">${fmt(today.total)}</div>
                <div class="fh-kpi-sub">${(today.count_cash||0)+(today.count_partial||0)+(today.count_full||0)+(today.tickets_count||0)} حركة</div>
            </div>
            <div class="fh-kpi fh-kpi-green">
                <i class="bi bi-coin fh-kpi-icon"></i>
                <div class="fh-kpi-label">الكاش اليوم</div>
                <div class="fh-kpi-value">${fmt(today.cash)}</div>
                <div class="fh-kpi-sub">${today.count_cash||0} كاش + ${today.tickets_count||0} تذاكر</div>
            </div>
            <div class="fh-kpi fh-kpi-orange">
                <i class="bi bi-shield-check fh-kpi-icon"></i>
                <div class="fh-kpi-label">الإعفاءات اليوم</div>
                <div class="fh-kpi-value">${fmt(today.exempts)}</div>
                <div class="fh-kpi-sub">جزئي: ${today.count_partial||0} | كلي: ${today.count_full||0}</div>
            </div>
            <div class="fh-kpi fh-kpi-purple">
                <i class="bi bi-ticket-perforated fh-kpi-icon"></i>
                <div class="fh-kpi-label">التذاكر اليوم</div>
                <div class="fh-kpi-value">${fmt(today.tickets_amount)}</div>
                <div class="fh-kpi-sub">عدد التذاكر: ${today.tickets_count||0}</div>
            </div>
            <div class="fh-kpi fh-kpi-red">
                <i class="bi bi-buildings fh-kpi-icon"></i>
                <div class="fh-kpi-label">حصة الوزارة (الشهر)</div>
                <div class="fh-kpi-value">${fmt(month.ministry_share)}</div>
                <div class="fh-kpi-sub">من ${month.row_count||0} حركة</div>
            </div>
            <div class="fh-kpi fh-kpi-teal">
                <i class="bi bi-graph-up-arrow fh-kpi-icon"></i>
                <div class="fh-kpi-label">صافي المركز (الشهر)</div>
                <div class="fh-kpi-value">${fmt(month.center_share)}</div>
                <div class="fh-kpi-sub">إجمالي ${fmt(month.total)}</div>
            </div>`;
    },

    renderCharts(charts) {
        if (!charts || typeof Chart === 'undefined') return;
        Object.keys(FinanceState.charts).forEach(k => {
            if (FinanceState.charts[k]) {
                try { FinanceState.charts[k].destroy(); } catch (e) {}
                FinanceState.charts[k] = null;
            }
        });
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#e2e8f0' : '#475569';
        const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

        // 1) Revenue 30 days (Line)
        const rev = charts.revenue_30days || [];
        const c1 = document.getElementById('fh-chart-revenue30');
        if (c1) {
            FinanceState.charts.revenue30 = new Chart(c1, {
                type: 'line',
                data: {
                    labels: rev.map(r => FinanceUtils.fmtDate(r.day)),
                    datasets: [{
                        label: 'الإيراد اليومي',
                        data: rev.map(r => Number(r.amount || 0)),
                        borderColor: '#4338ca',
                        backgroundColor: 'rgba(67,56,202,0.12)',
                        tension: 0.35, fill: true, pointRadius: 3, pointHoverRadius: 5,
                    }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
                        y: { ticks: { color: textColor, callback: v => FinanceUtils.fmtNumber(v) }, grid: { color: gridColor } },
                    },
                },
            });
        }

        // 2) Type Distribution (Doughnut)
        const td = charts.type_distribution || [];
        const c2 = document.getElementById('fh-chart-typedist');
        if (c2 && td.length) {
            const colors = ['#10b981','#f59e0b','#9ca3af','#3b82f6'];
            FinanceState.charts.typeDist = new Chart(c2, {
                type: 'doughnut',
                data: {
                    labels: td.map(t => t.label),
                    datasets: [{
                        data: td.map(t => Number(t.value || 0)),
                        backgroundColor: td.map((_, i) => colors[i % colors.length]),
                        borderWidth: 2,
                        borderColor: isDark ? '#1e293b' : '#fff',
                    }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: textColor, font: { size: 11 } } },
                        tooltip: { callbacks: { label: c => `${c.label}: ${FinanceUtils.fmtMoney(c.parsed)}` } },
                    },
                },
            });
        } else if (c2) {
            c2.parentElement.innerHTML = `<div class="fh-grid-state"><i class="bi bi-pie-chart"></i>لا توجد بيانات</div>`;
        }

        // 3) Top Services (Bar horizontal)
        const ts = charts.top_services || [];
        const c3 = document.getElementById('fh-chart-topservices');
        if (c3 && ts.length) {
            FinanceState.charts.topServices = new Chart(c3, {
                type: 'bar',
                data: {
                    labels: ts.map(s => s.name),
                    datasets: [{
                        label: 'الإيراد',
                        data: ts.map(s => Number(s.revenue || 0)),
                        backgroundColor: 'rgba(20,184,166,0.7)',
                        borderColor: '#14b8a6', borderWidth: 1,
                    }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: textColor, callback: v => FinanceUtils.fmtNumber(v) }, grid: { color: gridColor } },
                        y: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
                    },
                },
            });
        } else if (c3) {
            c3.parentElement.innerHTML = `<div class="fh-grid-state"><i class="bi bi-bar-chart"></i>لا توجد بيانات</div>`;
        }

        // 4) Accountants (Bar)
        const ap = charts.accountants_performance || [];
        const c4 = document.getElementById('fh-chart-accountants');
        if (c4 && ap.length) {
            FinanceState.charts.accountants = new Chart(c4, {
                type: 'bar',
                data: {
                    labels: ap.map(a => a.name),
                    datasets: [{
                        label: 'الإيراد',
                        data: ap.map(a => Number(a.revenue || 0)),
                        backgroundColor: 'rgba(139,92,246,0.7)',
                        borderColor: '#8b5cf6', borderWidth: 1,
                    }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { afterLabel: c => `الحركات: ${FinanceUtils.fmtNumber(ap[c.dataIndex].count)}` } },
                    },
                    scales: {
                        x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
                        y: { ticks: { color: textColor, callback: v => FinanceUtils.fmtNumber(v) }, grid: { color: gridColor } },
                    },
                },
            });
        } else if (c4) {
            c4.parentElement.innerHTML = `<div class="fh-grid-state"><i class="bi bi-people"></i>لا توجد بيانات</div>`;
        }
    },

    /* ===== تحديث شامل ===== */
    async refreshAll() {
        FinanceState.selectedIds.clear();
        await Promise.all([
            Finance.loadOverview(),
            Finance.loadTransactions(),
        ]);
        Core.showAlert('تم تحديث البيانات.', 'success');
    },
};

/* =========================================================================
 * 6. لوحة الفلاتر (Smart Filters Panel)
 * ========================================================================= */
Object.assign(Finance, {

    renderFiltersPanel() {
        const container = document.getElementById('fh-filters-container');
        if (!container) return;
        const opt = FinanceState.options;
        const f = FinanceState.filters;

        const docTypeOpts = (opt.doc_types || []).map(d =>
            `<option value="${d.code}" ${f.doc_codes.includes(d.code) ? 'selected' : ''}>${FinanceUtils.esc(d.name)} (${d.code})</option>`
        ).join('');
        const statusOpts = (opt.statuses || []).map(s =>
            `<option value="${s.code}" ${f.statuses.includes(s.code) ? 'selected' : ''}>${FinanceUtils.esc(s.name)}</option>`
        ).join('');
        const accountantOpts = (opt.accountants || []).map(a =>
            `<option value="${a.id}" ${f.accountant_ids.includes(a.id) ? 'selected' : ''}>${FinanceUtils.esc(a.name)}</option>`
        ).join('');
        const doctorOpts = (opt.doctors || []).map(d =>
            `<option value="${d.id}" ${f.doctor_ids.includes(d.id) ? 'selected' : ''}>${FinanceUtils.esc(d.name)}</option>`
        ).join('');
        const deptOpts = (opt.departments || []).map(d =>
            `<option value="${d.id}" ${f.department_ids.includes(d.id) ? 'selected' : ''}>${FinanceUtils.esc(d.name)}</option>`
        ).join('');
        const catOpts = (opt.categories || []).map(c =>
            `<option value="${c.id}" ${f.category_ids.includes(c.id) ? 'selected' : ''}>${FinanceUtils.esc(c.name)}</option>`
        ).join('');
        const svcOpts = (opt.services || []).map(s =>
            `<option value="${s.id}" ${f.service_ids.includes(s.id) ? 'selected' : ''}>${FinanceUtils.esc(s.name)}</option>`
        ).join('');

        container.innerHTML = `
            <div class="fh-filters">
                <h6 style="margin-bottom:12px;font-weight:700;color:#475569;">
                    <i class="bi bi-funnel-fill"></i> محرك البحث الذكي
                </h6>
                <div class="fh-presets">
                    <button class="fh-preset-btn ${f.period==='today'?'active':''}" onclick="Finance.applyPreset('today')">اليوم</button>
                    <button class="fh-preset-btn ${f.period==='week'?'active':''}" onclick="Finance.applyPreset('week')">الأسبوع</button>
                    <button class="fh-preset-btn ${f.period==='month'?'active':''}" onclick="Finance.applyPreset('month')">الشهر</button>
                    <button class="fh-preset-btn ${f.period==='year'?'active':''}" onclick="Finance.applyPreset('year')">السنة</button>
                    <button class="fh-preset-btn" onclick="Finance.applyPreset('exempts_only')">الإعفاءات فقط</button>
                    <button class="fh-preset-btn" onclick="Finance.applyPreset('tickets_only')">التذاكر فقط</button>
                    <button class="fh-preset-btn" onclick="Finance.applyPreset('cash_only')">الكاش فقط</button>
                    <button class="fh-preset-btn" onclick="Finance.applyPreset('ministry_due')">حصة الوزارة</button>
                    <button class="fh-preset-btn" onclick="Finance.applyPreset('cancelled')">الملغاة</button>
                </div>
                <div class="fh-filters-grid">
                    <div>
                        <label>من تاريخ</label>
                        <input type="date" class="form-control form-control-sm" id="fh-from"
                               value="${f.from ? f.from.substring(0,10) : ''}"
                               onchange="Finance.setDateFilter('from', this.value)">
                    </div>
                    <div>
                        <label>إلى تاريخ</label>
                        <input type="date" class="form-control form-control-sm" id="fh-to"
                               value="${f.to ? f.to.substring(0,10) : ''}"
                               onchange="Finance.setDateFilter('to', this.value)">
                    </div>
                    <div>
                        <label>نوع السند (Ctrl للتعدد)</label>
                        <select class="form-select form-select-sm" multiple id="fh-doc-codes" size="3"
                                onchange="Finance.setMultiSelect('doc_codes', this)">${docTypeOpts}</select>
                    </div>
                    <div>
                        <label>الحالة (Ctrl للتعدد)</label>
                        <select class="form-select form-select-sm" multiple id="fh-statuses" size="3"
                                onchange="Finance.setMultiSelect('statuses', this)">${statusOpts}</select>
                    </div>
                    <div>
                        <label>المحاسب</label>
                        <select class="form-select form-select-sm" multiple id="fh-accountants" size="3"
                                onchange="Finance.setMultiSelect('accountant_ids', this, true)">${accountantOpts}</select>
                    </div>
                    <div>
                        <label>الطبيب</label>
                        <select class="form-select form-select-sm" multiple id="fh-doctors" size="3"
                                onchange="Finance.setMultiSelect('doctor_ids', this, true)">${doctorOpts}</select>
                    </div>
                    <div>
                        <label>القسم</label>
                        <select class="form-select form-select-sm" multiple id="fh-departments" size="3"
                                onchange="Finance.setMultiSelect('department_ids', this, true)">${deptOpts}</select>
                    </div>
                    <div>
                        <label>تصنيف الخدمة</label>
                        <select class="form-select form-select-sm" multiple id="fh-categories" size="3"
                                onchange="Finance.setMultiSelect('category_ids', this, true)">${catOpts}</select>
                    </div>
                    <div>
                        <label>الخدمة</label>
                        <select class="form-select form-select-sm" multiple id="fh-services" size="3"
                                onchange="Finance.setMultiSelect('service_ids', this, true)">${svcOpts}</select>
                    </div>
                    <div>
                        <label>أدنى مبلغ</label>
                        <input type="number" min="0" class="form-control form-control-sm" id="fh-amount-min"
                               value="${f.amount_min ?? ''}"
                               onchange="Finance.setFilter('amount_min', this.value === '' ? null : Number(this.value))">
                    </div>
                    <div>
                        <label>أعلى مبلغ</label>
                        <input type="number" min="0" class="form-control form-control-sm" id="fh-amount-max"
                               value="${f.amount_max ?? ''}"
                               onchange="Finance.setFilter('amount_max', this.value === '' ? null : Number(this.value))">
                    </div>
                    <div>
                        <label>بحث (اسم / تسلسل / رقم)</label>
                        <input type="text" class="form-control form-control-sm" id="fh-query"
                               placeholder="ابحث..." value="${FinanceUtils.esc(f.query || '')}"
                               oninput="Finance._debouncedSearch(this.value)">
                    </div>
                </div>
                <div class="mt-3 d-flex align-items-center flex-wrap gap-2">
                    <div class="form-check ms-2">
                        <input type="checkbox" class="form-check-input" id="fh-min-share"
                               ${f.has_ministry_share ? 'checked' : ''}
                               onchange="Finance.setFilter('has_ministry_share', this.checked); Finance.applyFilters();">
                        <label class="form-check-label" for="fh-min-share" style="font-size:.85rem;">
                            حركات فيها حصة وزارة فقط
                        </label>
                    </div>
                    <div class="ms-auto d-flex gap-2 flex-wrap">
                        <button class="btn btn-sm btn-primary" onclick="Finance.applyFilters()">
                            <i class="bi bi-search"></i> تطبيق
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="Finance.clearFilters()">
                            <i class="bi bi-x-circle"></i> مسح
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    setFilter(key, value) {
        FinanceState.filters[key] = value;
    },

    setDateFilter(key, dateStr) {
        if (!dateStr) {
            FinanceState.filters[key] = null;
        } else {
            FinanceState.filters[key] = key === 'from'
                ? dateStr + ' 00:00:00'
                : dateStr + ' 23:59:59';
        }
        FinanceState.filters.period = 'custom';
    },

    setMultiSelect(key, selectEl, isNumeric = false) {
        const values = Array.from(selectEl.selectedOptions).map(o => isNumeric ? Number(o.value) : o.value);
        FinanceState.filters[key] = values.filter(v => v !== '' && v !== null && !Number.isNaN(v));
    },

    applyFilters() {
        FinanceState.page = 1;
        FinanceState.selectedIds.clear();
        Finance.loadTransactions();
        Finance.loadOverview();
    },

    clearFilters() {
        FinanceState.filters = {
            period: 'month',
            from: null, to: null,
            doc_codes: [], statuses: [],
            accountant_ids: [], doctor_ids: [],
            service_ids: [], category_ids: [], department_ids: [],
            amount_min: null, amount_max: null,
            has_ministry_share: false,
            query: '',
        };
        FinanceState.page = 1;
        Finance.renderFiltersPanel();
        Finance.applyFilters();
    },

    applyPreset(preset) {
        const f = FinanceState.filters;
        switch (preset) {
            case 'today':  f.period = 'today';  f.from = null; f.to = null; break;
            case 'week':   f.period = 'week';   f.from = null; f.to = null; break;
            case 'month':  f.period = 'month';  f.from = null; f.to = null; break;
            case 'year':   f.period = 'year';   f.from = null; f.to = null; break;
            case 'exempts_only': f.doc_codes = ['B','C']; f.statuses = []; break;
            case 'tickets_only': f.doc_codes = ['T'];     f.statuses = []; break;
            case 'cash_only':    f.doc_codes = ['A'];     f.statuses = []; break;
            case 'ministry_due': f.has_ministry_share = true; break;
            case 'cancelled':    f.statuses = ['cancelled']; break;
        }
        Finance.renderFiltersPanel();
        Finance.applyFilters();
    },

    _debouncedSearch: null,
});

// Debounce للبحث الحر بعد إنشاء Finance
Finance._debouncedSearch = FinanceUtils.debounce((val) => {
    FinanceState.filters.query = val;
    Finance.applyFilters();
}, 450);

/* =========================================================================
 * 7. شبكة البيانات الموحّدة (Unified Data Grid)
 * ========================================================================= */
Object.assign(Finance, {

    _initColumns() {
        // في M5.1، نستخدم الإعدادات الافتراضية فقط (Column Manager في M5.2).
        FinanceState.columns = FINANCE_COLUMN_CATALOG.map((c, i) => ({
            ...c, visible: c.default, order: i,
        }));
    },

    _visibleColumns() {
        return (FinanceState.columns || []).filter(c => c.visible);
    },

    renderGridShell() {
        const container = document.getElementById('fh-grid-container');
        if (!container) return;
        container.innerHTML = `
            <div class="fh-grid-card">
                <div class="fh-grid-toolbar">
                    <h5><i class="bi bi-table"></i> سجل الحركات الموحّد</h5>
                    <div class="d-flex align-items-center gap-2 flex-wrap">
                        <span id="fh-selected-info" class="text-muted small"></span>
                        <select class="form-select form-select-sm" style="width:auto;" id="fh-per-page"
                                onchange="Finance.changePerPage(Number(this.value))">
                            <option value="25"  ${FinanceState.perPage===25?'selected':''}>25</option>
                            <option value="50"  ${FinanceState.perPage===50?'selected':''}>50</option>
                            <option value="100" ${FinanceState.perPage===100?'selected':''}>100</option>
                            <option value="200" ${FinanceState.perPage===200?'selected':''}>200</option>
                        </select>
                    </div>
                </div>
                <div class="fh-grid-scroll" id="fh-grid-scroll">
                    <div class="fh-grid-state"><i class="bi bi-hourglass-split"></i> جاري تحميل البيانات...</div>
                </div>
                <div class="fh-pagination" id="fh-pagination" style="display:none;"></div>
            </div>
        `;
    },

    changePerPage(n) {
        FinanceState.perPage = n;
        FinanceState.page = 1;
        Finance.loadTransactions();
    },

    async loadTransactions() {
        const scroll = document.getElementById('fh-grid-scroll');
        if (!scroll) return;
        if (FinanceState.loading) return;
        FinanceState.loading = true;
        scroll.innerHTML = `<div class="fh-grid-state"><i class="bi bi-hourglass-split"></i> جاري تحميل البيانات...</div>`;

        try {
            const payload = {
                ...FinanceUtils.cleanFilters(),
                sort_by: FinanceState.sortBy,
                sort_dir: FinanceState.sortDir,
                page: FinanceState.page,
                per_page: FinanceState.perPage,
            };
            const res = await Core.apiCall('finance/transactions', 'POST', payload);
            if (!res || !res.success) {
                scroll.innerHTML = `<div class="fh-grid-state"><i class="bi bi-exclamation-triangle"></i> ${FinanceUtils.esc(res?.message || 'تعذر جلب البيانات')}</div>`;
                FinanceState.loading = false;
                return;
            }
            FinanceState.lastResponse = res.data;
            FinanceState.rows = res.data.rows || [];
            Finance.renderGridBody();
            Finance.renderPagination();
        } catch (e) {
            console.error('loadTransactions:', e);
            scroll.innerHTML = `<div class="fh-grid-state"><i class="bi bi-exclamation-triangle"></i> خطأ في الاتصال</div>`;
        } finally {
            FinanceState.loading = false;
        }
    },

    renderGridBody() {
        const scroll = document.getElementById('fh-grid-scroll');
        if (!scroll) return;
        const rows = FinanceState.rows || [];
        const pageTotal = FinanceState.lastResponse?.page_total || {};

        if (!rows.length) {
            scroll.innerHTML = `<div class="fh-grid-state"><i class="bi bi-inbox"></i> لا توجد حركات تطابق الفلاتر</div>`;
            Finance._updateSelectedInfo();
            return;
        }

        const visible = Finance._visibleColumns();
        const thead = `<thead><tr>${visible.map(col => Finance._renderHeaderCell(col)).join('')}</tr></thead>`;
        const tbody = `<tbody>${rows.map(r => Finance._renderRow(r, visible)).join('')}</tbody>`;
        const tfoot = `<tfoot><tr>${visible.map(col => {
            if (col.key === 'select') return `<td class="fh-col-select" style="text-align:center;">Σ</td>`;
            if (col.key === 'patient_name') return `<td>الإجماليات (${rows.length} سجل):</td>`;
            if (col.numeric && ['total','cash_amount','exempt_amount','center_share','ministry_share'].includes(col.key)) {
                return `<td class="numeric">${FinanceUtils.fmtMoney(pageTotal[col.key])}</td>`;
            }
            return `<td>—</td>`;
        }).join('')}</tr></tfoot>`;

        scroll.innerHTML = `<table class="fh-table">${thead}${tbody}${tfoot}</table>`;
        Finance._updateSelectedInfo();
    },

    _renderHeaderCell(col) {
        if (col.key === 'select') {
            const all = FinanceState.rows.length > 0 && FinanceState.rows.every(r => FinanceState.selectedIds.has(r.txn_id));
            return `<th class="fh-col-select" style="width:${col.width}">
                <input type="checkbox" ${all ? 'checked' : ''} onchange="Finance.toggleSelectAll(this.checked)">
            </th>`;
        }
        const sortable = col.sortable && col.sortField;
        const isActive = sortable && FinanceState.sortBy === col.sortField;
        const sortCls  = isActive ? (FinanceState.sortDir === 'ASC' ? 'fh-sort-asc' : 'fh-sort-desc') : '';
        const numericCls = col.numeric ? ' numeric' : '';
        if (sortable) {
            return `<th class="sortable ${sortCls}${numericCls}" style="width:${col.width}"
                        onclick="Finance.sortBy('${col.sortField}')">${FinanceUtils.esc(col.label)}</th>`;
        }
        return `<th class="${numericCls}" style="width:${col.width}">${FinanceUtils.esc(col.label)}</th>`;
    },

    _renderRow(r, visible) {
        const selected = FinanceState.selectedIds.has(r.txn_id);
        const rowStyle = r.status === 'cancelled' ? 'opacity:.6;text-decoration:line-through;' : '';
        return `<tr style="${rowStyle}" data-txn="${FinanceUtils.esc(r.txn_id)}">
            ${visible.map(col => Finance._renderCell(r, col, selected)).join('')}
        </tr>`;
    },

    _renderCell(r, col, selected) {
        switch (col.key) {
            case 'select':
                return `<td class="fh-col-select">
                    <input type="checkbox" ${selected ? 'checked' : ''} onchange="Finance.toggleSelect('${FinanceUtils.esc(r.txn_id)}', this.checked)">
                </td>`;
            case 'txn_type_label':
                return `<td><span class="fh-type-pill ${FinanceUtils.typeClass(r.doc_code, r.status)}">${FinanceUtils.esc(r.txn_type_label || '—')}</span></td>`;
            case 'doc_code':
                return `<td><strong>${FinanceUtils.esc(r.doc_code || '—')}</strong></td>`;
            case 'serial_number':
                return `<td>${FinanceUtils.esc(r.serial_number ?? '—')}</td>`;
            case 'patient_name':
                return `<td title="${FinanceUtils.esc(r.patient_name || '')}">${FinanceUtils.esc(r.patient_name || '—')}</td>`;
            case 'total':
                return `<td class="numeric">${FinanceUtils.fmtMoney(r.total)}</td>`;
            case 'cash_amount':
                return `<td class="numeric">${FinanceUtils.fmtMoney(r.cash_amount)}</td>`;
            case 'exempt_amount':
                return `<td class="numeric">${FinanceUtils.fmtMoney(r.exempt_amount)}</td>`;
            case 'center_share':
                return `<td class="numeric">${FinanceUtils.fmtMoney(r.center_share)}</td>`;
            case 'ministry_share':
                return `<td class="numeric">${FinanceUtils.fmtMoney(r.ministry_share)}</td>`;
            case 'accountant_name':
                return `<td>${FinanceUtils.esc(r.accountant_name || '—')}</td>`;
            case 'doctor_name':
                return `<td>${FinanceUtils.esc(r.doctor_name || '—')}</td>`;
            case 'txn_timestamp':
                return `<td>${FinanceUtils.fmtDateTime(r.txn_timestamp)}</td>`;
            case 'status':
                return `<td><span class="fh-status-pill ${FinanceUtils.statusClass(r.status)}">${FinanceUtils.esc(FinanceUtils.statusLabel(r.status))}</span></td>`;
            case 'actions':
                return `<td>
                    <button class="fh-action-btn" title="عرض التفاصيل" onclick="Finance.openDetail('${FinanceUtils.esc(r.txn_id)}')">
                        <i class="bi bi-eye-fill"></i>
                    </button>
                </td>`;
            default:
                return `<td>${FinanceUtils.esc(r[col.key] ?? '—')}</td>`;
        }
    },

    sortBy(field) {
        if (FinanceState.sortBy === field) {
            FinanceState.sortDir = FinanceState.sortDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            FinanceState.sortBy = field;
            FinanceState.sortDir = 'DESC';
        }
        FinanceState.page = 1;
        Finance.loadTransactions();
    },

    toggleSelect(txnId, checked) {
        if (checked) FinanceState.selectedIds.add(txnId);
        else FinanceState.selectedIds.delete(txnId);
        Finance._updateSelectedInfo();
    },

    toggleSelectAll(checked) {
        FinanceState.rows.forEach(r => {
            if (checked) FinanceState.selectedIds.add(r.txn_id);
            else FinanceState.selectedIds.delete(r.txn_id);
        });
        Finance.renderGridBody();
    },

    _updateSelectedInfo() {
        const el = document.getElementById('fh-selected-info');
        if (!el) return;
        const n = FinanceState.selectedIds.size;
        el.textContent = n > 0 ? `محدد: ${n}` : '';
    },

    renderPagination() {
        const container = document.getElementById('fh-pagination');
        if (!container) return;
        const resp = FinanceState.lastResponse;
        if (!resp) { container.style.display = 'none'; return; }

        const total = Number(resp.total_count || 0);
        const perPage = FinanceState.perPage;
        const page = FinanceState.page;
        const lastPage = Math.max(1, Math.ceil(total / perPage));

        if (total === 0) { container.style.display = 'none'; return; }
        container.style.display = 'flex';

        const start = (page - 1) * perPage + 1;
        const end = Math.min(page * perPage, total);

        const pageNumbers = [];
        const maxShown = 7;
        if (lastPage <= maxShown) {
            for (let i = 1; i <= lastPage; i++) pageNumbers.push(i);
        } else {
            pageNumbers.push(1);
            const start2 = Math.max(2, page - 2);
            const end2 = Math.min(lastPage - 1, page + 2);
            if (start2 > 2) pageNumbers.push('…');
            for (let i = start2; i <= end2; i++) pageNumbers.push(i);
            if (end2 < lastPage - 1) pageNumbers.push('…');
            pageNumbers.push(lastPage);
        }

        container.innerHTML = `
            <div class="fh-pagination-info">
                عرض ${FinanceUtils.fmtNumber(start)} - ${FinanceUtils.fmtNumber(end)} من ${FinanceUtils.fmtNumber(total)} حركة
            </div>
            <div class="fh-pagination-buttons">
                <button class="fh-page-btn" ${page<=1?'disabled':''} onclick="Finance.goToPage(1)" title="الأولى"><i class="bi bi-chevron-double-right"></i></button>
                <button class="fh-page-btn" ${page<=1?'disabled':''} onclick="Finance.goToPage(${page-1})"><i class="bi bi-chevron-right"></i></button>
                ${pageNumbers.map(p => p === '…'
                    ? `<button class="fh-page-btn" disabled>…</button>`
                    : `<button class="fh-page-btn ${p===page?'active':''}" onclick="Finance.goToPage(${p})">${p}</button>`
                ).join('')}
                <button class="fh-page-btn" ${page>=lastPage?'disabled':''} onclick="Finance.goToPage(${page+1})"><i class="bi bi-chevron-left"></i></button>
                <button class="fh-page-btn" ${page>=lastPage?'disabled':''} onclick="Finance.goToPage(${lastPage})" title="الأخيرة"><i class="bi bi-chevron-double-left"></i></button>
            </div>
        `;
    },

    goToPage(p) {
        FinanceState.page = Math.max(1, Number(p) || 1);
        Finance.loadTransactions();
    },
});

/* =========================================================================
 * 8. Drawer التفاصيل (Transaction Detail)
 * ========================================================================= */
Object.assign(Finance, {

    async openDetail(txnId) {
        Finance._ensureDrawer();
        const body  = document.getElementById('fh-drawer-body');
        const title = document.getElementById('fh-drawer-title');
        const footer = document.getElementById('fh-drawer-footer');

        title.innerHTML = `<i class="bi bi-receipt"></i> تفاصيل الحركة <span style="opacity:.7">${FinanceUtils.esc(txnId)}</span>`;
        body.innerHTML  = `<div class="fh-grid-state"><i class="bi bi-hourglass-split"></i> جاري تحميل التفاصيل...</div>`;
        footer.innerHTML = `<button class="btn btn-sm btn-outline-secondary" onclick="Finance.closeDrawer()">إغلاق</button>`;
        Finance._openDrawerNow();

        try {
            const res = await Core.apiCall('finance/transaction_detail', 'POST', { txn_id: txnId });
            if (!res || !res.success) {
                body.innerHTML = `<div class="fh-grid-state"><i class="bi bi-exclamation-triangle"></i> ${FinanceUtils.esc(res?.message || 'تعذر جلب التفاصيل')}</div>`;
                return;
            }
            const d = res.data.detail || {};
            const audit = res.data.audit_trail || [];
            body.innerHTML = d.source_type === 'ticket'
                ? Finance._renderTicketDetail(d, audit)
                : Finance._renderInvoiceDetail(d, audit);
        } catch (e) {
            console.error('openDetail:', e);
            body.innerHTML = `<div class="fh-grid-state"><i class="bi bi-exclamation-triangle"></i> خطأ في الاتصال</div>`;
        }
    },

    _renderInvoiceDetail(d, audit) {
        const inv = d.invoice || {};
        const services = d.services || [];
        const related = d.related;
        const totals = d.totals || {};

        const servicesHtml = services.length ? `
            <table class="fh-services-table">
                <thead><tr><th>الخدمة</th><th>السعر</th><th>الكمية</th><th>حصة الوزارة</th><th>حصة المركز</th></tr></thead>
                <tbody>
                    ${services.map(s => `
                        <tr>
                            <td>${FinanceUtils.esc(s.service_name || '—')}
                                <small class="d-block text-muted">${FinanceUtils.esc(s.category_name || '')} / ${FinanceUtils.esc(s.department_name || '')}</small>
                            </td>
                            <td>${FinanceUtils.fmtMoney(s.price)}</td>
                            <td>${FinanceUtils.fmtNumber(s.quantity)}</td>
                            <td>${FinanceUtils.fmtMoney(s.ministry_share)}</td>
                            <td>${FinanceUtils.fmtMoney(s.center_share)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : '<div class="text-muted small">لا توجد خدمات</div>';

        const relatedHtml = related ? `
            <div class="fh-detail-section">
                <h6><i class="bi bi-link-45deg"></i> السند المرتبط</h6>
                <div class="fh-detail-grid">
                    <div class="label">السند:</div><div class="value"><strong>${FinanceUtils.esc(related.doc_code)}-${FinanceUtils.esc(related.serial_number)}</strong> (#${related.invoice_id})</div>
                    <div class="label">الإجمالي:</div><div class="value">${FinanceUtils.fmtMoney(related.total)}</div>
                    <div class="label">المدفوع نقداً:</div><div class="value">${FinanceUtils.fmtMoney(related.net_amount)}</div>
                    <div class="label">الإعفاء:</div><div class="value">${FinanceUtils.fmtMoney(related.exemption_value)}</div>
                </div>
            </div>` : '';

        return `
            <div class="fh-detail-section">
                <h6><i class="bi bi-file-text"></i> بيانات السند</h6>
                <div class="fh-detail-grid">
                    <div class="label">المعرّف:</div><div class="value">${FinanceUtils.esc(d.txn_id)}</div>
                    <div class="label">نوع السند:</div><div class="value"><strong>${FinanceUtils.esc(inv.doc_code)}</strong></div>
                    <div class="label">الرقم التسلسلي:</div><div class="value">${FinanceUtils.esc(inv.serial_number)}</div>
                    <div class="label">تاريخ الإصدار:</div><div class="value">${FinanceUtils.fmtDateTime(inv.created_at)}</div>
                    <div class="label">تاريخ السداد:</div><div class="value">${FinanceUtils.fmtDateTime(inv.paid_at)}</div>
                    ${inv.cancelled_at ? `
                        <div class="label">تاريخ الإلغاء:</div><div class="value text-danger">${FinanceUtils.fmtDateTime(inv.cancelled_at)}</div>
                        <div class="label">سبب الإلغاء:</div><div class="value text-danger">${FinanceUtils.esc(inv.cancel_reason || '—')}</div>
                    ` : ''}
                </div>
            </div>

            <div class="fh-detail-section">
                <h6><i class="bi bi-person"></i> بيانات المريض</h6>
                <div class="fh-detail-grid">
                    <div class="label">الاسم:</div><div class="value">${FinanceUtils.esc(inv.patient_name)}</div>
                    <div class="label">الجنس:</div><div class="value">${FinanceUtils.esc(inv.gender || '—')}</div>
                    <div class="label">الهاتف:</div><div class="value">${FinanceUtils.esc(inv.patient_phone || '—')}</div>
                    <div class="label">الزيارة:</div><div class="value">#${FinanceUtils.esc(inv.visit_id)}</div>
                    <div class="label">التشخيص:</div><div class="value">${FinanceUtils.esc(inv.diagnosis || '—')}</div>
                    <div class="label">نوع الحالة:</div><div class="value">${FinanceUtils.esc(inv.case_type_name || '—')}</div>
                </div>
            </div>

            <div class="fh-detail-section">
                <h6><i class="bi bi-people"></i> الموظفون</h6>
                <div class="fh-detail-grid">
                    <div class="label">المحاسب:</div><div class="value">${FinanceUtils.esc(inv.accountant_name || '—')}</div>
                    <div class="label">الطبيب:</div><div class="value">${FinanceUtils.esc(inv.doctor_name || '—')}</div>
                </div>
            </div>

            <div class="fh-detail-section">
                <h6><i class="bi bi-clipboard-data"></i> الخدمات</h6>
                ${servicesHtml}
            </div>

            ${relatedHtml}

            <div class="fh-detail-section">
                <h6><i class="bi bi-calculator"></i> الإجماليات</h6>
                <div class="fh-detail-grid">
                    <div class="label">الإجمالي:</div><div class="value"><strong>${FinanceUtils.fmtMoney(totals.total)}</strong></div>
                    <div class="label">الكاش:</div><div class="value">${FinanceUtils.fmtMoney(totals.cash)}</div>
                    <div class="label">الإعفاء:</div><div class="value">${FinanceUtils.fmtMoney(totals.exempt)}</div>
                    <div class="label">حصة الوزارة:</div><div class="value">${FinanceUtils.fmtMoney(totals.ministry_share)}</div>
                    <div class="label">حصة المركز:</div><div class="value"><strong>${FinanceUtils.fmtMoney(totals.center_share)}</strong></div>
                </div>
            </div>

            ${audit.length ? `
                <div class="fh-detail-section">
                    <h6><i class="bi bi-clock-history"></i> سجل التدقيق</h6>
                    <div style="max-height:180px;overflow-y:auto;font-size:.78rem;">
                        ${audit.slice(0, 15).map(a => `
                            <div style="padding:4px 0;border-bottom:1px solid #e5e7eb;">
                                <strong>${FinanceUtils.esc(a.username || '?')}</strong> — ${FinanceUtils.esc(a.action || '—')}
                                <small class="text-muted d-block">${FinanceUtils.fmtDateTime(a.created_at)}</small>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        `;
    },

    _renderTicketDetail(d, audit) {
        const t = d.ticket || {};
        const totals = d.totals || {};
        const typeLabel = t.ticket_type === 'morning' ? 'صباحي' : 'مسائي';

        return `
            <div class="fh-detail-section">
                <h6><i class="bi bi-ticket-perforated"></i> بيانات التذكرة</h6>
                <div class="fh-detail-grid">
                    <div class="label">المعرّف:</div><div class="value">${FinanceUtils.esc(d.txn_id)}</div>
                    <div class="label">نوع التذكرة:</div><div class="value"><strong>${typeLabel}</strong></div>
                    <div class="label">الرقم التسلسلي:</div><div class="value">${FinanceUtils.esc(t.serial_number)}</div>
                    <div class="label">المبلغ:</div><div class="value">${FinanceUtils.fmtMoney(t.amount)}</div>
                    <div class="label">تاريخ الإصدار:</div><div class="value">${FinanceUtils.fmtDateTime(t.created_at)}</div>
                    ${t.notes ? `<div class="label">ملاحظات:</div><div class="value">${FinanceUtils.esc(t.notes)}</div>` : ''}
                </div>
            </div>

            <div class="fh-detail-section">
                <h6><i class="bi bi-person"></i> بيانات المريض</h6>
                <div class="fh-detail-grid">
                    <div class="label">الاسم:</div><div class="value">${FinanceUtils.esc(t.patient_name)}</div>
                    <div class="label">الجنس:</div><div class="value">${FinanceUtils.esc(t.gender || '—')}</div>
                    <div class="label">الزيارة:</div><div class="value">#${FinanceUtils.esc(t.visit_id)}</div>
                </div>
            </div>

            <div class="fh-detail-section">
                <h6><i class="bi bi-people"></i> الموظفون</h6>
                <div class="fh-detail-grid">
                    <div class="label">المُصدِر:</div><div class="value">${FinanceUtils.esc(t.issued_by_name || '—')}</div>
                    <div class="label">الطبيب:</div><div class="value">${FinanceUtils.esc(t.doctor_name || '—')}</div>
                </div>
            </div>

            <div class="fh-detail-section">
                <h6><i class="bi bi-calculator"></i> الإجماليات</h6>
                <div class="fh-detail-grid">
                    <div class="label">الإجمالي:</div><div class="value"><strong>${FinanceUtils.fmtMoney(totals.total)}</strong></div>
                    <div class="label">حصة الوزارة:</div><div class="value">${FinanceUtils.fmtMoney(totals.ministry_share)}</div>
                    <div class="label">حصة المركز:</div><div class="value"><strong>${FinanceUtils.fmtMoney(totals.center_share)}</strong></div>
                </div>
            </div>
        `;
    },

    _ensureDrawer() {
        if (document.getElementById('fh-drawer')) return;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div class="fh-drawer-backdrop" id="fh-drawer-backdrop" onclick="Finance.closeDrawer()"></div>
            <div class="fh-drawer" id="fh-drawer">
                <div class="fh-drawer-header">
                    <h5 id="fh-drawer-title"><i class="bi bi-receipt"></i> تفاصيل الحركة</h5>
                    <button class="btn btn-sm btn-outline-light" onclick="Finance.closeDrawer()">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="fh-drawer-body" id="fh-drawer-body"></div>
                <div class="fh-drawer-footer" id="fh-drawer-footer"></div>
            </div>
        `;
        // نُضيف العنصرين بشكل منفصل لضمان التركيب الصحيح في DOM
        const backdrop = wrapper.querySelector('.fh-drawer-backdrop');
        const drawer   = wrapper.querySelector('.fh-drawer');
        document.body.appendChild(backdrop);
        document.body.appendChild(drawer);
    },

    _openDrawerNow() {
        const backdrop = document.getElementById('fh-drawer-backdrop');
        const drawer = document.getElementById('fh-drawer');
        if (!backdrop || !drawer) return;
        backdrop.style.display = 'block';
        void backdrop.offsetHeight;
        backdrop.classList.add('show');
        drawer.classList.add('show');
    },

    closeDrawer() {
        const backdrop = document.getElementById('fh-drawer-backdrop');
        const drawer = document.getElementById('fh-drawer');
        if (!backdrop || !drawer) return;
        backdrop.classList.remove('show');
        drawer.classList.remove('show');
        setTimeout(() => { backdrop.style.display = 'none'; }, 250);
    },
});

/* =========================================================================
 * 9. التعريض العالمي (Public Exposure)
 * ========================================================================= */
window.Finance = Finance;
window.FinanceUtils = FinanceUtils;
window.FinanceState = FinanceState;

console.log('[Finance Hub M5.1] ✅ الموديول جاهز. للاختبار: Finance.viewHub()');

/* =========================================================================
 * 10. امتداد M5.2.1 — Column Manager + Saved Views
 * ========================================================================= */
(function () {
    const FINANCE_COLUMNS_STORAGE_KEY = 'finance_hub_columns_v1';
    const FINANCE_VIEWS_STORAGE_KEY = 'finance_hub_saved_views_v1';
    const FINANCE_LOCKED_COLUMNS = ['select', 'actions'];

    function injectFinanceM521Styles() {
        if (document.getElementById('finance-hub-m521-styles')) return;
        const style = document.createElement('style');
        style.id = 'finance-hub-m521-styles';
        style.textContent = `
            .fh-modal-list { display:flex; flex-direction:column; gap:10px; }
            .fh-col-row, .fh-view-row {
                display:flex; align-items:center; justify-content:space-between; gap:12px;
                border:1px solid #e5e7eb; border-radius:12px; padding:10px 12px; background:#fff;
            }
            .fh-col-row-left, .fh-view-row-left { display:flex; align-items:center; gap:10px; min-width:0; }
            .fh-col-row-title, .fh-view-row-title { font-weight:700; color:#1e293b; }
            .fh-col-row-sub, .fh-view-row-sub { font-size:.78rem; color:#64748b; }
            .fh-col-row-right, .fh-view-row-right { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
            .fh-badge-lock { background:#dbeafe; color:#1d4ed8; border-radius:999px; padding:3px 9px; font-size:.72rem; font-weight:700; }
            .fh-view-empty {
                border:1px dashed #cbd5e1; border-radius:14px; padding:24px; text-align:center; color:#64748b;
                background:linear-gradient(180deg,#f8fafc 0%,#fff 100%);
            }
            .fh-view-empty i { font-size:2rem; display:block; margin-bottom:8px; opacity:.55; }
            .fh-modal-section-title { font-weight:800; color:#334155; margin-bottom:10px; }
            [data-theme="dark"] .fh-col-row,
            [data-theme="dark"] .fh-view-row { background:#1f2937; border-color:#374151; }
            [data-theme="dark"] .fh-col-row-title,
            [data-theme="dark"] .fh-view-row-title,
            [data-theme="dark"] .fh-modal-section-title { color:#e2e8f0; }
            [data-theme="dark"] .fh-col-row-sub,
            [data-theme="dark"] .fh-view-row-sub,
            [data-theme="dark"] .fh-view-empty { color:#94a3b8; }
            [data-theme="dark"] .fh-view-empty { background:#111827; border-color:#374151; }
            [data-theme="dark"] .fh-badge-lock { background:rgba(59,130,246,.18); color:#93c5fd; }
        `;
        document.head.appendChild(style);
    }

    function safeJsonParse(value, fallback) {
        try {
            return value ? JSON.parse(value) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function cloneDeep(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeColumns(rawColumns) {
        const rawMap = new Map(Array.isArray(rawColumns)
            ? rawColumns.filter(Boolean).map(col => [String(col.key), col])
            : []);

        return FINANCE_COLUMN_CATALOG.map((catalogCol, index) => {
            const stored = rawMap.get(catalogCol.key) || {};
            const lockedVisible = FINANCE_LOCKED_COLUMNS.includes(catalogCol.key);
            return {
                ...catalogCol,
                visible: lockedVisible ? true : Boolean(stored.visible ?? catalogCol.default),
                order: Number.isFinite(Number(stored.order)) ? Number(stored.order) : index,
                lockedVisible,
            };
        }).sort((a, b) => a.order - b.order).map((col, order) => ({ ...col, order }));
    }

    function getBootstrapModalInstance(modalEl) {
        if (!modalEl) return null;
        if (window.bootstrap && window.bootstrap.Modal) {
            return window.bootstrap.Modal.getOrCreateInstance(modalEl);
        }
        return {
            show() { modalEl.style.display = 'block'; modalEl.classList.add('show'); modalEl.removeAttribute('aria-hidden'); },
            hide() { modalEl.classList.remove('show'); modalEl.style.display = 'none'; modalEl.setAttribute('aria-hidden', 'true'); },
        };
    }

    Object.assign(Finance, {
        viewHub() {
            injectFinanceStyles();
            injectFinanceM521Styles();
            Core.navigateTo('viewFinanceHub', async () => {
                const main = document.getElementById('mainContent');
                main.innerHTML = `
                    <div class="container-fluid fh-page animate-in" id="finance-hub-root">
                        <div class="fh-header">
                            <h2><i class="bi bi-bank2"></i> المركز المالي والسندي الشامل</h2>
                            <div class="fh-header-actions">
                                <button class="btn btn-sm btn-outline-secondary" onclick="Finance.openSavedViews()">
                                    <i class="bi bi-collection"></i> العروض المحفوظة
                                </button>
                                <button class="btn btn-sm btn-outline-primary" onclick="Finance.openColumnManager()">
                                    <i class="bi bi-layout-three-columns"></i> إدارة الأعمدة
                                </button>
                                <button class="btn btn-sm btn-primary" onclick="Finance.refreshAll()">
                                    <i class="bi bi-arrow-clockwise"></i> تحديث
                                </button>
                            </div>
                        </div>

                        <div id="fh-kpis" class="fh-kpi-grid">${Finance._kpiSkeleton()}</div>

                        <div id="fh-charts" class="fh-charts-grid">
                            <div class="fh-chart-card"><h6>إيرادات آخر 30 يوم</h6><div class="fh-chart-wrapper"><canvas id="fh-chart-revenue30"></canvas></div></div>
                            <div class="fh-chart-card"><h6>توزيع أنواع الحركات</h6><div class="fh-chart-wrapper"><canvas id="fh-chart-typedist"></canvas></div></div>
                            <div class="fh-chart-card"><h6>أعلى 10 خدمات</h6><div class="fh-chart-wrapper"><canvas id="fh-chart-topservices"></canvas></div></div>
                            <div class="fh-chart-card"><h6>أداء المحاسبين</h6><div class="fh-chart-wrapper"><canvas id="fh-chart-accountants"></canvas></div></div>
                        </div>

                        <div id="fh-filters-container"></div>
                        <div id="fh-grid-container"></div>
                    </div>
                `;

                if (!FinanceState.options.doc_types || !FinanceState.options.doc_types.length) {
                    await Finance.loadFilterOptions();
                }
                Finance._initColumns();
                Finance.renderFiltersPanel();
                Finance.renderGridShell();

                await Promise.all([
                    Finance.loadOverview(),
                    Finance.loadTransactions(),
                ]);
            });
        },

        _initColumns() {
            const stored = safeJsonParse(localStorage.getItem(FINANCE_COLUMNS_STORAGE_KEY), null);
            FinanceState.columns = normalizeColumns(stored);
        },

        _visibleColumns() {
            return (FinanceState.columns || [])
                .slice()
                .sort((a, b) => a.order - b.order)
                .filter(col => col.lockedVisible ? true : Boolean(col.visible));
        },

        _persistColumns() {
            localStorage.setItem(FINANCE_COLUMNS_STORAGE_KEY, JSON.stringify(FinanceState.columns || []));
        },

        renderGridShell() {
            const container = document.getElementById('fh-grid-container');
            if (!container) return;
            container.innerHTML = `
                <div class="fh-grid-card">
                    <div class="fh-grid-toolbar">
                        <h5><i class="bi bi-table"></i> سجل الحركات الموحّد</h5>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <span id="fh-selected-info" class="text-muted small"></span>
                            <button class="btn btn-sm btn-outline-secondary" onclick="Finance.saveCurrentView()">
                                <i class="bi bi-bookmark-plus"></i> حفظ العرض الحالي
                            </button>
                            <button class="btn btn-sm btn-outline-primary" onclick="Finance.openColumnManager()">
                                <i class="bi bi-layout-three-columns"></i> الأعمدة
                            </button>
                            <select class="form-select form-select-sm" style="width:auto;" id="fh-per-page"
                                    onchange="Finance.changePerPage(Number(this.value))">
                                <option value="25"  ${FinanceState.perPage===25?'selected':''}>25</option>
                                <option value="50"  ${FinanceState.perPage===50?'selected':''}>50</option>
                                <option value="100" ${FinanceState.perPage===100?'selected':''}>100</option>
                                <option value="200" ${FinanceState.perPage===200?'selected':''}>200</option>
                            </select>
                        </div>
                    </div>
                    <div class="fh-grid-scroll" id="fh-grid-scroll">
                        <div class="fh-grid-state"><i class="bi bi-hourglass-split"></i> جاري تحميل البيانات...</div>
                    </div>
                    <div class="fh-pagination" id="fh-pagination" style="display:none;"></div>
                </div>
            `;
        },

        _ensureModal(modalId, title, dialogClass = 'modal-lg') {
            let modal = document.getElementById(modalId);
            if (!modal) {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = `
                    <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                        <div class="modal-dialog ${dialogClass} modal-dialog-scrollable">
                            <div class="modal-content">
                                <div class="modal-header">
                                    <h5 class="modal-title">${title}</h5>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                                </div>
                                <div class="modal-body"></div>
                                <div class="modal-footer"></div>
                            </div>
                        </div>
                    </div>
                `;
                modal = wrapper.firstElementChild;
                document.body.appendChild(modal);
            }
            modal.querySelector('.modal-title').innerHTML = title;
            return modal;
        },

        openColumnManager() {
            injectFinanceM521Styles();
            const modal = Finance._ensureModal('fh-column-manager-modal', '<i class="bi bi-layout-three-columns"></i> إدارة الأعمدة');
            const body = modal.querySelector('.modal-body');
            const footer = modal.querySelector('.modal-footer');
            const columns = (FinanceState.columns || []).slice().sort((a, b) => a.order - b.order);

            body.innerHTML = `
                <div class="fh-modal-section-title">ترتيب وإظهار الأعمدة</div>
                <div class="text-muted small mb-3">يمكنك إظهار/إخفاء الأعمدة غير المقفلة، وتحريك ترتيبها للأعلى أو للأسفل. عمودا التحديد والإجراءات ثابتان دائماً.</div>
                <div class="fh-modal-list">
                    ${columns.map((col, index) => `
                        <div class="fh-col-row">
                            <div class="fh-col-row-left">
                                <input class="form-check-input" type="checkbox"
                                       ${col.lockedVisible ? 'checked disabled' : (col.visible ? 'checked' : '')}
                                       onchange="Finance.toggleColumnVisibility('${FinanceUtils.esc(col.key)}', this.checked)">
                                <div>
                                    <div class="fh-col-row-title">${FinanceUtils.esc(col.label || col.key)}</div>
                                    <div class="fh-col-row-sub">${FinanceUtils.esc(col.key)}${col.sortable ? ' • قابل للفرز' : ''}</div>
                                </div>
                            </div>
                            <div class="fh-col-row-right">
                                ${col.lockedVisible ? '<span class="fh-badge-lock">مقفول</span>' : ''}
                                <button class="btn btn-sm btn-outline-secondary" ${index===0?'disabled':''} onclick="Finance.moveColumn('${FinanceUtils.esc(col.key)}', -1)"><i class="bi bi-arrow-up"></i></button>
                                <button class="btn btn-sm btn-outline-secondary" ${index===columns.length-1?'disabled':''} onclick="Finance.moveColumn('${FinanceUtils.esc(col.key)}', 1)"><i class="bi bi-arrow-down"></i></button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;

            footer.innerHTML = `
                <button type="button" class="btn btn-outline-secondary" onclick="Finance.resetColumnsDefault()">
                    <i class="bi bi-arrow-counterclockwise"></i> إعادة الافتراضي
                </button>
                <button type="button" class="btn btn-primary" onclick="Finance.applyColumnManager()">
                    <i class="bi bi-check2-circle"></i> تطبيق
                </button>
            `;

            getBootstrapModalInstance(modal).show();
        },

        toggleColumnVisibility(columnKey, checked) {
            FinanceState.columns = (FinanceState.columns || []).map(col => {
                if (col.key !== columnKey) return col;
                if (col.lockedVisible) return { ...col, visible: true };
                return { ...col, visible: Boolean(checked) };
            });
        },

        moveColumn(columnKey, direction) {
            const ordered = (FinanceState.columns || []).slice().sort((a, b) => a.order - b.order);
            const index = ordered.findIndex(col => col.key === columnKey);
            if (index === -1) return;
            const target = index + Number(direction || 0);
            if (target < 0 || target >= ordered.length) return;
            const temp = ordered[index];
            ordered[index] = ordered[target];
            ordered[target] = temp;
            FinanceState.columns = ordered.map((col, order) => ({ ...col, order }));
            Finance.openColumnManager();
        },

        applyColumnManager() {
            Finance._persistColumns();
            Finance.renderGridBody();
            Core.showAlert('تم حفظ إعدادات الأعمدة.', 'success');
            const modal = document.getElementById('fh-column-manager-modal');
            getBootstrapModalInstance(modal).hide();
        },

        resetColumnsDefault() {
            localStorage.removeItem(FINANCE_COLUMNS_STORAGE_KEY);
            FinanceState.columns = normalizeColumns(null);
            Finance.renderGridBody();
            Finance.openColumnManager();
            Core.showAlert('تمت استعادة الأعمدة الافتراضية.', 'info');
        },

        _getSavedViews() {
            const views = safeJsonParse(localStorage.getItem(FINANCE_VIEWS_STORAGE_KEY), []);
            return Array.isArray(views) ? views : [];
        },

        _setSavedViews(views) {
            localStorage.setItem(FINANCE_VIEWS_STORAGE_KEY, JSON.stringify(Array.isArray(views) ? views : []));
        },

        _captureCurrentView(name, existingId = null) {
            return {
                id: existingId || `view_${Date.now()}`,
                name: String(name || '').trim(),
                created_at: new Date().toISOString(),
                filters: cloneDeep(FinanceState.filters),
                sortBy: FinanceState.sortBy,
                sortDir: FinanceState.sortDir,
                perPage: FinanceState.perPage,
                columns: cloneDeep(FinanceState.columns || []),
            };
        },

        openSavedViews() {
            injectFinanceM521Styles();
            const modal = Finance._ensureModal('fh-saved-views-modal', '<i class="bi bi-collection"></i> العروض المحفوظة');
            const body = modal.querySelector('.modal-body');
            const footer = modal.querySelector('.modal-footer');
            const views = Finance._getSavedViews().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

            body.innerHTML = views.length ? `
                <div class="fh-modal-section-title">قائمة العروض المحفوظة</div>
                <div class="fh-modal-list">
                    ${views.map(view => `
                        <div class="fh-view-row">
                            <div class="fh-view-row-left">
                                <div>
                                    <div class="fh-view-row-title">${FinanceUtils.esc(view.name || 'بدون اسم')}</div>
                                    <div class="fh-view-row-sub">
                                        ${FinanceUtils.esc((view.filters?.period || 'custom'))} • ${FinanceUtils.fmtDateTime(view.created_at)}
                                    </div>
                                </div>
                            </div>
                            <div class="fh-view-row-right">
                                <button class="btn btn-sm btn-outline-secondary" onclick="Finance.updateSavedView('${FinanceUtils.esc(view.id)}')">
                                    <i class="bi bi-arrow-repeat"></i> تحديث
                                </button>
                                <button class="btn btn-sm btn-outline-primary" onclick="Finance.applySavedView('${FinanceUtils.esc(view.id)}')">
                                    <i class="bi bi-box-arrow-in-down"></i> تحميل
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="Finance.deleteSavedView('${FinanceUtils.esc(view.id)}')">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : `
                <div class="fh-view-empty">
                    <i class="bi bi-collection"></i>
                    لا توجد عروض محفوظة بعد.<br>
                    احفظ الفلاتر والأعمدة الحالية ليتم استرجاعها لاحقاً بضغطة واحدة.
                </div>
            `;

            footer.innerHTML = `
                <button type="button" class="btn btn-primary" onclick="Finance.saveCurrentView()">
                    <i class="bi bi-bookmark-plus"></i> حفظ العرض الحالي
                </button>
            `;

            getBootstrapModalInstance(modal).show();
        },

        saveCurrentView() {
            const suggestedName = `عرض ${FinanceUtils.fmtDateTime(new Date().toISOString())}`;
            const name = window.prompt('اكتب اسماً لهذا العرض المحفوظ:', suggestedName);
            if (!name || !String(name).trim()) return;

            const views = Finance._getSavedViews();
            const existing = views.find(view => String(view.name || '').trim() === String(name).trim());
            const shouldOverwrite = existing ? window.confirm('يوجد عرض بنفس الاسم. هل تريد استبداله؟') : true;
            if (!shouldOverwrite) return;

            const nextView = Finance._captureCurrentView(name, existing?.id || null);
            const nextViews = existing
                ? views.map(view => view.id === existing.id ? nextView : view)
                : [nextView, ...views];

            Finance._setSavedViews(nextViews);
            Core.showAlert('تم حفظ العرض الحالي.', 'success');

            const modal = document.getElementById('fh-saved-views-modal');
            if (modal && modal.classList.contains('show')) {
                Finance.openSavedViews();
            }
        },

        async applySavedView(viewId) {
            const view = Finance._getSavedViews().find(item => item.id === viewId);
            if (!view) {
                Core.showAlert('العرض المطلوب غير موجود.', 'warning');
                return;
            }

            FinanceState.filters = { ...FinanceState.filters, ...(view.filters || {}) };
            FinanceState.sortBy = view.sortBy || 'txn_timestamp';
            FinanceState.sortDir = view.sortDir || 'DESC';
            FinanceState.perPage = Number(view.perPage || 50);
            FinanceState.page = 1;
            FinanceState.selectedIds.clear();
            FinanceState.columns = normalizeColumns(view.columns || null);
            Finance._persistColumns();

            Finance.renderFiltersPanel();
            Finance.renderGridShell();
            const modal = document.getElementById('fh-saved-views-modal');
            getBootstrapModalInstance(modal).hide();

            await Promise.all([
                Finance.loadOverview(),
                Finance.loadTransactions(),
            ]);
            Core.showAlert(`تم تحميل العرض: ${view.name}`, 'success');
        },

        updateSavedView(viewId) {
            const views = Finance._getSavedViews();
            const current = views.find(item => item.id === viewId);
            if (!current) {
                Core.showAlert('العرض المطلوب غير موجود.', 'warning');
                return;
            }
            const updated = Finance._captureCurrentView(current.name, current.id);
            Finance._setSavedViews(views.map(view => view.id === viewId ? updated : view));
            Core.showAlert('تم تحديث العرض المحفوظ بالحالة الحالية.', 'success');
            Finance.openSavedViews();
        },

        deleteSavedView(viewId) {
            const views = Finance._getSavedViews();
            const current = views.find(item => item.id === viewId);
            if (!current) return;
            const confirmed = window.confirm(`هل تريد حذف العرض "${current.name}"؟`);
            if (!confirmed) return;
            Finance._setSavedViews(views.filter(view => view.id !== viewId));
            Core.showAlert('تم حذف العرض المحفوظ.', 'info');
            Finance.openSavedViews();
        },
    });
})();

console.log('[Finance Hub M5.2.1] ✅ تمت إضافة Column Manager + Saved Views.');
