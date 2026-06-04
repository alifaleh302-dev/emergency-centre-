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
 *   - GET  /api/accounting/daily_journal?date=YYYY-MM-DD&department_id=N
 *   - GET  /api/accounting/invoice_services?invoice_id=N
 *   - POST /api/accounting/close_shift
 */

const DailyJournal = {
    state: {
        date: null,
        departmentId: 0,
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
            /* تطبيق الأنماط على الحاوية الفعلية #dj-container (بدلاً من #dj-container, #dj-wrapper غير الموجود) */
            #dj-container, #dj-wrapper { direction: rtl; font-family: 'Noto Sans Arabic', 'Tajawal', 'Cairo', system-ui, sans-serif; }
            #dj-container .app-module-surface-body, #dj-container, #dj-wrapper .app-module-surface-body { padding: 0; }

            /* ===== مربعات الملخص المصغّرة (KPI) — تجاوز نسخة الـ core للحصول على شبكة 2×2 على الهاتف ===== */
            #dj-container, #dj-wrapper .dj-kpi-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
                gap: 10px;
            }
            #dj-container, #dj-wrapper .dj-kpi {
                background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
                border: 1px solid rgba(226,232,240,0.95);
                border-radius: 14px;
                padding: 0.65rem 0.75rem;
                min-height: 78px;
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.7);
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 2px;
            }
            #dj-container, #dj-wrapper .dj-kpi-label { color: #64748b; font-size: 0.72rem; font-weight: 700; line-height: 1.2; }
            #dj-container, #dj-wrapper .dj-kpi-value { color: #0f172a; font-size: 1.05rem; font-weight: 800; line-height: 1.2; }
            #dj-container, #dj-wrapper .dj-kpi-sub   { color: #94a3b8; font-size: 0.66rem; line-height: 1.25; margin-top: 1px; }

            #dj-container, #dj-wrapper .dj-toolbar-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 12px;
                align-items: end;
            }
            #dj-container, #dj-wrapper .dj-toolbar-actions {
                display: flex;
                gap: 10px;
                align-items: center;
                flex-wrap: wrap;
            }
            #dj-container, #dj-wrapper .dj-legend {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                justify-content: flex-end;
            }
            #dj-container, #dj-wrapper .dj-chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 7px 12px;
                border-radius: 999px;
                background: #eff6ff;
                color: #1d4ed8;
                font-size: 12px;
                font-weight: 700;
            }
            #dj-container, #dj-wrapper .dj-chip::before {
                content: '';
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: currentColor;
            }
            #dj-container, #dj-wrapper .dj-chip.dj-chip-b { background: #fff7ed; color: #c2410c; }
            #dj-container, #dj-wrapper .dj-chip.dj-chip-shift { background: #fef3c7; color: #92400e; }
            #dj-container, #dj-wrapper .dj-chip.dj-chip-closed { background: #dcfce7; color: #166534; }
            #dj-container, #dj-wrapper .dj-surface-stack { display: flex; flex-direction: column; gap: 16px; padding: 18px; }

            /* ===== جدول اليومية — يتبع معايير custom-table في النظام ===== */
            #dj-container, #dj-wrapper .dj-table-wrap {
                overflow-x: auto;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                border: 1px solid #e9ecef;
                border-radius: 16px;
                background: #fff;
                max-width: 100%;
                box-shadow: 0 4px 14px rgba(15,23,42,0.04);
            }
            #dj-container, #dj-wrapper .dj-table {
                width: 100%;
                min-width: 880px;
                border-collapse: separate;
                border-spacing: 0;
                background: #fff;
            }
            #dj-container, #dj-wrapper .dj-table th {
                background-color: #f8f9fa;
                color: #6c757d;
                font-weight: 700;
                font-size: 0.9rem;
                padding: 14px 12px;
                text-align: center;
                vertical-align: middle;
                border-bottom: 2px solid #e9ecef;
                white-space: nowrap;
                position: sticky;
                top: 0;
                z-index: 2;
            }
            #dj-container, #dj-wrapper .dj-table td {
                padding: 14px 12px;
                text-align: center;
                vertical-align: middle;
                border-bottom: 1px solid #f1f3f5;
                color: #495057;
                font-size: 0.92rem;
                line-height: 1.5;
            }
            #dj-container, #dj-wrapper .dj-table td.dj-cell-patient {
                white-space: normal;
                word-break: break-word;
                max-width: 220px;
                text-align: right;
                font-weight: 600;
                color: #1f2937;
            }
            #dj-container, #dj-wrapper .dj-table tbody tr { transition: all 0.2s ease; }
            #dj-container, #dj-wrapper .dj-row-a { background: #ffffff; }
            #dj-container, #dj-wrapper .dj-row-a:hover { background: rgba(65, 96, 224, 0.03); }
            #dj-container, #dj-wrapper .dj-row-b { background: #fffaf3; }
            #dj-container, #dj-wrapper .dj-row-b:hover { background: #fff1e0; }
            #dj-container, #dj-wrapper .dj-row-separator {
                background: linear-gradient(90deg,#fde68a 0%,#fcd34d 50%,#fde68a 100%);
                font-weight: 800;
                color: #78350f;
                font-size: 14px;
            }
            #dj-container, #dj-wrapper .dj-row-shift {
                background: #fffbeb;
                color: #92400e;
                font-weight: 700;
                font-size: 13.5px;
            }
            #dj-container, #dj-wrapper .dj-row-shift td,
            #dj-container, #dj-wrapper .dj-row-closed td {
                padding: 16px 14px;
                text-align: right;
                line-height: 1.9;
            }
            #dj-container, #dj-wrapper .dj-shift-line {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }
            #dj-container, #dj-wrapper .dj-row-closed {
                background: #ecfdf5;
                color: #065f46;
                font-weight: 700;
            }
            #dj-container, #dj-wrapper .dj-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 5px 10px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 800;
                white-space: nowrap;
            }
            #dj-container, #dj-wrapper .dj-badge-a  { background: #dbeafe; color: #1e40af; }
            #dj-container, #dj-wrapper .dj-badge-b  { background: #fed7aa; color: #9a3412; }
            #dj-container, #dj-wrapper .dj-badge-c  { background: #fecaca; color: #991b1b; }
            #dj-container, #dj-wrapper .dj-badge-dept { background: #e0e7ff; color: #3730a3; }
            #dj-container, #dj-wrapper .dj-empty {
                padding: 56px 24px;
                text-align: center;
                color: #64748b;
            }
            #dj-container, #dj-wrapper .dj-detail-btn {
                background: #4f46e5;
                color: #fff;
                border: 0;
                padding: 8px 14px;
                border-radius: 10px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 700;
                transition: all .2s ease;
            }
            #dj-container, #dj-wrapper .dj-detail-btn:hover { background: #4338ca; transform: translateY(-1px); }
            #dj-container, #dj-wrapper .dj-close-btn {
                background: #dc2626;
                color: #fff;
                border: 0;
                padding: 9px 16px;
                border-radius: 10px;
                cursor: pointer;
                font-size: 12.5px;
                font-weight: 800;
                white-space: nowrap;
            }
            #dj-container, #dj-wrapper .dj-close-btn:hover { background: #b91c1c; }
            #dj-container, #dj-wrapper .dj-close-btn:disabled { background: #9ca3af; cursor: not-allowed; }

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
            #dj-modal h3 { margin: 0 0 14px 0; color: #1e40af; font-weight: 800; }
            #dj-modal table { width: 100%; border-collapse: collapse; }
            #dj-modal th, #dj-modal td {
                border: 1px solid #d1d5db;
                padding: 9px;
                text-align: center;
                font-size: 13px;
            }
            #dj-modal th { background: #f8fafc; font-weight: 700; }
            #dj-modal-close {
                margin-top: 14px;
                background: #64748b;
                color: #fff;
                border: 0;
                padding: 10px 18px;
                border-radius: 10px;
                cursor: pointer;
                font-weight: 700;
            }

            [data-theme="dark"] #dj-container, #dj-wrapper .dj-table-wrap,
            [data-theme="dark"] #dj-modal {
                background: #1f2937;
                border-color: #334155;
            }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-table,
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-row-a,
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-row-b { background: transparent; color: #e2e8f0; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-table th,
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-table td,
            [data-theme="dark"] #dj-modal th,
            [data-theme="dark"] #dj-modal td { border-color: #334155; color: #e2e8f0; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-row-a:hover { background: rgba(59,130,246,.12); }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-row-b:hover { background: rgba(249,115,22,.12); }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-row-shift { background: rgba(245,158,11,.14); color: #fcd34d; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-row-closed { background: rgba(16,185,129,.14); color: #86efac; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-chip { background: rgba(59,130,246,.18); color: #93c5fd; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-chip.dj-chip-b { background: rgba(249,115,22,.18); color: #fdba74; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-chip.dj-chip-shift { background: rgba(245,158,11,.16); color: #fcd34d; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-chip.dj-chip-closed { background: rgba(16,185,129,.16); color: #86efac; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-empty { color: #cbd5e1; }
            [data-theme="dark"] #dj-modal h3 { color: #93c5fd; }
            [data-theme="dark"] #dj-modal th { background: #111827; }

            @media (max-width: 768px) {
                #dj-container, #dj-wrapper .dj-surface-stack { padding: 12px; gap: 12px; }
                #dj-container, #dj-wrapper .dj-toolbar-grid { grid-template-columns: 1fr; }
                #dj-container, #dj-wrapper .dj-toolbar-actions { flex-direction: column; align-items: stretch; }
                #dj-container, #dj-wrapper .dj-legend { justify-content: flex-start; }
                #dj-container, #dj-wrapper .dj-shift-line { flex-direction: column; align-items: stretch; }
                #dj-container, #dj-wrapper .dj-close-btn { width: 100%; }

                /* ===== شبكة 2×2 للملخصات على الهاتف ===== */
                #dj-container, #dj-wrapper .dj-kpi-grid {
                    grid-template-columns: repeat(2, 1fr) !important;
                    gap: 8px;
                }
                #dj-container, #dj-wrapper .dj-kpi {
                    padding: 0.55rem 0.6rem;
                    min-height: 70px;
                    border-radius: 12px;
                }
                #dj-container, #dj-wrapper .dj-kpi-label { font-size: 0.68rem; }
                #dj-container, #dj-wrapper .dj-kpi-value { font-size: 0.95rem; }
                #dj-container, #dj-wrapper .dj-kpi-sub   { font-size: 0.62rem; }

                /* جدول أكثر راحة على الهاتف */
                #dj-container, #dj-wrapper .dj-table { min-width: 760px; font-size: 0.82rem; }
                #dj-container, #dj-wrapper .dj-table th { padding: 10px 8px; font-size: 0.78rem; }
                #dj-container, #dj-wrapper .dj-table td { padding: 11px 8px; font-size: 0.82rem; }
                #dj-container, #dj-wrapper .dj-table td.dj-cell-patient { max-width: 150px; }
                #dj-container, #dj-wrapper .dj-detail-btn { padding: 7px 10px; font-size: 11px; }
                #dj-container, #dj-wrapper .dj-badge { padding: 4px 8px; font-size: 10px; }
            }

            @media (max-width: 420px) {
                #dj-container, #dj-wrapper .dj-kpi { min-height: 64px; padding: 0.5rem 0.55rem; }
                #dj-container, #dj-wrapper .dj-kpi-value { font-size: 0.88rem; }
                #dj-container, #dj-wrapper .dj-kpi-label { font-size: 0.64rem; }
                #dj-container, #dj-wrapper .dj-kpi-sub   { font-size: 0.58rem; }
            }

            @media print {
                #dj-container, #dj-wrapper .app-module-toolbar-card,
                #dj-container, #dj-wrapper .dj-kpi-grid,
                #dj-container, #dj-wrapper .dj-close-btn,
                #dj-container, #dj-wrapper .dj-detail-btn,
                #dj-modal-bg,
                .custom-navbar,
                .sidebar,
                .sidebar-overlay { display: none !important; }
                #dj-container, #dj-wrapper .app-module-surface,
                #dj-container, #dj-wrapper .dj-table-wrap { box-shadow: none; border: 0; }
                #dj-container, #dj-wrapper .dj-table { min-width: 100%; font-size: 11px; }
                #dj-container, #dj-wrapper .dj-table th, #dj-container, #dj-wrapper .dj-table td { padding: 7px 6px; }
            }

            [data-theme="dark"] #dj-container, #dj-wrapper .dj-kpi {
                background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
                border-color: #334155;
                box-shadow: none;
            }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-kpi-label { color: #94a3b8; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-kpi-value { color: #f8fafc; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-kpi-sub   { color: #cbd5e1; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-table th { background-color: #2d3748 !important; color: #a0aec0; border-bottom-color: #4a5568; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-table td { color: #e2e8f0; border-bottom-color: #4a5568; }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-row-a:hover { background-color: rgba(99,179,237,0.08); }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-row-b { background: rgba(249,115,22,.10); }
            [data-theme="dark"] #dj-container, #dj-wrapper .dj-row-b:hover { background: rgba(249,115,22,.16); }
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

            const toolbar = `
                <div class="dj-toolbar-grid">
                    <div>
                        <label class="form-label fw-bold mb-2">التاريخ</label>
                        <input type="date" id="dj-date" class="form-control" value="${this.state.date}">
                    </div>
                    <div>
                        <label class="form-label fw-bold mb-2">القسم</label>
                        <select id="dj-dept" class="form-select">
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
                        <button class="btn btn-primary w-100" onclick="DailyJournal.load()">
                            <i class="bi bi-funnel ms-1"></i> تطبيق الفلاتر
                        </button>
                        <div class="dj-legend">
                            <span class="dj-chip">سندات A</span>
                            <span class="dj-chip dj-chip-b">سندات B / C</span>
                            <span class="dj-chip dj-chip-shift">فترات مفتوحة</span>
                            <span class="dj-chip dj-chip-closed">فترات مقفلة</span>
                        </div>
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

    async load() {
        this.state.date = document.getElementById('dj-date')?.value || this.getTodayIso();
        this.state.departmentId = parseInt(document.getElementById('dj-dept')?.value || '0', 10);

        const container = document.getElementById('dj-container');
        if (!container) return;
        container.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>`;

        try {
            const params = new URLSearchParams({ date: this.state.date });
            if (this.state.departmentId > 0) params.append('department_id', String(this.state.departmentId));

            const res = await Core.apiCall('accounting/daily_journal?' + params.toString(), 'GET');
            if (!res || !res.success) {
                container.innerHTML = `<div class="dj-empty">⚠️ تعذر جلب بيانات اليومية.</div>`;
                return;
            }

            this.state.data = res.data || { invoices: [], shift_totals: [], closures: [] };
            this.render();
        } catch (error) {
            console.error('daily_journal load error:', error);
            container.innerHTML = `<div class="dj-empty">⚠️ حدث خطأ أثناء تحميل اليومية.</div>`;
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
            <div class="dj-table-wrap">
                <table class="dj-table">
                    <thead>
                        <tr>
                            <th style="width: 60px;">#</th>
                            <th>اسم المريض</th>
                            <th style="width: 120px;">رقم السند</th>
                            <th style="width: 140px;">القسم</th>
                            <th style="width: 170px;">نوع السند</th>
                            <th style="width: 140px;">المبلغ</th>
                            <th style="width: 110px;">الوقت</th>
                            <th style="width: 120px;">التفاصيل</th>
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

        for (const c of closures) {
            const lbl = c.shift_type === 'morning' ? 'الصباحية' : 'المسائية';
            html += `
                <tr class="dj-row-closed">
                    <td colspan="8">
                        ✅ تم إقفال الفترة ${lbl}: تذاكر من [${c.start_ticket_no}] إلى [${c.end_ticket_no}]
                        | الإجمالي: ${this.fmtMoney(c.total_amount)}
                        | حصة المركز: ${this.fmtMoney(c.center_share)}
                        | حصة الوزارة: ${this.fmtMoney(c.ministry_share)}
                        | سند التحصيل رقم: ${c.closing_serial ?? '—'}
                        | بواسطة: ${this.escape(c.closed_by_name ?? '—')}
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

        html += `</tbody></table></div>`;
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
                <td><strong>${inv.serial_number}</strong> <small class="text-muted">(${inv.doc_name})</small></td>
                <td><span class="dj-badge dj-badge-dept">${this.escape(inv.department_name || '—')}</span></td>
                <td><span class="dj-badge ${docClass}">${this.escape(inv.type_label)}</span></td>
                <td><strong>${this.fmtMoney(inv.amount)}</strong></td>
                <td>${this.escape(inv.time || '')}</td>
                <td>
                    <button class="dj-detail-btn" onclick="DailyJournal.showDetails(${inv.invoice_id}, decodeURIComponent('${safePatient}'))">
                        <i class="bi bi-eye"></i> عرض
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
