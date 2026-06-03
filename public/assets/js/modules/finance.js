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
 * الاعتمادات: Core (assets/js/core/main.js) + Bootstrap 5.3 + Chart.js (محمَّلة في index.html).
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
    sortRules: [{ field: 'txn_timestamp', dir: 'DESC' }],
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
    { key: 'txn_type_label', label: 'نوع الحركة',       width: '120px', default: true, sortable: true,  sortField: 'txn_type_label' },
    { key: 'doc_code',       label: 'كود',             width: '60px',  default: true, sortable: true,  sortField: 'doc_code' },
    { key: 'serial_number',  label: 'التسلسل',          width: '90px',  default: true, sortable: true,  sortField: 'serial_number' },
    { key: 'patient_name',   label: 'المريض',           width: '180px', default: true, sortable: true,  sortField: 'patient_name' },
    { key: 'total',          label: 'الإجمالي',         width: '110px', default: true, sortable: true,  sortField: 'total', numeric: true },
    { key: 'cash_amount',    label: 'الكاش',            width: '110px', default: true, sortable: true,  sortField: 'cash_amount', numeric: true },
    { key: 'exempt_amount',  label: 'الإعفاء',          width: '110px', default: true, sortable: true,  sortField: 'exempt_amount', numeric: true },
    { key: 'center_share',   label: 'المشاركة',         width: '120px', default: true, sortable: true,  sortField: 'center_share', numeric: true },
    { key: 'ministry_share', label: 'المشتركة',         width: '120px', default: true, sortable: true,  sortField: 'ministry_share', numeric: true },
    { key: 'accountant_name',label: 'المحاسب',          width: '140px', default: false, sortable: true,  sortField: 'accountant_name' },
    { key: 'doctor_name',    label: 'الطبيب',           width: '140px', default: false, sortable: true,  sortField: 'doctor_name' },
    { key: 'txn_timestamp',  label: 'التاريخ والوقت',   width: '160px', default: true, sortable: true,  sortField: 'txn_timestamp' },
    { key: 'status',         label: 'الحالة',           width: '100px', default: true, sortable: true,  sortField: 'status' },
    { key: 'actions',        label: 'إجراءات',          width: '90px',  default: true, sortable: false },
];

const FINANCE_SORT_OPTIONS = [
    { value: 'txn_timestamp',  label: 'التاريخ والوقت' },
    { value: 'txn_id',         label: 'رقم الحركة' },
    { value: 'source_id',      label: 'الرقم الداخلي للسند' },
    { value: 'visit_id',       label: 'رقم الزيارة' },
    { value: 'serial_number',  label: 'الرقم التسلسلي' },
    { value: 'patient_name',   label: 'اسم المريض' },
    { value: 'txn_type_label', label: 'نوع الحركة' },
    { value: 'doc_code',       label: 'كود السند' },
    { value: 'status',         label: 'الحالة' },
    { value: 'total',          label: 'الإجمالي' },
    { value: 'cash_amount',    label: 'الكاش' },
    { value: 'exempt_amount',  label: 'الإعفاء' },
    { value: 'center_share',   label: 'المشاركة' },
    { value: 'ministry_share', label: 'المشتركة' },
    { value: 'accountant_name',label: 'المحاسب' },
    { value: 'doctor_name',    label: 'الطبيب' },
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
            ['red','المشتركة (الشهر)','bi-buildings'],
            ['teal','المشاركة (الشهر)','bi-graph-up-arrow'],
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
                <div class="fh-kpi-label">المشتركة (الشهر)</div>
                <div class="fh-kpi-value">${fmt(month.ministry_share)}</div>
                <div class="fh-kpi-sub">من ${month.row_count||0} حركة</div>
            </div>
            <div class="fh-kpi fh-kpi-teal">
                <i class="bi bi-graph-up-arrow fh-kpi-icon"></i>
                <div class="fh-kpi-label">المشاركة (الشهر)</div>
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
                    labels: ts.map(s => s.service_name || s.name || '—'),
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
                    labels: ap.map(a => a.accountant_name || a.name || '—'),
                    datasets: [{
                        label: 'الإيراد',
                        data: ap.map(a => Number(a.cash_collected ?? a.revenue ?? 0)),
                        backgroundColor: 'rgba(139,92,246,0.7)',
                        borderColor: '#8b5cf6', borderWidth: 1,
                    }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { afterLabel: c => `الحركات: ${FinanceUtils.fmtNumber(ap[c.dataIndex].txn_count ?? ap[c.dataIndex].count ?? 0)}` } },
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
                    <button class="fh-preset-btn" onclick="Finance.applyPreset('ministry_due')">المشتركة</button>
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
                            حركات فيها مشتركة فقط
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
            Finance._syncLegacySortState();
            const payload = {
                ...FinanceUtils.cleanFilters(),
                sort_by: FinanceState.sortBy,
                sort_dir: FinanceState.sortDir,
                sort_rules: FinanceState.sortRules,
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
            if (Array.isArray(res.data?.sort?.rules) && res.data.sort.rules.length) {
                FinanceState.sortRules = Finance._normalizeSortRules(res.data.sort.rules);
                Finance._syncLegacySortState();
            }
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

    _normalizeSortRules(rules) {
        const allowed = new Set(FINANCE_SORT_OPTIONS.map(opt => opt.value));
        const incoming = Array.isArray(rules) ? rules : [];
        const out = [];
        const seen = new Set();
        incoming.forEach(rule => {
            const field = String(rule?.field || rule?.by || '').trim();
            if (!allowed.has(field) || seen.has(field)) return;
            const dir = String(rule?.dir || rule?.direction || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            out.push({ field, dir });
            seen.add(field);
        });
        if (!out.length) out.push({ field: 'txn_timestamp', dir: 'DESC' });
        return out.slice(0, 3);
    },

    _syncLegacySortState() {
        FinanceState.sortRules = Finance._normalizeSortRules(FinanceState.sortRules);
        const primary = FinanceState.sortRules[0] || { field: 'txn_timestamp', dir: 'DESC' };
        FinanceState.sortBy = primary.field;
        FinanceState.sortDir = primary.dir;
    },

    _primarySortRule() {
        Finance._syncLegacySortState();
        return FinanceState.sortRules[0] || { field: 'txn_timestamp', dir: 'DESC' };
    },

    renderSortOptions(selectedValue = null, includeBlank = false) {
        const current = selectedValue ?? Finance._primarySortRule().field;
        const options = [];
        if (includeBlank) {
            options.push('<option value="">— بدون —</option>');
        }
        FINANCE_SORT_OPTIONS.forEach(opt => {
            options.push(`<option value="${FinanceUtils.esc(opt.value)}" ${current === opt.value ? 'selected' : ''}>${FinanceUtils.esc(opt.label)}</option>`);
        });
        return options.join('');
    },

    renderSortSummary() {
        Finance._syncLegacySortState();
        return (FinanceState.sortRules || []).map((rule, index) => {
            const label = FINANCE_SORT_OPTIONS.find(opt => opt.value === rule.field)?.label || rule.field;
            const dirLabel = rule.dir === 'ASC' ? 'تصاعدي' : 'تنازلي';
            return `${index + 1}) ${label} — ${dirLabel}`;
        }).join(' | ');
    },

    setSortField(field) {
        if (!field) return;
        FinanceState.sortRules = Finance._normalizeSortRules([
            { field, dir: FinanceState.sortDir || 'DESC' },
            ...(FinanceState.sortRules || []).filter(rule => rule.field !== field),
        ]);
        Finance._syncLegacySortState();
        FinanceState.page = 1;
        const sortSummaryEl = document.getElementById('fh-sort-summary');
        if (sortSummaryEl) sortSummaryEl.textContent = Finance.renderSortSummary();
        Finance.loadTransactions();
    },

    setSortDirection(direction) {
        Finance._syncLegacySortState();
        const dir = String(direction || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const primary = Finance._primarySortRule();
        FinanceState.sortRules = Finance._normalizeSortRules([
            { field: primary.field, dir },
            ...(FinanceState.sortRules || []).slice(1),
        ]);
        Finance._syncLegacySortState();
        FinanceState.page = 1;
        const sortSummaryEl = document.getElementById('fh-sort-summary');
        if (sortSummaryEl) sortSummaryEl.textContent = Finance.renderSortSummary();
        Finance.loadTransactions();
    },

    sortBy(field) {
        Finance._syncLegacySortState();
        const primary = Finance._primarySortRule();
        const nextDir = primary.field === field && primary.dir === 'ASC' ? 'DESC' : 'ASC';
        FinanceState.sortRules = Finance._normalizeSortRules([
            { field, dir: primary.field === field ? nextDir : 'DESC' },
            ...(FinanceState.sortRules || []).filter(rule => rule.field !== field),
        ]);
        Finance._syncLegacySortState();
        FinanceState.page = 1;
        const sortByEl = document.getElementById('fh-sort-by');
        const sortDirEl = document.getElementById('fh-sort-dir');
        const sortSummaryEl = document.getElementById('fh-sort-summary');
        if (sortByEl) sortByEl.value = FinanceState.sortBy;
        if (sortDirEl) sortDirEl.value = FinanceState.sortDir;
        if (sortSummaryEl) sortSummaryEl.textContent = Finance.renderSortSummary();
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
                <thead><tr><th>الخدمة</th><th>السعر</th><th>الكمية</th><th>المشتركة</th><th>المشاركة</th></tr></thead>
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
                    <div class="label">المشتركة:</div><div class="value">${FinanceUtils.fmtMoney(totals.ministry_share)}</div>
                    <div class="label">المشاركة:</div><div class="value"><strong>${FinanceUtils.fmtMoney(totals.center_share)}</strong></div>
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
                    <div class="label">المشتركة:</div><div class="value">${FinanceUtils.fmtMoney(totals.ministry_share)}</div>
                    <div class="label">المشاركة:</div><div class="value"><strong>${FinanceUtils.fmtMoney(totals.center_share)}</strong></div>
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

        openSortManager() {
            Finance._syncLegacySortState();
            const modal = Finance._ensureModal('fh-sort-manager-modal', '<i class="bi bi-sort-down"></i> ترتيب متقدم', 'modal-md');
            const body = modal.querySelector('.modal-body');
            const footer = modal.querySelector('.modal-footer');
            const rules = [...Finance._normalizeSortRules(FinanceState.sortRules || [])];
            while (rules.length < 3) {
                rules.push({ field: '', dir: 'DESC' });
            }

            body.innerHTML = `
                <div class="fh-modal-section-title">قواعد الترتيب</div>
                <div class="text-muted small mb-3">يمكنك تحديد حتى 3 مستويات للترتيب. المستوى الأول هو الأهم، ثم الثاني، ثم الثالث.</div>
                <div class="fh-modal-list">
                    ${rules.map((rule, index) => `
                        <div class="fh-col-row">
                            <div class="fh-col-row-left" style="min-width:110px;">
                                <div>
                                    <div class="fh-col-row-title">المستوى ${index + 1}</div>
                                    <div class="fh-col-row-sub">Order by ${index + 1}</div>
                                </div>
                            </div>
                            <div class="fh-col-row-right" style="flex:1;justify-content:flex-end;">
                                <select class="form-select form-select-sm" id="fh-sort-rule-field-${index}" style="min-width:220px;">
                                    ${Finance.renderSortOptions(rule.field || '', true)}
                                </select>
                                <select class="form-select form-select-sm" id="fh-sort-rule-dir-${index}" style="width:auto;">
                                    <option value="DESC" ${String(rule.dir || 'DESC').toUpperCase()==='DESC'?'selected':''}>تنازلي</option>
                                    <option value="ASC" ${String(rule.dir || 'DESC').toUpperCase()==='ASC'?'selected':''}>تصاعدي</option>
                                </select>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;

            footer.innerHTML = `
                <button type="button" class="btn btn-outline-secondary" onclick="Finance.resetSortRules()">
                    <i class="bi bi-arrow-counterclockwise"></i> إعادة الافتراضي
                </button>
                <button type="button" class="btn btn-primary" onclick="Finance.applySortManager()">
                    <i class="bi bi-check2-circle"></i> تطبيق الترتيب
                </button>
            `;

            getBootstrapModalInstance(modal).show();
        },

        applySortManager() {
            const rules = [];
            for (let index = 0; index < 3; index += 1) {
                const field = document.getElementById(`fh-sort-rule-field-${index}`)?.value || '';
                const dir = document.getElementById(`fh-sort-rule-dir-${index}`)?.value || 'DESC';
                if (!field) continue;
                rules.push({ field, dir });
            }

            FinanceState.sortRules = Finance._normalizeSortRules(rules);
            Finance._syncLegacySortState();
            FinanceState.page = 1;

            const sortByEl = document.getElementById('fh-sort-by');
            const sortDirEl = document.getElementById('fh-sort-dir');
            const sortSummaryEl = document.getElementById('fh-sort-summary');
            if (sortByEl) sortByEl.value = FinanceState.sortBy;
            if (sortDirEl) sortDirEl.value = FinanceState.sortDir;
            if (sortSummaryEl) sortSummaryEl.textContent = Finance.renderSortSummary();

            const modal = document.getElementById('fh-sort-manager-modal');
            getBootstrapModalInstance(modal).hide();
            Finance.loadTransactions();
            Core.showAlert('تم تحديث ترتيب العرض.', 'success');
        },

        resetSortRules() {
            FinanceState.sortRules = [{ field: 'txn_timestamp', dir: 'DESC' }];
            Finance._syncLegacySortState();
            Finance.openSortManager();
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
                sortRules: cloneDeep(FinanceState.sortRules || []),
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
            FinanceState.sortRules = Finance._normalizeSortRules(view.sortRules || [{ field: view.sortBy || 'txn_timestamp', dir: view.sortDir || 'DESC' }]);
            Finance._syncLegacySortState();
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

/* =========================================================================
 * 11. امتداد M5.2.2 — XLSX Export + Print Templates + Ministry Report
 * =========================================================================
 * الاعتمادات: XLSX (SheetJS) محمَّلة في index.html (xlsx.full.min.js).
 * الـ APIs المستهلكة في هذا الجزء:
 *   - POST /api/finance/export          (تجهيز payload بأربع أوراق)
 *   - POST /api/finance/print_voucher   (تجهيز payload سند مفرد)
 *   - POST /api/finance/ministry_report (تقرير المشتركة التفصيلي)
 * ========================================================================= */
(function () {
    function injectFinanceM522Styles() {
        if (document.getElementById('finance-hub-m522-styles')) return;
        const style = document.createElement('style');
        style.id = 'finance-hub-m522-styles';
        style.textContent = `
            .fh-export-options { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:10px; }
            .fh-export-option {
                border:1px solid #e5e7eb; border-radius:12px; padding:10px 12px; background:#fff;
                display:flex; align-items:center; gap:10px; cursor:pointer;
            }
            .fh-export-option input { width:18px; height:18px; }
            .fh-export-option-title { font-weight:700; color:#1e293b; }
            .fh-export-option-sub { font-size:.75rem; color:#64748b; }
            [data-theme="dark"] .fh-export-option { background:#1f2937; border-color:#374151; }
            [data-theme="dark"] .fh-export-option-title { color:#e2e8f0; }
            [data-theme="dark"] .fh-export-option-sub { color:#94a3b8; }

            .fh-ministry-summary {
                display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:16px;
            }
            .fh-ministry-summary-card {
                background:linear-gradient(135deg,#eef2ff 0%,#fff 100%);
                border:1px solid #c7d2fe; border-radius:14px; padding:12px 14px;
            }
            .fh-ministry-summary-card .label { font-size:.78rem; color:#4338ca; font-weight:700; margin-bottom:4px; }
            .fh-ministry-summary-card .value { font-size:1.25rem; font-weight:800; color:#1e1b4b; }
            [data-theme="dark"] .fh-ministry-summary-card {
                background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%); border-color:#334155;
            }
            [data-theme="dark"] .fh-ministry-summary-card .label { color:#93c5fd; }
            [data-theme="dark"] .fh-ministry-summary-card .value { color:#e2e8f0; }

            .fh-mini-table { width:100%; font-size:.85rem; border-collapse:collapse; margin-bottom:14px; }
            .fh-mini-table th, .fh-mini-table td { padding:7px 9px; border-bottom:1px solid #e5e7eb; text-align:right; }
            .fh-mini-table th { background:#f1f5f9; color:#475569; font-weight:700; }
            .fh-mini-table tfoot td { background:#f8fafc; font-weight:800; }
            [data-theme="dark"] .fh-mini-table th { background:#1f2937; color:#cbd5e1; }
            [data-theme="dark"] .fh-mini-table td, [data-theme="dark"] .fh-mini-table th { border-color:#374151; }
            [data-theme="dark"] .fh-mini-table tfoot td { background:#0f172a; }

            /* --- Print stylesheet (يُحقن داخل نافذة الطباعة) --- */
            .fh-print-page {
                font-family: 'Cairo','Segoe UI',Tahoma,Arial,sans-serif;
                direction:rtl; color:#1f2937; padding:20px 26px;
            }
            .fh-print-header { text-align:center; border-bottom:2px solid #2b4196; padding-bottom:10px; margin-bottom:14px; }
            .fh-print-header h1 { font-size:1.05rem; margin:0; color:#1f2937; }
            .fh-print-header h2 { font-size:.95rem; margin:2px 0; color:#2b4196; }
            .fh-print-header .sub { font-size:.78rem; color:#475569; }
            .fh-print-title { text-align:center; font-size:1.05rem; font-weight:800; color:#2b4196; margin:12px 0; padding:6px; border:2px solid #2b4196; border-radius:8px; }
            .fh-print-grid { display:grid; grid-template-columns:130px 1fr 130px 1fr; gap:6px 10px; font-size:.85rem; margin:10px 0; }
            .fh-print-grid .label { color:#475569; font-weight:700; }
            .fh-print-grid .value { color:#1f2937; }
            .fh-print-services { width:100%; border-collapse:collapse; margin:10px 0; font-size:.82rem; }
            .fh-print-services th, .fh-print-services td { border:1px solid #cbd5e1; padding:5px 7px; }
            .fh-print-services th { background:#eef2ff; color:#1e1b4b; }
            .fh-print-totals { display:grid; grid-template-columns:repeat(2,1fr); gap:4px 14px; font-size:.88rem; margin-top:10px; padding:8px; background:#f8fafc; border-radius:8px; }
            .fh-print-totals .label { color:#475569; font-weight:700; }
            .fh-print-totals .value { color:#1f2937; font-weight:700; }
            .fh-print-totals .grand .value { color:#065f46; font-size:1rem; }
            .fh-print-footer { margin-top:18px; padding-top:8px; border-top:1px solid #cbd5e1; font-size:.78rem; color:#475569; display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; }
            .fh-print-sign-row { display:flex; justify-content:space-between; margin-top:30px; font-size:.85rem; }
            .fh-print-sign-row .sign-block { text-align:center; width:30%; }
            .fh-print-sign-row .sign-block .line { border-top:1px solid #475569; padding-top:4px; margin-top:30px; }
            .fh-print-watermark-cancelled {
                position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-25deg);
                font-size:6rem; font-weight:900; color:rgba(220,38,38,0.18); pointer-events:none; z-index:0;
            }
            @media print {
                body { background:#fff; }
                .fh-print-page-break { page-break-after: always; }
            }
        `;
        document.head.appendChild(style);
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

    function fmtMoney(v) { return FinanceUtils.fmtMoney(v); }
    function fmtNum(v) { return FinanceUtils.fmtNumber(v); }
    function fmtDT(v) { return FinanceUtils.fmtDateTime(v); }
    function esc(v) { return FinanceUtils.esc(v); }
    function statusLabelAr(s) { return FinanceUtils.statusLabel(s); }

    function periodLabelAr(period) {
        const m = {
            today: 'اليوم', week: 'الأسبوع', month: 'الشهر', year: 'السنة', custom: 'فترة مخصصة',
        };
        return m[period] || (period || '—');
    }

    function buildFiltersDescription(filters) {
        if (!filters || typeof filters !== 'object') return 'بدون فلاتر';
        const parts = [];
        if (filters.period) parts.push(`الفترة: ${periodLabelAr(filters.period)}`);
        if (filters.from) parts.push(`من: ${fmtDT(filters.from)}`);
        if (filters.to)   parts.push(`إلى: ${fmtDT(filters.to)}`);
        if (Array.isArray(filters.doc_codes) && filters.doc_codes.length) parts.push(`أنواع: ${filters.doc_codes.join('،')}`);
        if (Array.isArray(filters.statuses)  && filters.statuses.length)  parts.push(`حالات: ${filters.statuses.map(statusLabelAr).join('،')}`);
        if (filters.amount_min != null) parts.push(`أدنى مبلغ: ${fmtMoney(filters.amount_min)}`);
        if (filters.amount_max != null) parts.push(`أعلى مبلغ: ${fmtMoney(filters.amount_max)}`);
        if (filters.has_ministry_share) parts.push('مشتركة فقط');
        if (filters.query) parts.push(`بحث: "${filters.query}"`);
        return parts.length ? parts.join(' • ') : 'بدون فلاتر';
    }

    /* =========================================================================
     * 11.1  XLSX Export — أربع أوراق منسّقة
     * ========================================================================= */
    Object.assign(Finance, {

        openExportDialog() {
            injectFinanceM522Styles();
            const modal = Finance._ensureModal('fh-export-modal', '<i class="bi bi-file-earmark-excel-fill"></i> تصدير إلى Excel', 'modal-md');
            const body = modal.querySelector('.modal-body');
            const footer = modal.querySelector('.modal-footer');

            body.innerHTML = `
                <div class="text-muted small mb-2">
                    اختر الأوراق التي تريد تضمينها في الملف. سيتم تطبيق نفس الفلاتر الحالية على البيانات المُصدَّرة.
                </div>
                <div class="fh-export-options">
                    <label class="fh-export-option">
                        <input type="checkbox" id="fh-sheet-summary" checked>
                        <div>
                            <div class="fh-export-option-title">ملخّص</div>
                            <div class="fh-export-option-sub">الإجماليات والأعداد العامة</div>
                        </div>
                    </label>
                    <label class="fh-export-option">
                        <input type="checkbox" id="fh-sheet-transactions" checked>
                        <div>
                            <div class="fh-export-option-title">الحركات</div>
                            <div class="fh-export-option-sub">جدول السجلات المفصّل</div>
                        </div>
                    </label>
                    <label class="fh-export-option">
                        <input type="checkbox" id="fh-sheet-pivot" checked>
                        <div>
                            <div class="fh-export-option-title">تحليلات</div>
                            <div class="fh-export-option-sub">توزيع الأنواع + أعلى الخدمات + المحاسبون</div>
                        </div>
                    </label>
                    <label class="fh-export-option">
                        <input type="checkbox" id="fh-sheet-ministry" checked>
                        <div>
                            <div class="fh-export-option-title">المشتركة</div>
                            <div class="fh-export-option-sub">التفصيل من الخدمات والتذاكر</div>
                        </div>
                    </label>
                </div>
                <div class="alert alert-light mt-3 small" style="border:1px dashed #c7d2fe;">
                    <i class="bi bi-info-circle"></i>
                    يُحدّ الخادم حالياً عدد الصفوف المسموح بتصديرها (الافتراضي 10,000 صف). في حال تجاوز هذا الحد، يُرجى تضييق الفلاتر.
                </div>
            `;

            footer.innerHTML = `
                <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">إلغاء</button>
                <button type="button" class="btn btn-success" id="fh-export-confirm">
                    <i class="bi bi-download"></i> تصدير الملف
                </button>
            `;

            footer.querySelector('#fh-export-confirm').onclick = () => {
                const sheets = [];
                if (document.getElementById('fh-sheet-summary').checked)      sheets.push('summary');
                if (document.getElementById('fh-sheet-transactions').checked) sheets.push('transactions');
                if (document.getElementById('fh-sheet-pivot').checked)        sheets.push('pivot');
                if (document.getElementById('fh-sheet-ministry').checked)     sheets.push('ministry');
                if (!sheets.length) {
                    Core.showAlert('اختر ورقة واحدة على الأقل.', 'warning');
                    return;
                }
                getBootstrapModalInstance(modal).hide();
                Finance.exportXlsx(sheets);
            };

            getBootstrapModalInstance(modal).show();
        },

        async exportXlsx(sheets) {
            if (typeof XLSX === 'undefined') {
                Core.showAlert('مكتبة XLSX غير محمّلة. أعِد تحميل الصفحة وحاول مجدداً.', 'error');
                return;
            }
            const includeSheets = Array.isArray(sheets) && sheets.length
                ? sheets
                : ['summary', 'transactions', 'pivot', 'ministry'];

            try {
                Core.showAlert('جاري تجهيز الملف...', 'info');
                Finance._syncLegacySortState();
                const payload = {
                    ...FinanceUtils.cleanFilters(),
                    sort_by: FinanceState.sortBy,
                    sort_dir: FinanceState.sortDir,
                    sort_rules: FinanceState.sortRules,
                    format: 'xlsx',
                    include_sheets: includeSheets,
                };
                const res = await Core.apiCall('finance/export', 'POST', payload);
                if (!res || !res.success || !res.data) {
                    Core.showAlert(res?.message || 'تعذر تجهيز ملف التصدير.', 'error');
                    return;
                }
                const data = res.data;
                const wb = XLSX.utils.book_new();
                const meta = data.meta || {};

                // Sheet 1: Summary
                if (data.sheets && data.sheets.summary) {
                    const s = data.sheets.summary.rows?.[0] || {};
                    const rows = [
                        ['تقرير المركز المالي والسندي الشامل'],
                        [],
                        ['تاريخ التوليد', fmtDT(meta.generated_at)],
                        ['أُعد بواسطة', meta.generated_by || '—'],
                        ['الدور', meta.generated_by_role || '—'],
                        ['نطاق البيانات', (meta.scope?.mode === 'all') ? 'كل المركز' : 'سجلاتي فقط'],
                        ['الفلاتر المطبقة', buildFiltersDescription(meta.filters)],
                        ['عدد السجلات', s.total_rows ?? 0],
                        [],
                        ['الإجماليات'],
                        ['إجمالي المبالغ', s.total_amount ?? 0],
                        ['إجمالي الكاش', s.cash_amount ?? 0],
                        ['إجمالي الإعفاءات', s.exempt_amount ?? 0],
                        ['المشتركة', s.ministry_share ?? 0],
                        ['المشاركة', s.center_share ?? 0],
                        [],
                        ['الأعداد حسب النوع'],
                        ['كاش (A)', s.count_cash ?? 0],
                        ['إعفاء جزئي (B)', s.count_partial ?? 0],
                        ['إعفاء كلي (C)', s.count_full ?? 0],
                        ['تذاكر (T)', s.count_tickets ?? 0],
                        ['ملغاة', s.count_cancelled ?? 0],
                    ];
                    const ws = XLSX.utils.aoa_to_sheet(rows);
                    ws['!cols'] = [{ wch: 32 }, { wch: 36 }];
                    if (ws['!merges']) ws['!merges'].push({ s:{r:0,c:0}, e:{r:0,c:1} });
                    else ws['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:1} }];
                    XLSX.utils.book_append_sheet(wb, ws, 'الملخص');
                }

                // Sheet 2: Transactions
                if (data.sheets && data.sheets.transactions) {
                    const t = data.sheets.transactions;
                    const cols = t.columns || [];
                    const header = cols.map(c => c.label);
                    const aoa = [header];
                    (t.rows || []).forEach(r => {
                        aoa.push(cols.map(c => {
                            const key = c.key;
                            const val = r[key];
                            if (key === 'status')        return statusLabelAr(val);
                            if (key === 'txn_timestamp') return fmtDT(val);
                            if (['total','cash_amount','exempt_amount','center_share','ministry_share'].includes(key)) {
                                return Number(val || 0);
                            }
                            return val ?? '';
                        }));
                    });
                    // إجماليات الصفحة
                    const pt = t.page_total || {};
                    const totalRow = cols.map(c => {
                        if (c.key === 'patient_name') return `الإجماليات (${(t.rows||[]).length} سجل)`;
                        if (['total','cash_amount','exempt_amount','center_share','ministry_share'].includes(c.key)) {
                            return Number(pt[c.key] || 0);
                        }
                        return '';
                    });
                    aoa.push(totalRow);

                    const ws = XLSX.utils.aoa_to_sheet(aoa);
                    ws['!cols'] = cols.map(() => ({ wch: 18 }));
                    XLSX.utils.book_append_sheet(wb, ws, 'الحركات');
                }

                // Sheet 3: Pivot (analytics)
                if (data.sheets && data.sheets.pivot) {
                    const p = data.sheets.pivot;
                    const aoa = [];
                    aoa.push(['توزيع أنواع الحركات']);
                    aoa.push(['النوع', 'الكود', 'المبلغ', 'العدد']);
                    (p.type_distribution || []).forEach(row => {
                        aoa.push([row.label || '—', row.code || '—', Number(row.value || 0), Number(row.count || 0)]);
                    });
                    aoa.push([]);

                    aoa.push(['أعلى 10 خدمات']);
                    aoa.push(['الخدمة', 'الإيراد', 'عدد المرات']);
                    (p.top_services || []).forEach(row => {
                        aoa.push([row.name || '—', Number(row.revenue || 0), Number(row.count || 0)]);
                    });
                    aoa.push([]);

                    aoa.push(['أداء المحاسبين']);
                    aoa.push(['المحاسب', 'الإيراد', 'عدد الحركات']);
                    (p.accountants_performance || []).forEach(row => {
                        aoa.push([row.name || '—', Number(row.revenue || 0), Number(row.count || 0)]);
                    });

                    const ws = XLSX.utils.aoa_to_sheet(aoa);
                    ws['!cols'] = [{ wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 14 }];
                    XLSX.utils.book_append_sheet(wb, ws, 'التحليلات');
                }

                // Sheet 4: Ministry Share
                if (data.sheets && data.sheets.ministry) {
                    const m = data.sheets.ministry.report || {};
                    const aoa = [];
                    aoa.push(['تقرير المشتركة']);
                    aoa.push([]);
                    aoa.push(['الإجماليات']);
                    aoa.push(['من الخدمات', Number(m.totals?.from_services || 0)]);
                    aoa.push(['من التذاكر',  Number(m.totals?.from_tickets || 0)]);
                    aoa.push(['الإجمالي',    Number(m.totals?.grand_total || 0)]);
                    aoa.push([]);

                    aoa.push(['تفصيل الخدمات']);
                    aoa.push(['الخدمة', 'القسم', 'التصنيف', 'عدد الحركات', 'المشتركة', 'إجمالي الإيراد']);
                    (m.by_service || m.services || []).forEach(row => {
                        aoa.push([
                            row.service_name || row.name || '—',
                            row.department_name || '—',
                            row.category_name || '—',
                            Number(row.transactions || row.count || 0),
                            Number(row.ministry_share || 0),
                            Number(row.total_revenue || row.revenue || 0),
                        ]);
                    });
                    aoa.push([]);

                    aoa.push(['تفصيل التذاكر']);
                    aoa.push(['الوردية', 'عدد التذاكر', 'حصة الوحدة', 'إجمالي المشتركة', 'إجمالي الإيراد']);
                    (m.by_ticket || m.tickets || []).forEach(row => {
                        const shiftLabel = (row.shift === 'morning' || row.ticket_type === 'morning') ? 'صباحي' :
                                           (row.shift === 'evening' || row.ticket_type === 'evening') ? 'مسائي' :
                                           (row.ticket_type_label || row.label || '—');
                        aoa.push([
                            shiftLabel,
                            Number(row.count || row.tickets_count || 0),
                            Number(row.unit_share || row.per_ticket_share || 0),
                            Number(row.ministry_share || 0),
                            Number(row.total_revenue || row.revenue || 0),
                        ]);
                    });

                    const ws = XLSX.utils.aoa_to_sheet(aoa);
                    ws['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
                    XLSX.utils.book_append_sheet(wb, ws, 'المشتركة');
                }

                if (!wb.SheetNames.length) {
                    Core.showAlert('لا توجد أوراق صالحة لإنشاء الملف.', 'warning');
                    return;
                }

                const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
                const filename = `Finance_Hub_${stamp}.xlsx`;
                XLSX.writeFile(wb, filename);
                Core.showAlert(`تم تجهيز الملف: ${filename}`, 'success');
            } catch (e) {
                console.error('exportXlsx:', e);
                Core.showAlert('حدث خطأ أثناء تجهيز ملف Excel.', 'error');
            }
        },
    });

    /* =========================================================================
     * 11.2  Print Templates — سند مفرد + طباعة دفعة محددة
     * ========================================================================= */
    Object.assign(Finance, {

        async printTransaction(txnId) {
            if (!txnId) return;
            try {
                Core.showAlert('جاري تجهيز السند للطباعة...', 'info');
                const res = await Core.apiCall('finance/print_voucher', 'POST', { txn_id: txnId });
                if (!res || !res.success || !res.data) {
                    Core.showAlert(res?.message || 'تعذر تجهيز السند.', 'error');
                    return;
                }
                Finance._openPrintWindow([res.data], 'سند مالي');
            } catch (e) {
                console.error('printTransaction:', e);
                Core.showAlert('حدث خطأ أثناء تجهيز السند.', 'error');
            }
        },

        async printSelected() {
            const ids = Array.from(FinanceState.selectedIds);
            if (!ids.length) {
                Core.showAlert('حدّد سند واحد على الأقل لإجراء الطباعة.', 'warning');
                return;
            }
            if (ids.length > 50) {
                if (!window.confirm(`تم تحديد ${ids.length} سنداً. هل تريد متابعة الطباعة على دفعة كبيرة؟`)) {
                    return;
                }
            }

            try {
                Core.showAlert(`جاري تجهيز ${ids.length} سند(ات) للطباعة...`, 'info');
                const results = [];
                for (const txnId of ids) {
                    try {
                        const res = await Core.apiCall('finance/print_voucher', 'POST', { txn_id: txnId });
                        if (res && res.success && res.data) {
                            results.push(res.data);
                        }
                    } catch (innerErr) {
                        console.warn('failed to fetch voucher', txnId, innerErr);
                    }
                }
                if (!results.length) {
                    Core.showAlert('تعذر تجهيز أي سند للطباعة.', 'error');
                    return;
                }
                Finance._openPrintWindow(results, `طباعة ${results.length} سند(ات)`);
            } catch (e) {
                console.error('printSelected:', e);
                Core.showAlert('حدث خطأ أثناء طباعة الدفعة.', 'error');
            }
        },

        _openPrintWindow(payloads, title) {
            injectFinanceM522Styles();
            const printCss = document.getElementById('finance-hub-m522-styles')?.textContent || '';
            const pagesHtml = payloads.map((p, idx) =>
                Finance._renderVoucherHtml(p, idx < payloads.length - 1)
            ).join('');

            const win = window.open('', '_blank', 'width=900,height=1100');
            if (!win) {
                Core.showAlert('تم منع فتح نافذة الطباعة. يُرجى السماح للنوافذ المنبثقة لهذا الموقع.', 'warning');
                return;
            }
            win.document.open();
            win.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="utf-8">
    <title>${esc(title || 'طباعة')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>${printCss}</style>
</head>
<body>
    ${pagesHtml}
    <script>
        window.addEventListener('load', function () {
            setTimeout(function () { window.focus(); window.print(); }, 350);
        });
    <\/script>
</body>
</html>`);
            win.document.close();
        },

        _renderVoucherHtml(payload, hasNext) {
            const header = payload.header || {};
            const meta = payload.print_meta || {};
            const voucher = payload.voucher || {};
            const source = voucher.source_type === 'ticket' ? 'ticket' : 'invoice';

            const head = `
                <div class="fh-print-header">
                    <h1>${esc(header.country || '')}</h1>
                    <h2>${esc(header.ministry || '')}</h2>
                    <div class="sub">${esc(header.office || '')}</div>
                    <div class="sub">${esc(header.directorate || '')}</div>
                    <div class="sub"><strong>${esc(header.center || '')}</strong> — ${esc(header.admin || '')}</div>
                </div>
            `;

            const footer = `
                <div class="fh-print-sign-row">
                    <div class="sign-block"><div class="line">المحاسب</div></div>
                    <div class="sign-block"><div class="line">المراجع</div></div>
                    <div class="sign-block"><div class="line">الإدارة</div></div>
                </div>
                <div class="fh-print-footer">
                    <div>${esc(header.footer_note || '')}</div>
                    <div>
                        طُبع بواسطة: <strong>${esc(meta.printed_by || '—')}</strong>
                        — ${esc(meta.printed_by_role || '')}
                        — ${fmtDT(meta.printed_at)}
                    </div>
                </div>
            `;

            const titleAr = source === 'ticket' ? 'سند تذكرة معاينة' : 'سند مالي';
            const body = source === 'ticket'
                ? Finance._renderTicketVoucherBody(voucher, meta)
                : Finance._renderInvoiceVoucherBody(voucher, meta);

            const cancelled = (voucher.invoice?.status === 'cancelled') || (voucher.ticket?.status === 'cancelled');
            const watermark = cancelled ? `<div class="fh-print-watermark-cancelled">ملغى</div>` : '';

            return `
                <div class="fh-print-page ${hasNext ? 'fh-print-page-break' : ''}">
                    ${watermark}
                    ${head}
                    <div class="fh-print-title">${esc(titleAr)}</div>
                    ${body}
                    ${footer}
                </div>
            `;
        },

        _renderInvoiceVoucherBody(voucher, meta) {
            const inv = voucher.invoice || {};
            const services = voucher.services || [];
            const totals = voucher.totals || {};
            const currency = meta.currency_label || 'ريال';

            const servicesHtml = services.length ? `
                <table class="fh-print-services">
                    <thead>
                        <tr>
                            <th>#</th><th>الخدمة</th><th>القسم</th>
                            <th>السعر</th><th>الكمية</th>
                            <th>المشتركة</th><th>المشاركة</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${services.map((s, i) => `
                            <tr>
                                <td>${i + 1}</td>
                                <td>${esc(s.service_name || '—')}</td>
                                <td>${esc(s.department_name || '—')}</td>
                                <td>${fmtMoney(s.price)}</td>
                                <td>${fmtNum(s.quantity)}</td>
                                <td>${fmtMoney(s.ministry_share)}</td>
                                <td>${fmtMoney(s.center_share)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : '';

            return `
                <div class="fh-print-grid">
                    <div class="label">كود السند:</div><div class="value"><strong>${esc(inv.doc_code || '—')}</strong></div>
                    <div class="label">الرقم التسلسلي:</div><div class="value"><strong>${esc(inv.serial_number || '—')}</strong></div>

                    <div class="label">اسم المريض:</div><div class="value">${esc(inv.patient_name || '—')}</div>
                    <div class="label">الزيارة:</div><div class="value">#${esc(inv.visit_id || '—')}</div>

                    <div class="label">الجنس:</div><div class="value">${esc(inv.gender || '—')}</div>
                    <div class="label">الهاتف:</div><div class="value">${esc(inv.patient_phone || '—')}</div>

                    <div class="label">المحاسب:</div><div class="value">${esc(inv.accountant_name || '—')}</div>
                    <div class="label">الطبيب:</div><div class="value">${esc(inv.doctor_name || '—')}</div>

                    <div class="label">تاريخ الإصدار:</div><div class="value">${fmtDT(inv.created_at)}</div>
                    <div class="label">تاريخ السداد:</div><div class="value">${fmtDT(inv.paid_at)}</div>

                    <div class="label">نوع الحالة:</div><div class="value">${esc(inv.case_type_name || '—')}</div>
                    <div class="label">التشخيص:</div><div class="value">${esc(inv.diagnosis || '—')}</div>
                </div>

                ${servicesHtml}

                <div class="fh-print-totals">
                    <div class="label">الإجمالي:</div><div class="value">${fmtMoney(totals.total)} ${esc(currency)}</div>
                    <div class="label">الكاش:</div><div class="value">${fmtMoney(totals.cash)} ${esc(currency)}</div>
                    <div class="label">الإعفاء:</div><div class="value">${fmtMoney(totals.exempt)} ${esc(currency)}</div>
                    <div class="label">المشتركة:</div><div class="value">${fmtMoney(totals.ministry_share)} ${esc(currency)}</div>
                    <div class="label grand">المشاركة:</div><div class="value">${fmtMoney(totals.center_share)} ${esc(currency)}</div>
                </div>

                ${inv.cancelled_at ? `
                    <div style="margin-top:10px;padding:8px;border:1px dashed #dc2626;border-radius:8px;color:#991b1b;font-size:.82rem;">
                        <strong>تم إلغاء هذا السند في:</strong> ${fmtDT(inv.cancelled_at)}<br>
                        <strong>السبب:</strong> ${esc(inv.cancel_reason || '—')}
                    </div>
                ` : ''}
            `;
        },

        _renderTicketVoucherBody(voucher, meta) {
            const t = voucher.ticket || {};
            const totals = voucher.totals || {};
            const currency = meta.currency_label || 'ريال';
            const typeLabel = t.ticket_type === 'morning' ? 'صباحي' : 'مسائي';

            return `
                <div class="fh-print-grid">
                    <div class="label">نوع التذكرة:</div><div class="value"><strong>${typeLabel}</strong></div>
                    <div class="label">الرقم التسلسلي:</div><div class="value"><strong>${esc(t.serial_number || '—')}</strong></div>

                    <div class="label">اسم المريض:</div><div class="value">${esc(t.patient_name || '—')}</div>
                    <div class="label">الزيارة:</div><div class="value">#${esc(t.visit_id || '—')}</div>

                    <div class="label">الجنس:</div><div class="value">${esc(t.gender || '—')}</div>
                    <div class="label">المُصدِر:</div><div class="value">${esc(t.issued_by_name || '—')}</div>

                    <div class="label">الطبيب:</div><div class="value">${esc(t.doctor_name || '—')}</div>
                    <div class="label">تاريخ الإصدار:</div><div class="value">${fmtDT(t.created_at)}</div>

                    ${t.notes ? `<div class="label">ملاحظات:</div><div class="value" style="grid-column: span 3;">${esc(t.notes)}</div>` : ''}
                </div>

                <div class="fh-print-totals" style="margin-top:18px;">
                    <div class="label">المبلغ:</div><div class="value">${fmtMoney(t.amount || totals.total)} ${esc(currency)}</div>
                    <div class="label">المشتركة:</div><div class="value">${fmtMoney(totals.ministry_share)} ${esc(currency)}</div>
                    <div class="label grand">المشاركة:</div><div class="value">${fmtMoney(totals.center_share)} ${esc(currency)}</div>
                </div>
            `;
        },
    });

    /* =========================================================================
     * 11.3  Ministry Report Modal — تقرير المشتركة التفصيلي
     * ========================================================================= */
    Object.assign(Finance, {

        async openMinistryReport() {
            injectFinanceM522Styles();
            const modal = Finance._ensureModal('fh-ministry-report-modal',
                '<i class="bi bi-buildings"></i> تقرير المشتركة', 'modal-xl');
            const body = modal.querySelector('.modal-body');
            const footer = modal.querySelector('.modal-footer');

            body.innerHTML = `<div class="fh-grid-state"><i class="bi bi-hourglass-split"></i> جاري تحميل التقرير...</div>`;
            footer.innerHTML = `
                <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">إغلاق</button>
                <button type="button" class="btn btn-success" id="fh-ministry-export-btn" disabled>
                    <i class="bi bi-file-earmark-excel"></i> تصدير المشتركة فقط
                </button>
                <button type="button" class="btn btn-primary" id="fh-ministry-print-btn" disabled>
                    <i class="bi bi-printer"></i> طباعة
                </button>
            `;
            getBootstrapModalInstance(modal).show();

            try {
                const res = await Core.apiCall('finance/ministry_report', 'POST', FinanceUtils.cleanFilters());
                if (!res || !res.success || !res.data) {
                    body.innerHTML = `<div class="fh-grid-state"><i class="bi bi-exclamation-triangle"></i> ${esc(res?.message || 'تعذر جلب التقرير')}</div>`;
                    return;
                }
                const report = res.data.report || {};
                const filtersDesc = buildFiltersDescription(res.data.applied_filters);
                const currency = res.data.currency_label || 'ريال';
                FinanceState._lastMinistryReport = { report, filtersDesc, currency };

                body.innerHTML = Finance._renderMinistryReportHtml(report, filtersDesc, currency);

                footer.querySelector('#fh-ministry-export-btn').disabled = false;
                footer.querySelector('#fh-ministry-print-btn').disabled = false;
                footer.querySelector('#fh-ministry-export-btn').onclick = () => Finance.exportXlsx(['ministry']);
                footer.querySelector('#fh-ministry-print-btn').onclick  = () => Finance._printMinistryReport();
            } catch (e) {
                console.error('openMinistryReport:', e);
                body.innerHTML = `<div class="fh-grid-state"><i class="bi bi-exclamation-triangle"></i> خطأ في الاتصال</div>`;
            }
        },

        _renderMinistryReportHtml(report, filtersDesc, currency) {
            const totals = report.totals || {};
            const services = report.by_service || report.services || [];
            const tickets = report.by_ticket || report.tickets || [];

            const summaryCards = `
                <div class="fh-ministry-summary">
                    <div class="fh-ministry-summary-card">
                        <div class="label">من الخدمات</div>
                        <div class="value">${fmtMoney(totals.from_services)}</div>
                    </div>
                    <div class="fh-ministry-summary-card">
                        <div class="label">من التذاكر</div>
                        <div class="value">${fmtMoney(totals.from_tickets)}</div>
                    </div>
                    <div class="fh-ministry-summary-card">
                        <div class="label">الإجمالي الكلي</div>
                        <div class="value" style="color:#065f46;">${fmtMoney(totals.grand_total)} ${esc(currency)}</div>
                    </div>
                </div>
            `;

            const servicesRows = services.length ? services.map(s => `
                <tr>
                    <td>${esc(s.service_name || s.name || '—')}</td>
                    <td>${esc(s.department_name || '—')}</td>
                    <td>${esc(s.category_name || '—')}</td>
                    <td>${fmtNum(s.transactions || s.count || 0)}</td>
                    <td>${fmtMoney(s.ministry_share)}</td>
                    <td>${fmtMoney(s.total_revenue || s.revenue)}</td>
                </tr>
            `).join('') : `<tr><td colspan="6" class="text-muted text-center">لا توجد بيانات</td></tr>`;

            const servicesTotal = services.reduce((acc, s) => {
                acc.share += Number(s.ministry_share || 0);
                acc.rev   += Number(s.total_revenue || s.revenue || 0);
                acc.count += Number(s.transactions || s.count || 0);
                return acc;
            }, { share: 0, rev: 0, count: 0 });

            const ticketsRows = tickets.length ? tickets.map(t => {
                const shift = (t.shift === 'morning' || t.ticket_type === 'morning') ? 'صباحي'
                            : (t.shift === 'evening' || t.ticket_type === 'evening') ? 'مسائي'
                            : (t.ticket_type_label || t.label || '—');
                return `
                    <tr>
                        <td>${esc(shift)}</td>
                        <td>${fmtNum(t.count || t.tickets_count || 0)}</td>
                        <td>${fmtMoney(t.unit_share || t.per_ticket_share)}</td>
                        <td>${fmtMoney(t.ministry_share)}</td>
                        <td>${fmtMoney(t.total_revenue || t.revenue)}</td>
                    </tr>
                `;
            }).join('') : `<tr><td colspan="5" class="text-muted text-center">لا توجد بيانات</td></tr>`;

            const ticketsTotal = tickets.reduce((acc, t) => {
                acc.share += Number(t.ministry_share || 0);
                acc.rev   += Number(t.total_revenue || t.revenue || 0);
                acc.count += Number(t.count || t.tickets_count || 0);
                return acc;
            }, { share: 0, rev: 0, count: 0 });

            return `
                <div class="text-muted small mb-2">
                    <i class="bi bi-funnel"></i> الفلاتر: ${esc(filtersDesc)}
                </div>

                ${summaryCards}

                <h6 class="fh-modal-section-title" style="margin-top:8px;">
                    <i class="bi bi-clipboard-data"></i> المشتركة من الخدمات
                </h6>
                <table class="fh-mini-table">
                    <thead>
                        <tr>
                            <th>الخدمة</th><th>القسم</th><th>التصنيف</th>
                            <th>عدد الحركات</th><th>المشتركة</th><th>إجمالي الإيراد</th>
                        </tr>
                    </thead>
                    <tbody>${servicesRows}</tbody>
                    <tfoot>
                        <tr>
                            <td colspan="3">الإجماليات</td>
                            <td>${fmtNum(servicesTotal.count)}</td>
                            <td>${fmtMoney(servicesTotal.share)}</td>
                            <td>${fmtMoney(servicesTotal.rev)}</td>
                        </tr>
                    </tfoot>
                </table>

                <h6 class="fh-modal-section-title" style="margin-top:14px;">
                    <i class="bi bi-ticket-perforated"></i> المشتركة من التذاكر
                </h6>
                <table class="fh-mini-table">
                    <thead>
                        <tr>
                            <th>الوردية</th><th>عدد التذاكر</th><th>حصة الوحدة</th>
                            <th>المشتركة</th><th>إجمالي الإيراد</th>
                        </tr>
                    </thead>
                    <tbody>${ticketsRows}</tbody>
                    <tfoot>
                        <tr>
                            <td>الإجماليات</td>
                            <td>${fmtNum(ticketsTotal.count)}</td>
                            <td>—</td>
                            <td>${fmtMoney(ticketsTotal.share)}</td>
                            <td>${fmtMoney(ticketsTotal.rev)}</td>
                        </tr>
                    </tfoot>
                </table>
            `;
        },

        _printMinistryReport() {
            const cached = FinanceState._lastMinistryReport;
            if (!cached) {
                Core.showAlert('أعد فتح التقرير ثم اضغط طباعة.', 'warning');
                return;
            }
            const win = window.open('', '_blank', 'width=900,height=1100');
            if (!win) {
                Core.showAlert('تم منع فتح نافذة الطباعة. يُرجى السماح للنوافذ المنبثقة لهذا الموقع.', 'warning');
                return;
            }
            const css = document.getElementById('finance-hub-m522-styles')?.textContent || '';
            const html = Finance._renderMinistryReportHtml(cached.report, cached.filtersDesc, cached.currency);
            win.document.open();
            win.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="utf-8">
    <title>تقرير المشتركة</title>
    <style>
        ${css}
        body { font-family: Cairo,'Segoe UI',Tahoma,Arial,sans-serif; padding:20px; }
        h2 { color:#2b4196; }
    </style>
</head>
<body>
    <h2 style="text-align:center;">تقرير المشتركة</h2>
    ${html}
    <script>
        window.addEventListener('load', function () {
            setTimeout(function () { window.focus(); window.print(); }, 350);
        });
    <\/script>
</body>
</html>`);
            win.document.close();
        },
    });

    /* =========================================================================
     * 11.4  تكامل M5.2.2 مع شريط أدوات الجدول + خلية الإجراءات
     * ========================================================================= */
    const _originalRenderGridShell = Finance.renderGridShell;
    Finance.renderGridShell = function () {
        const container = document.getElementById('fh-grid-container');
        if (!container) return;
        Finance._syncLegacySortState();
        container.innerHTML = `
            <div class="fh-grid-card">
                <div class="fh-grid-toolbar">
                    <h5><i class="bi bi-table"></i> سجل الحركات الموحّد</h5>
                    <div class="d-flex align-items-center gap-2 flex-wrap">
                        <span id="fh-selected-info" class="text-muted small"></span>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <span class="text-muted small">Order by</span>
                            <select class="form-select form-select-sm" style="width:auto;min-width:190px;" id="fh-sort-by"
                                    onchange="Finance.setSortField(this.value)">
                                ${Finance.renderSortOptions()}
                            </select>
                            <select class="form-select form-select-sm" style="width:auto;" id="fh-sort-dir"
                                    onchange="Finance.setSortDirection(this.value)">
                                <option value="DESC" ${FinanceState.sortDir==='DESC'?'selected':''}>تنازلي</option>
                                <option value="ASC" ${FinanceState.sortDir==='ASC'?'selected':''}>تصاعدي</option>
                            </select>
                            <button class="btn btn-sm btn-outline-secondary" onclick="Finance.openSortManager()">
                                <i class="bi bi-sort-down"></i> ترتيب متقدم
                            </button>
                            <span class="text-muted small" id="fh-sort-summary">${Finance.renderSortSummary()}</span>
                        </div>
                        <button class="btn btn-sm btn-outline-success" onclick="Finance.openExportDialog()">
                            <i class="bi bi-file-earmark-excel"></i> تصدير XLSX
                        </button>
                        <button class="btn btn-sm btn-outline-dark" onclick="Finance.printSelected()" title="طباعة السندات المحددة">
                            <i class="bi bi-printer"></i> طباعة المحدد
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="Finance.saveCurrentView()">
                            <i class="bi bi-bookmark-plus"></i> حفظ العرض
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
    };

    // اعتراض خلية الإجراءات لإضافة زر الطباعة المفردة
    const _originalRenderCell = Finance._renderCell;
    Finance._renderCell = function (r, col, selected) {
        if (col.key === 'actions') {
            return `<td>
                <button class="fh-action-btn" title="عرض التفاصيل" onclick="Finance.openDetail('${esc(r.txn_id)}')">
                    <i class="bi bi-eye-fill"></i>
                </button>
                <button class="fh-action-btn" title="طباعة السند" onclick="Finance.printTransaction('${esc(r.txn_id)}')">
                    <i class="bi bi-printer"></i>
                </button>
            </td>`;
        }
        return _originalRenderCell.call(this, r, col, selected);
    };

    // إضافة زر تقرير الوزارة في الترويسة دون كسر M5.2.1
    const _originalViewHub = Finance.viewHub;
    Finance.viewHub = function () {
        injectFinanceStyles();
        injectFinanceM522Styles();
        Core.navigateTo('viewFinanceHub', async () => {
            const main = document.getElementById('mainContent');
            main.innerHTML = `
                <div class="container-fluid fh-page animate-in" id="finance-hub-root">
                    <div class="fh-header">
                        <h2><i class="bi bi-bank2"></i> المركز المالي والسندي الشامل</h2>
                        <div class="fh-header-actions">
                            <button class="btn btn-sm btn-outline-info" onclick="Finance.openMinistryReport()">
                                <i class="bi bi-buildings"></i> تقرير المشتركة
                            </button>
                            <button class="btn btn-sm btn-outline-success" onclick="Finance.openExportDialog()">
                                <i class="bi bi-file-earmark-excel"></i> تصدير
                            </button>
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
    };
})();

console.log('[Finance Hub M5.2.2] ✅ تمت إضافة XLSX Export + Print Templates + Ministry Report Modal.');
