/**
 * daily_journal.js
 * ================================================================
 * 📒 واجهة "اليومية" لنظام أمين الصندوق
 * ================================================================
 *
 * يعرض السندات اليومية مرتّبة في مجموعتين بصرياً:
 *   • المجموعة الأولى (سندات A): مدفوعة كلياً أو جزئياً
 *   • فاصل مرئي بلون مميّز
 *   • المجموعة الثانية (سندات B/C): إعفاءات
 *
 * يدعم أيضاً:
 *   - فلاتر (التاريخ + القسم)
 *   - Modal "التفاصيل" لكل سند (خدمات السند)
 *   - صف مدمج بلون ذهبي لكل فترة (صباحي/مسائي) مع زر "إقفال"
 *   - منع إصدار سندات جديدة بعد الإقفال (يُفرض في الـ Backend)
 *
 * APIs المستهلكة:
 *   - GET  /api/reports/daily_view?date=YYYY-MM-DD&shift_type=morning|evening|all&department_id=N
 *     (🆕 المرحلة 6 — SHIFTS_REFACTOR_PLAN §7.1: مصدر بيانات موحَّد مع شاشة المعلومية اليومية)
 *   - GET  /api/accounting/invoice_services?invoice_id=N
 *   - POST /api/accounting/close_shift
 */

const DailyJournal = {
    state: {
        date: null,
        departmentId: 0,
        shiftType: 'all',   // 🆕 المرحلة 6 — SHIFTS_REFACTOR_PLAN §7.2: فلتر الفترة
        data: null,
    },

    getTodayIso() {
        const d = new Date();
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
        return local.toISOString().split('T')[0];
    },

    fmtMoney(val) {
        const n = Number(val) || 0;
        return n.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ريال';
    },

    injectStylesOnce() {
        if (document.getElementById('dj-styles')) return;
        const style = document.createElement('style');
        style.id = 'dj-styles';
        style.textContent = `
            .dj-shell {
                direction: rtl;
                font-family: 'Noto Sans Arabic', 'Tajawal', 'Cairo', system-ui, sans-serif;
            }
            .dj-shell .app-module-toolbar-card {
                padding: 0.85rem 1rem;
                border-radius: 18px;
            }
            .dj-shell .app-module-surface-body { padding: 0; }

            .dj-shell .dj-toolbar-grid {
                display: grid;
                grid-template-columns: minmax(165px, 185px) minmax(175px, 220px) minmax(260px, 1fr);
                gap: 12px;
                align-items: end;
            }
            .dj-shell .dj-filter-field label {
                color: #64748b;
                font-size: 0.78rem;
                font-weight: 800;
                margin-bottom: 0.4rem;
            }
            .dj-shell .dj-filter-input {
                height: 40px;
                border-radius: 12px;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                font-size: 0.9rem;
                box-shadow: none;
            }
            .dj-shell .dj-filter-input:focus {
                background: #fff;
                border-color: #93c5fd;
                box-shadow: 0 0 0 0.2rem rgba(59,130,246,0.12);
            }
            .dj-shell .dj-toolbar-actions {
                display: flex;
                align-items: end;
                justify-content: space-between;
                gap: 10px;
                flex-wrap: wrap;
            }
            .dj-shell .dj-filter-btn {
                height: 40px;
                min-width: 150px;
                border-radius: 12px;
                padding: 0 16px;
                box-shadow: 0 10px 22px rgba(65,96,224,0.16);
                white-space: nowrap;
            }
            .dj-shell .dj-legend {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                justify-content: flex-end;
            }
            .dj-shell .dj-chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 6px 10px;
                border-radius: 999px;
                background: #eff6ff;
                color: #1d4ed8;
                font-size: 11px;
                font-weight: 800;
                border: 1px solid rgba(191,219,254,.9);
            }
            .dj-shell .dj-chip::before {
                content: '';
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: currentColor;
            }
            .dj-shell .dj-chip.dj-chip-b { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
            .dj-shell .dj-chip.dj-chip-shift { background: #fef3c7; color: #92400e; border-color: #fde68a; }
            .dj-shell .dj-chip.dj-chip-closed { background: #dcfce7; color: #166534; border-color: #bbf7d0; }

            .dj-shell .dj-surface-stack { display: flex; flex-direction: column; gap: 14px; padding: 16px; }

            .dj-shell .dj-kpi-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                gap: 10px;
            }
            .dj-shell .dj-kpi {
                position: relative;
                background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
                border: 1px solid #e9eef5;
                border-radius: 18px;
                padding: 0.8rem 0.9rem 0.72rem;
                min-height: 86px;
                box-shadow: 0 8px 22px rgba(15,23,42,0.05);
                overflow: hidden;
            }
            .dj-shell .dj-kpi::before {
                content: '';
                position: absolute;
                inset-inline: 0;
                top: 0;
                height: 4px;
                background: linear-gradient(90deg, #4160e0 0%, #60a5fa 100%);
            }
            .dj-shell .dj-kpi-label { color: #64748b; font-size: 0.72rem; font-weight: 800; line-height: 1.2; margin-bottom: 0.25rem; }
            .dj-shell .dj-kpi-value { color: #0f172a; font-size: 1.05rem; font-weight: 900; line-height: 1.15; }
            .dj-shell .dj-kpi-sub { color: #94a3b8; font-size: 0.65rem; line-height: 1.25; margin-top: 0.22rem; }

            .dj-shell .dj-table-card {
                background: #fff;
                border: 1px solid #e9ecef;
                border-radius: 22px;
                box-shadow: 0 12px 28px rgba(15,23,42,0.05);
                overflow: hidden;
            }
            .dj-shell .dj-table-card-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
                padding: 14px 18px;
                background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
                border-bottom: 1px solid #eef2f7;
            }
            .dj-shell .dj-table-title { font-size: 0.95rem; font-weight: 900; color: #0f172a; }
            .dj-shell .dj-table-subtitle { font-size: 0.76rem; color: #64748b; margin-top: 0.15rem; }
            .dj-shell .dj-table-count {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 7px 12px;
                border-radius: 999px;
                background: #eef2ff;
                color: #3730a3;
                font-size: 0.74rem;
                font-weight: 800;
                border: 1px solid #c7d2fe;
            }
            .dj-shell .dj-table-wrap {
                overflow: auto;
                -webkit-overflow-scrolling: touch;
                max-width: 100%;
            }
            .dj-shell .dj-table {
                width: 100%;
                min-width: 900px;
                border-collapse: separate;
                border-spacing: 0;
                background: #fff;
            }
            .dj-shell .dj-table th {
                background-color: #f8f9fa;
                color: #6c757d;
                font-weight: 700;
                font-size: 0.87rem;
                padding: 13px 12px;
                border-bottom: 2px solid #e9ecef;
                white-space: nowrap;
                text-align: center;
                position: sticky;
                top: 0;
                z-index: 2;
            }
            .dj-shell .dj-table td {
                padding: 13px 12px;
                vertical-align: middle;
                border-bottom: 1px solid #f1f3f5;
                color: #495057;
                font-size: 0.9rem;
                text-align: center;
            }
            .dj-shell .dj-table tbody tr { transition: all 0.18s ease; }
            .dj-shell .dj-row-a:hover { background-color: rgba(65, 96, 224, 0.03); }
            .dj-shell .dj-row-b { background: #fffaf3; }
            .dj-shell .dj-row-b:hover { background: #fff2df; }
            .dj-shell .dj-table td.dj-cell-patient {
                white-space: normal;
                word-break: break-word;
                max-width: 230px;
                text-align: right;
                font-weight: 700;
                color: #1f2937;
            }
            .dj-shell .dj-serial-no { display:block; font-weight: 800; color: #0f172a; }
            .dj-shell .dj-serial-doc { display:block; margin-top: 2px; font-size: 0.74rem; color: #94a3b8; }
            .dj-shell .dj-amount { font-weight: 800; color: #0f172a; white-space: nowrap; }

            .dj-shell .dj-row-separator td {
                background: linear-gradient(90deg,#fde68a 0%,#fcd34d 50%,#fde68a 100%);
                font-weight: 900;
                color: #78350f;
                font-size: 0.86rem;
                letter-spacing: 0.2px;
                border-bottom-color: #f3d37a;
            }
            .dj-shell .dj-row-shift td {
                background: #fffbeb;
                color: #92400e;
                font-weight: 800;
                text-align: right;
                line-height: 1.85;
                white-space: normal;
            }
            .dj-shell .dj-row-closed td {
                background: #ecfdf5;
                color: #065f46;
                font-weight: 800;
                text-align: right;
                line-height: 1.85;
                white-space: normal;
            }
            .dj-shell .dj-shift-line {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }
            .dj-shell .dj-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 5px 10px;
                border-radius: 999px;
                font-size: 10.5px;
                font-weight: 800;
                white-space: nowrap;
            }
            .dj-shell .dj-badge-a { background: #dbeafe; color: #1e40af; }
            .dj-shell .dj-badge-b { background: #fed7aa; color: #9a3412; }
            .dj-shell .dj-badge-c { background: #fecaca; color: #991b1b; }
            .dj-shell .dj-badge-dept { background: #e0e7ff; color: #3730a3; }

            .dj-shell .dj-empty {
                padding: 56px 24px;
                text-align: center;
                color: #64748b;
                background: #fff;
                border: 1px dashed #dbe3ee;
                border-radius: 18px;
            }
            .dj-shell .dj-detail-btn {
                background: #fff;
                color: #3656d4;
                border: 1px solid #c7d2fe;
                padding: 7px 12px;
                border-radius: 999px;
                cursor: pointer;
                font-size: 11.5px;
                font-weight: 800;
                transition: all 0.18s ease;
                box-shadow: 0 4px 10px rgba(99,102,241,0.08);
                white-space: nowrap;
            }
            .dj-shell .dj-detail-btn:hover { background: #eef2ff; color: #253ea8; border-color: #a5b4fc; }
            .dj-shell .dj-close-btn {
                background: #dc2626;
                color: #fff;
                border: 0;
                padding: 9px 16px;
                border-radius: 999px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 900;
                white-space: nowrap;
                box-shadow: 0 8px 18px rgba(220,38,38,0.18);
            }
            .dj-shell .dj-close-btn:hover { background: #b91c1c; }
            .dj-shell .dj-close-btn:disabled { background: #9ca3af; cursor: not-allowed; box-shadow: none; }

            #dj-modal-bg {
                position: fixed;
                inset: 0;
                background: rgba(15,23,42,.55);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                padding: 16px;
            }
            #dj-modal-bg.show { display: flex; }
            #dj-modal {
                background: #fff;
                border-radius: 22px;
                max-width: 760px;
                width: min(100%, 760px);
                max-height: 85vh;
                overflow: auto;
                padding: 22px;
                direction: rtl;
                box-shadow: 0 24px 50px rgba(15,23,42,.25);
            }
            #dj-modal h3 { margin: 0 0 14px 0; color: #1e40af; font-weight: 900; }
            #dj-modal table { width: 100%; border-collapse: collapse; }
            #dj-modal th, #dj-modal td { border: 1px solid #d1d5db; padding: 9px; text-align: center; font-size: 13px; }
            #dj-modal th { background: #f8fafc; font-weight: 700; }
            #dj-modal-close {
                margin-top: 14px;
                background: #64748b;
                color: #fff;
                border: 0;
                padding: 10px 18px;
                border-radius: 12px;
                cursor: pointer;
                font-weight: 800;
            }

            [data-theme="dark"] .dj-shell .app-module-toolbar-card,
            [data-theme="dark"] .dj-shell .dj-table-card,
            [data-theme="dark"] #dj-modal {
                background: #1f2937;
                border-color: #334155;
                color: #e2e8f0;
            }
            [data-theme="dark"] .dj-shell .dj-filter-field label,
            [data-theme="dark"] .dj-shell .dj-table-subtitle,
            [data-theme="dark"] .dj-shell .dj-kpi-label,
            [data-theme="dark"] .dj-shell .dj-kpi-sub { color: #94a3b8; }
            [data-theme="dark"] .dj-shell .dj-filter-input {
                background: #111827;
                border-color: #334155;
                color: #e2e8f0;
            }
            [data-theme="dark"] .dj-shell .dj-filter-input:focus { background: #0f172a; }
            [data-theme="dark"] .dj-shell .dj-chip { background: rgba(59,130,246,.18); color: #93c5fd; border-color: rgba(59,130,246,.22); }
            [data-theme="dark"] .dj-shell .dj-chip.dj-chip-b { background: rgba(249,115,22,.18); color: #fdba74; border-color: rgba(249,115,22,.24); }
            [data-theme="dark"] .dj-shell .dj-chip.dj-chip-shift { background: rgba(245,158,11,.16); color: #fcd34d; border-color: rgba(245,158,11,.24); }
            [data-theme="dark"] .dj-shell .dj-chip.dj-chip-closed { background: rgba(16,185,129,.16); color: #86efac; border-color: rgba(16,185,129,.24); }
            [data-theme="dark"] .dj-shell .dj-kpi {
                background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
                border-color: #334155;
                box-shadow: none;
            }
            [data-theme="dark"] .dj-shell .dj-kpi-value,
            [data-theme="dark"] .dj-shell .dj-table-title,
            [data-theme="dark"] .dj-shell .dj-serial-no,
            [data-theme="dark"] .dj-shell .dj-amount { color: #f8fafc; }
            [data-theme="dark"] .dj-shell .dj-table-card-head { background: linear-gradient(180deg, #1f2937 0%, #111827 100%); border-bottom-color: #334155; }
            [data-theme="dark"] .dj-shell .dj-table-count { background: rgba(99,102,241,.18); color: #c7d2fe; border-color: rgba(99,102,241,.22); }
            [data-theme="dark"] .dj-shell .dj-table { background: transparent; }
            [data-theme="dark"] .dj-shell .dj-table th { background-color: #2d3748 !important; color: #a0aec0; border-bottom-color: #4a5568; }
            [data-theme="dark"] .dj-shell .dj-table td { color: #e2e8f0; border-bottom-color: #4a5568; }
            [data-theme="dark"] .dj-shell .dj-row-a:hover { background-color: rgba(99,179,237,0.08); }
            [data-theme="dark"] .dj-shell .dj-row-b { background: rgba(249,115,22,.10); }
            [data-theme="dark"] .dj-shell .dj-row-b:hover { background: rgba(249,115,22,.16); }
            [data-theme="dark"] .dj-shell .dj-row-shift td { background: rgba(245,158,11,.14); color: #fcd34d; }
            [data-theme="dark"] .dj-shell .dj-row-closed td { background: rgba(16,185,129,.14); color: #86efac; }
            [data-theme="dark"] .dj-shell .dj-empty { color: #cbd5e1; background: #1f2937; border-color: #334155; }
            [data-theme="dark"] .dj-shell .dj-detail-btn { background: #111827; color: #c7d2fe; border-color: #4f46e5; box-shadow: none; }
            [data-theme="dark"] #dj-modal h3 { color: #93c5fd; }
            [data-theme="dark"] #dj-modal th { background: #111827; }
            [data-theme="dark"] #dj-modal th,
            [data-theme="dark"] #dj-modal td { border-color: #334155; color: #e2e8f0; }

            @media (max-width: 1199px) {
                .dj-shell .dj-toolbar-grid {
                    grid-template-columns: minmax(160px, 180px) minmax(170px, 220px) 1fr;
                }
            }
            @media (max-width: 992px) {
                .dj-shell .dj-toolbar-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .dj-shell .dj-toolbar-actions { grid-column: 1 / -1; }
                .dj-shell .dj-filter-btn { min-width: 136px; }
            }
            @media (max-width: 768px) {
                .dj-shell .app-module-toolbar-card { padding: 0.8rem; }
                .dj-shell .dj-surface-stack { padding: 12px; gap: 12px; }
                .dj-shell .dj-toolbar-grid { grid-template-columns: 1fr; }
                .dj-shell .dj-toolbar-actions { flex-direction: column; align-items: stretch; }
                .dj-shell .dj-legend { justify-content: flex-start; }
                .dj-shell .dj-filter-btn,
                .dj-shell .dj-close-btn { width: 100%; }
                .dj-shell .dj-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 8px; }
                .dj-shell .dj-kpi { min-height: 70px; padding: 0.58rem 0.62rem; border-radius: 14px; }
                .dj-shell .dj-kpi-label { font-size: 0.68rem; }
                .dj-shell .dj-kpi-value { font-size: 0.94rem; }
                .dj-shell .dj-kpi-sub { font-size: 0.6rem; }
                .dj-shell .dj-table-card-head { padding: 12px 14px; }
                .dj-shell .dj-table { min-width: 760px; }
                .dj-shell .dj-table th { padding: 10px 8px; font-size: 0.78rem; }
                .dj-shell .dj-table td { padding: 11px 8px; font-size: 0.82rem; }
                .dj-shell .dj-table td.dj-cell-patient { max-width: 150px; }
            }
            @media (max-width: 420px) {
                .dj-shell .dj-kpi { min-height: 64px; padding: 0.5rem 0.55rem; }
                .dj-shell .dj-kpi-label { font-size: 0.64rem; }
                .dj-shell .dj-kpi-value { font-size: 0.88rem; }
                .dj-shell .dj-kpi-sub { font-size: 0.58rem; }
            }
            @media print {
                .dj-shell .app-module-toolbar-card,
                .dj-shell .dj-kpi-grid,
                .dj-shell .dj-detail-btn,
                .dj-shell .dj-close-btn,
                #dj-modal-bg,
                .custom-navbar,
                .sidebar,
                .sidebar-overlay { display: none !important; }
                .dj-shell .app-module-surface,
                .dj-shell .dj-table-card { box-shadow: none; border: 0; }
                .dj-shell .dj-table { min-width: 100%; font-size: 11px; }
                .dj-shell .dj-table th,
                .dj-shell .dj-table td { padding: 7px 6px; }
            }
        `;
        document.head.appendChild(style);
    },

    view() {
        Core.navigateTo('openDailyJournal', () => {
            this.injectStylesOnce();
            this.state.date = this.getTodayIso();
            this.state.departmentId = 0;

            const main = document.getElementById('mainContent');
            const tools = [
                { label: 'تحديث', icon: 'bi-arrow-repeat', action: 'DailyJournal.load()' },
                { label: 'طباعة', icon: 'bi-printer', action: 'window.print()' },
            ];

            // 🆕 المرحلة 6 (§7.2): إضافة Dropdown فلتر الفترة [ كل الفترات | الصباحية | المسائية ]
            const toolbar = `
                <div class="dj-toolbar-grid" dir="rtl">
                    <div class="dj-filter-field">
                        <label class="form-label">التاريخ</label>
                        <input type="date" id="dj-date" class="form-control form-control-sm dj-filter-input" value="${this.state.date}">
                    </div>
                    <div class="dj-filter-field">
                        <label class="form-label">الفترة</label>
                        <select id="dj-shift" class="form-select form-select-sm dj-filter-input">
                            <option value="all" ${this.state.shiftType === 'all' ? 'selected' : ''}>كل الفترات</option>
                            <option value="morning" ${this.state.shiftType === 'morning' ? 'selected' : ''}>الصباحية</option>
                            <option value="evening" ${this.state.shiftType === 'evening' ? 'selected' : ''}>المسائية</option>
                        </select>
                    </div>
                    <div class="dj-filter-field">
                        <label class="form-label">القسم</label>
                        <select id="dj-dept" class="form-select form-select-sm dj-filter-input">
                            <option value="0">جميع الأقسام</option>
                            <option value="1">المختبر</option>
                            <option value="2">الأشعة</option>
                            <option value="3">التمريض</option>
                            <option value="4">الصيدلية</option>
                            <option value="5">الطوارئ</option>
                            <option value="6">أخرى</option>
                        </select>
                    </div>
                    <div class="dj-toolbar-actions">
                        <div class="dj-legend">
                            <span class="dj-chip">سندات A</span>
                            <span class="dj-chip dj-chip-b">سندات B / C</span>
                            <span class="dj-chip dj-chip-shift">فترات مفتوحة</span>
                            <span class="dj-chip dj-chip-closed">فترات مقفلة</span>
                        </div>
                        <button class="btn btn-primary btn-sm fw-bold dj-filter-btn" onclick="DailyJournal.load()">
                            <i class="bi bi-funnel ms-1"></i> تطبيق الفلاتر
                        </button>
                    </div>
                </div>
            `;

            main.innerHTML = Core.renderModulePage({
                title: 'اليومية',
                subtitle: 'سجل السندات اليومية مع إقفال فترات تذاكر المعاينة ضمن قالب موحّد ومتجاوب.',
                toolsActions: tools,
                toolbar,
                shellClass: 'dj-shell',
                surfaceClass: 'dj-surface',
                body: `
                    <div id="dj-container" class="dj-surface-stack" dir="rtl">
                        <div class="text-center py-5"><div class="spinner-border text-primary"></div></div>
                    </div>
                `,
            });

            main.insertAdjacentHTML('beforeend', `
                <div id="dj-modal-bg" dir="rtl" onclick="if(event.target===this) DailyJournal.closeModal()">
                    <div id="dj-modal" dir="rtl" style="font-family: 'Noto Sans Arabic', 'Tajawal', 'Cairo', system-ui, sans-serif;">
                        <h3 id="dj-modal-title">تفاصيل السند</h3>
                        <div id="dj-modal-body">
                            <div class="text-center"><div class="spinner-border text-primary"></div></div>
                        </div>
                        <button id="dj-modal-close" onclick="DailyJournal.closeModal()">إغلاق</button>
                    </div>
                </div>
            `);

            this.load();
        });
    },

    /**
     * 🆕 المرحلة 6 (§7.1): يستهلك endpoint موحَّد /api/reports/daily_view
     * بدلاً من /api/accounting/daily_journal. هذا يضمن أن شاشتي اليومية
     * والمعلومية اليومية تتشاركان نفس مصدر البيانات المُجمَّع.
     */
    async load() {
        this.state.date = document.getElementById('dj-date')?.value || this.getTodayIso();
        this.state.departmentId = parseInt(document.getElementById('dj-dept')?.value || '0', 10);
        const shiftSel = document.getElementById('dj-shift')?.value || 'all';
        this.state.shiftType = ['all', 'morning', 'evening'].includes(shiftSel) ? shiftSel : 'all';

        const container = document.getElementById('dj-container');
        if (!container) return;
        container.innerHTML = `<div class="text-center py-5" dir="rtl"><div class="spinner-border text-primary"></div></div>`;

        try {
            const params = new URLSearchParams({
                date: this.state.date,
                shift_type: this.state.shiftType,
            });
            if (this.state.departmentId > 0) params.append('department_id', String(this.state.departmentId));

            const res = await Core.apiCall('reports/daily_view?' + params.toString(), 'GET');
            if (!res || !res.success) {
                container.innerHTML = `<div class="dj-empty" dir="rtl">⚠️ تعذر جلب بيانات اليومية.</div>`;
                return;
            }

            // الحمولة الجديدة: { report_date, shift_filter, shift_boundaries, journal: {invoices, shift_totals, closures}, daily_info: {...} }
            const payload = res.data || {};
            const journal = payload.journal || {};
            this.state.data = {
                invoices: Array.isArray(journal.invoices) ? journal.invoices : [],
                shift_totals: Array.isArray(journal.shift_totals) ? journal.shift_totals : [],
                closures: Array.isArray(journal.closures) ? journal.closures : [],
                shift_boundaries: Array.isArray(payload.shift_boundaries) ? payload.shift_boundaries : [],
                shift_filter: payload.shift_filter || 'all',
            };
            this.render();
        } catch (error) {
            console.error('daily_journal load error:', error);
            container.innerHTML = `<div class="dj-empty" dir="rtl">⚠️ حدث خطأ أثناء تحميل اليومية.</div>`;
        }
    },

    renderSummaryCards(invoices, groupA, groupBC, shiftTotals, closures) {
        const totalAmount = invoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
        return `
            <div class="dj-kpi-grid" dir="rtl">
                <div class="dj-kpi">
                    <div class="dj-kpi-label">إجمالي السندات</div>
                    <div class="dj-kpi-value">${(invoices.length || 0).toLocaleString('ar-EG')}</div>
                    <div class="dj-kpi-sub">سندات اليوم بعد الفلترة</div>
                </div>
                <div class="dj-kpi">
                    <div class="dj-kpi-label">سندات A</div>
                    <div class="dj-kpi-value">${(groupA.length || 0).toLocaleString('ar-EG')}</div>
                    <div class="dj-kpi-sub">دفع كامل أو جزئي</div>
                </div>
                <div class="dj-kpi">
                    <div class="dj-kpi-label">سندات الإعفاء</div>
                    <div class="dj-kpi-value">${(groupBC.length || 0).toLocaleString('ar-EG')}</div>
                    <div class="dj-kpi-sub">أنواع B و C</div>
                </div>
                <div class="dj-kpi">
                    <div class="dj-kpi-label">إجمالي المبالغ</div>
                    <div class="dj-kpi-value">${this.fmtMoney(totalAmount)}</div>
                    <div class="dj-kpi-sub">مجموع مبالغ السندات في الجدول</div>
                </div>
                <div class="dj-kpi">
                    <div class="dj-kpi-label">فترات مفتوحة</div>
                    <div class="dj-kpi-value">${(shiftTotals.length || 0).toLocaleString('ar-EG')}</div>
                    <div class="dj-kpi-sub">بحاجة إلى إقفال</div>
                </div>
                <div class="dj-kpi">
                    <div class="dj-kpi-label">فترات مقفلة</div>
                    <div class="dj-kpi-value">${(closures.length || 0).toLocaleString('ar-EG')}</div>
                    <div class="dj-kpi-sub">إقفالات منجزة لنفس اليوم</div>
                </div>
            </div>
        `;
    },

    render() {
        const container = document.getElementById('dj-container');
        if (!container) return;

        const data = this.state.data || { invoices: [], shift_totals: [], closures: [] };
        const invoices = Array.isArray(data.invoices) ? data.invoices : [];
        const shift_totals = Array.isArray(data.shift_totals) ? data.shift_totals : [];
        const closures = Array.isArray(data.closures) ? data.closures : [];

        if (invoices.length === 0 && shift_totals.length === 0 && closures.length === 0) {
            container.innerHTML = `
                ${this.renderSummaryCards([], [], [], [], [])}
                <div class="dj-empty">📭 لا توجد سندات أو فترات لهذا اليوم.</div>
            `;
            return;
        }

        const groupA = invoices.filter(i => Number(i.group_order) === 0);
        const groupBC = invoices.filter(i => Number(i.group_order) === 1);

        let html = `
            ${this.renderSummaryCards(invoices, groupA, groupBC, shift_totals, closures)}
            <div class="dj-table-card">
                <div class="dj-table-card-head">
                    <div>
                        <div class="dj-table-title">سجل السندات اليومية</div>
                        <div class="dj-table-subtitle">عرض منسّق ومضغوط ومتوافق مع أسلوب جداول النظام.</div>
                    </div>
                    <span class="dj-table-count"><i class="bi bi-table"></i> ${(invoices.length || 0).toLocaleString('ar-EG')} سند</span>
                </div>
                <div class="dj-table-wrap">
                    <table class="custom-table dj-table text-end mb-0">
                        <thead>
                            <tr>
                                <th style="width: 56px;">#</th>
                                <th>اسم المريض</th>
                                <th style="width: 118px;">رقم السند</th>
                                <th style="width: 132px;">القسم</th>
                                <th style="width: 152px;">نوع السند</th>
                                <th style="width: 132px;">المبلغ</th>
                                <th style="width: 104px;">الوقت</th>
                                <th style="width: 116px;">التفاصيل</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        let rowNum = 1;
        for (const inv of groupA) {
            html += this.renderInvoiceRow(inv, rowNum++, 'a');
        }

        if (groupA.length > 0 && groupBC.length > 0) {
            html += `
                <tr class="dj-row-separator">
                    <td colspan="8">⚠️ ──── سندات الإعفاءات (B / C) ────</td>
                </tr>
            `;
        }

        for (const inv of groupBC) {
            html += this.renderInvoiceRow(inv, rowNum++, 'b');
        }

        // 🆕 تحديد الإقفال الأخير لإظهار زر "إعادة فتح":
        // نعتبر أن "الأخير" في سياق اليوم المعروض هو الإقفال صاحب أحدث closed_at
        // (الباكإند سيفرض القاعدة الصحيحة على مستوى كافة الإقفالات)
        let latestClosureId = null;
        if (closures && closures.length > 0) {
            const sorted = [...closures].sort((a, b) => {
                const ka = String(a.closed_at || '');
                const kb = String(b.closed_at || '');
                if (ka !== kb) return ka < kb ? 1 : -1;
                return (Number(b.id) || 0) - (Number(a.id) || 0);
            });
            latestClosureId = sorted[0]?.id ?? null;
        }

        for (const c of closures) {
            const lbl = c.shift_type === 'morning' ? 'الصباحية' : 'المسائية';
            const isLatest = (latestClosureId !== null) && (Number(c.id) === Number(latestClosureId));
            const reopenBtn = isLatest
                ? `<button class="dj-reopen-btn" style="margin-inline-start:8px;background:#dc3545;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.85em;" onclick="DailyJournal.reopenShift(${Number(c.id)}, this)">🔓 إعادة فتح</button>`
                : '';
            html += `
                <tr class="dj-row-closed">
                    <td colspan="8">
                        ✅ تم إقفال الفترة ${lbl}: تذاكر من [${c.start_ticket_no}] إلى [${c.end_ticket_no}]
                        | الإجمالي: ${this.fmtMoney(c.total_amount)}
                        | حصة المركز: ${this.fmtMoney(c.center_share)}
                        | حصة الوزارة: ${this.fmtMoney(c.ministry_share)}
                        | سند التحصيل رقم: ${c.closing_serial ?? '—'}
                        | بواسطة: ${this.escape(c.closed_by_name ?? '—')}
                        ${reopenBtn}
                    </td>
                </tr>
            `;
        }

        for (const st of shift_totals) {
            html += `
                <tr class="dj-row-shift">
                    <td colspan="8">
                        <div class="dj-shift-line">
                            <span>
                                تذاكر الفترة ${this.escape(st.shift_label)} من تسلسل [${st.start_no}] إلى [${st.end_no}] 
                                (${st.tickets_count} تذكرة) —
                                حصة المركز ${this.fmtMoney(st.center_share)} —
                                حصة الوزارة ${this.fmtMoney(st.ministry_share)}
                            </span>
                            <button class="dj-close-btn" onclick="DailyJournal.closeShift('${st.shift_type}', this)">
                                🔒 إقفال الفترة
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }

        html += `</tbody></table></div></div>`;
        container.innerHTML = html;
    },

    renderInvoiceRow(inv, idx, group) {
        const docClass = inv.doc_name === 'A' ? 'dj-badge-a' : inv.doc_name === 'B' ? 'dj-badge-b' : 'dj-badge-c';
        const safePatient = encodeURIComponent(String(inv.patient_name || ''));
        const patientName = this.escape(inv.patient_name);
        return `
            <tr class="dj-row-${group}">
                <td>${idx}</td>
                <td class="dj-cell-patient" title="${patientName}">${patientName}</td>
                <td>
                    <span class="dj-serial-no">${inv.serial_number}</span>
                    <span class="dj-serial-doc">(${inv.doc_name})</span>
                </td>
                <td><span class="dj-badge dj-badge-dept">${this.escape(inv.department_name || '—')}</span></td>
                <td><span class="dj-badge ${docClass}">${this.escape(inv.type_label)}</span></td>
                <td><span class="dj-amount">${this.fmtMoney(inv.amount)}</span></td>
                <td><span class="text-muted small fw-bold">${this.escape(inv.time || '')}</span></td>
                <td>
                    <button class="dj-detail-btn" onclick="DailyJournal.showDetails(${inv.invoice_id}, decodeURIComponent('${safePatient}'))">
                        <i class="bi bi-eye ms-1"></i> عرض
                    </button>
                </td>
            </tr>
        `;
    },

    async showDetails(invoiceId, patientName) {
        const modalBg = document.getElementById('dj-modal-bg');
        const titleEl = document.getElementById('dj-modal-title');
        const body = document.getElementById('dj-modal-body');
        if (!modalBg || !titleEl || !body) return;

        modalBg.classList.add('show');
        titleEl.textContent = `تفاصيل السند للمريض: ${patientName}`;
        body.innerHTML = `<div class="text-center"><div class="spinner-border text-primary"></div></div>`;

        try {
            const res = await Core.apiCall('accounting/invoice_services?invoice_id=' + invoiceId, 'GET');
            if (!res || !res.success) {
                body.innerHTML = `<div class="text-danger">تعذر جلب تفاصيل السند.</div>`;
                return;
            }

            const services = res.data.services || [];
            if (services.length === 0) {
                body.innerHTML = `<div class="text-muted text-center p-3">📋 لا توجد خدمات تفصيلية لهذا السند (قد يكون سند تذاكر إقفالي).</div>`;
                return;
            }

            let total = 0;
            const rows = services.map((s, i) => {
                const p = Number(s.price) * Number(s.quantity || 1);
                total += p;
                return `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${this.escape(s.service_name)}</td>
                        <td>${s.quantity || 1}</td>
                        <td>${this.fmtMoney(s.price)}</td>
                        <td>${this.fmtMoney(p)}</td>
                    </tr>
                `;
            }).join('');

            body.innerHTML = `
                <table>
                    <thead>
                        <tr><th>#</th><th>الخدمة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                    <tfoot>
                        <tr style="background:#eef2ff;font-weight:700;">
                            <td colspan="4">المجموع الكلي</td>
                            <td>${this.fmtMoney(total)}</td>
                        </tr>
                    </tfoot>
                </table>
            `;
        } catch (error) {
            console.error('daily_journal details error:', error);
            body.innerHTML = `<div class="text-danger">حدث خطأ أثناء جلب تفاصيل السند.</div>`;
        }
    },

    closeModal() {
        document.getElementById('dj-modal-bg')?.classList.remove('show');
    },

    /**
     * 🆕 إعادة فتح الفترة المالية الأخيرة:
     *   - يستدعي نقطة accounting/reopen_shift
     *   - الباكإند يفرض أن يكون closure_id هو الأخير فعلاً
     */
    async reopenShift(closureId, btn) {
        if (!closureId || closureId <= 0) {
            Core.showAlert('معرف الإقفال غير صالح.', 'error');
            return;
        }
        if (!confirm('⚠️ تحذير: عند إعادة فتح هذه الفترة:\n' +
            '   • سيتم حذف سند التحصيل الإجمالي (سند A) المرتبط بها.\n' +
            '   • ستُعاد ترقيم السندات اللاحقة تلقائياً.\n' +
            '   • ستعود تذاكر الفترة قابلة للإقفال مجدداً.\n\n' +
            'هل أنت متأكد؟')) {
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ جاري إعادة الفتح...';
        }

        try {
            const res = await Core.apiCall('accounting/reopen_shift', 'POST', { closure_id: Number(closureId) });
            if (!res || !res.success) {
                const msg = (res && res.message) ? res.message : 'تعذر إعادة فتح الفترة.';
                Core.showAlert(msg, 'error');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🔓 إعادة فتح';
                }
                return;
            }
            Core.showAlert(res.message || 'تمت إعادة فتح الفترة بنجاح.', 'success');
            await this.load();
        } catch (error) {
            console.error('daily_journal reopen shift error:', error);
            Core.showAlert('حدث خطأ أثناء إعادة فتح الفترة.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔓 إعادة فتح';
            }
        }
    },

    async closeShift(shiftType, btn) {
        const label = shiftType === 'morning' ? 'الصباحية' : 'المسائية';
        if (!confirm(`هل أنت متأكد من إقفال الفترة ${label}؟\n\nسيتم توليد سند A إجمالي تلقائياً، ومنع إصدار تذاكر جديدة في فترة مماثلة من تاريخ سابق.`)) {
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ جاري الإقفال...';
        }

        try {
            const res = await Core.apiCall('accounting/close_shift', 'POST', {
                shift_type: shiftType,
                date: this.state.date,
            });

            if (!res || !res.success) {
                const msg = (res && res.message) ? res.message : 'تعذر إقفال الفترة.';
                Core.showAlert(msg, 'error');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🔒 إقفال الفترة';
                }
                return;
            }

            const d = res.data || {};
            Core.showAlert(
                `✅ تم إقفال الفترة ${label} بنجاح.\nسند رقم ${d.serial_number} | إجمالي: ${this.fmtMoney(d.total_amount)}`,
                'success'
            );
            await this.load();
        } catch (error) {
            console.error('daily_journal close shift error:', error);
            Core.showAlert('حدث خطأ أثناء إقفال الفترة.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔒 إقفال الفترة';
            }
        }
    },

    escape(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    },
};

window.DailyJournal = DailyJournal;
