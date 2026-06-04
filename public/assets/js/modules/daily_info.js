/**
 * daily_info_module.js
 * واجهة تقرير المعلومية اليومية
 * مركز طوارئ الطرق - نظام إدارة المركز
 *
 * إعادة بناء كاملة للهيكل بحيث يطابق النموذج الورقي الأصلي:
 *  - العمود الأيمن: تصنيف رئيسي + بيان تفصيلي + فترة (ص / م / ج)
 *  - أعمدة الخدمات الوسطى
 *  - عمود الإجمالي
 *  - العمود الأيسر: رقم المطبوعات (من / إلى) + عددها + نوع المطبوعات (rowspan رأسي)
 *  - تجاوب (overflow-x:auto)، ألوان هادئة للمتصفح، ألوان النموذج الورقي للطباعة فقط
 *  - تحكم في @page (A4 landscape) وإخفاء/إظهار الترويسة عبر media queries
 */

const DailyInfo = {
    state: {
        reportDate: null,
        data: null,
    },

    getLocalIsoDate() {
        const now = new Date();
        const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
        return local.toISOString().split('T')[0];
    },

    injectStylesOnce() {
        if (document.getElementById('di-styles')) return;
        const style = document.createElement('style');
        style.id = 'di-styles';
        style.textContent = `
            #di-wrapper { direction: rtl; }
            #di-wrapper .app-module-surface-body { padding: 0; }
            #di-wrapper .di-toolbar-grid {
                display: grid;
                grid-template-columns: minmax(180px, 220px) 1fr;
                gap: 14px;
                align-items: end;
            }
            #di-wrapper .di-toolbar-note {
                background: #eff6ff;
                border: 1px solid #bfdbfe;
                color: #1d4ed8;
                border-radius: 16px;
                padding: 12px 14px;
                font-size: 13px;
                font-weight: 700;
                line-height: 1.8;
            }
            #di-wrapper .di-toolbar-note i { margin-left: 6px; }
            #di-wrapper .di-surface-stack { display: flex; flex-direction: column; gap: 16px; padding: 18px; }
            #di-wrapper .di-report-frame {
                background: #fff;
                border: 1px solid #e2e8f0;
                border-radius: 22px;
                overflow: hidden;
            }
            #di-wrapper .di-report-header {
                padding: 14px 18px;
                border-bottom: 1px solid #e2e8f0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
                background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
            }
            #di-wrapper .di-report-title { font-size: 15px; font-weight: 800; color: #0f172a; }
            #di-wrapper .di-report-subtitle { font-size: 12px; color: #64748b; }
            #di-wrapper .di-report-chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 7px 12px;
                border-radius: 999px;
                background: #f8fafc;
                color: #334155;
                font-size: 12px;
                font-weight: 700;
                border: 1px solid #e2e8f0;
            }

            #di-printable { direction: rtl; color: #1f2937; background: #fff; }
            #di-printable .di-scroll {
                overflow-x: auto;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                max-width: 100%;
                border-radius: 14px;
            }
            #di-printable .di-table {
                width: 100%;
                min-width: 1180px;
                border-collapse: collapse;
                font-size: 12px;
                table-layout: fixed;
            }
            #di-printable .di-table th,
            #di-printable .di-table td {
                border: 1px solid #4b5563;
                text-align: center;
                vertical-align: middle;
                padding: 10px 8px;
                word-wrap: break-word;
                white-space: normal;
            }
            #di-printable .di-table thead th {
                position: sticky;
                top: 0;
                z-index: 2;
            }
            #di-printable .di-table th { font-weight: 700; }
            #di-printable .di-cat { font-weight: 800; }
            #di-printable .di-bayan { text-align: right; padding-right: 10px; }
            #di-printable .di-period { font-weight: 700; width: 40px; }
            #di-printable .di-th-cat { min-width: 110px; }
            #di-printable .di-th-bayan { min-width: 220px; }
            #di-printable .di-th-period { min-width: 50px; }
            #di-printable .di-th-svc { min-width: 56px; width: 56px; }
            #di-printable .di-th-total { min-width: 95px; }
            #di-printable .di-th-serial { min-width: 70px; }
            #di-printable .di-th-count { min-width: 60px; }
            #di-printable .di-th-doc { min-width: 130px; }

            /* تدوير نصوص رؤوس الأقسام/الخدمات 90 درجة لعرض أنيق */
            #di-printable .di-th-svc .di-th-rotate {
                display: inline-block;
                writing-mode: vertical-rl;
                transform: rotate(180deg);
                white-space: nowrap;
                line-height: 1.2;
                padding: 4px 2px;
                font-weight: 700;
                min-height: 90px;
            }
            #di-printable .di-th-svc { height: 120px; vertical-align: middle; padding: 6px 2px; }

            @media screen {
                #di-wrapper .report-header { display: none !important; }
                #di-printable .di-table th,
                #di-printable .di-table td { padding: 12px 10px; }
                #di-printable .bg-cat { background: #eef2ff; }
                #di-printable .bg-header { background: #e5e7eb; }
                #di-printable .bg-svc-hdr { background: #f3f4f6; }
                #di-printable .bg-subtotal { background: #fef9c3; }
                #di-printable .bg-exempt { background: #dcfce7; }
                #di-printable .bg-grand { background: #fce7f3; }
                #di-printable .bg-grand2 { background: #ede9fe; }
                #di-printable .bg-row { background: #ffffff; }
            }

            @media print {
                #di-wrapper .report-header { display: block !important; }
                #di-wrapper .app-module-toolbar-card,
                #di-wrapper .di-report-header,
                .custom-navbar,
                .sidebar,
                .sidebar-overlay { display: none !important; }
                #di-wrapper .app-module-surface,
                #di-wrapper .di-report-frame { box-shadow: none; border: 0; }
                #di-wrapper .di-surface-stack { padding: 0; }
                #di-printable .di-table { min-width: 100%; font-size: 10px; }
                #di-printable .di-table th,
                #di-printable .di-table td { padding: 4px 5px; font-size: 10.5px; }
                #di-printable .di-th-svc { height: auto; }
                #di-printable .di-th-svc .di-th-rotate { writing-mode: horizontal-tb; transform: none; min-height: 0; padding: 0; }
                #di-printable .bg-cat { background: #f4b9c8 !important; }
                #di-printable .bg-header { background: #f4b9c8 !important; }
                #di-printable .bg-svc-hdr { background: #f7e59d !important; }
                #di-printable .bg-subtotal { background: #fff4a8 !important; }
                #di-printable .bg-exempt { background: #d8f0d2 !important; }
                #di-printable .bg-grand { background: #f7c3d0 !important; }
                #di-printable .bg-grand2 { background: #ffffff !important; }
                #di-printable .bg-row { background: #ffffff !important; }
                body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
                #di-printable .di-scroll { overflow: visible !important; }
            }

            [data-theme="dark"] #di-wrapper .di-toolbar-note {
                background: rgba(59,130,246,.15);
                border-color: rgba(59,130,246,.25);
                color: #93c5fd;
            }
            [data-theme="dark"] #di-wrapper .di-report-frame,
            [data-theme="dark"] #di-printable,
            [data-theme="dark"] #di-wrapper .di-report-header {
                background: #1f2937;
                border-color: #334155;
                color: #e2e8f0;
            }
            [data-theme="dark"] #di-wrapper .di-report-title { color: #f8fafc; }
            [data-theme="dark"] #di-wrapper .di-report-subtitle { color: #94a3b8; }
            [data-theme="dark"] #di-wrapper .di-report-chip {
                background: #111827;
                border-color: #334155;
                color: #cbd5e1;
            }
            [data-theme="dark"] #di-printable .di-table th,
            [data-theme="dark"] #di-printable .di-table td {
                border-color: #475569;
                color: #e2e8f0;
            }
            [data-theme="dark"] #di-printable .bg-cat { background: rgba(99,102,241,.18); }
            [data-theme="dark"] #di-printable .bg-header { background: rgba(148,163,184,.18); }
            [data-theme="dark"] #di-printable .bg-svc-hdr { background: rgba(100,116,139,.22); }
            [data-theme="dark"] #di-printable .bg-subtotal { background: rgba(245,158,11,.18); }
            [data-theme="dark"] #di-printable .bg-exempt { background: rgba(16,185,129,.18); }
            [data-theme="dark"] #di-printable .bg-grand { background: rgba(236,72,153,.18); }
            [data-theme="dark"] #di-printable .bg-grand2 { background: rgba(139,92,246,.18); }
            [data-theme="dark"] #di-printable .bg-row { background: #1f2937; }

            @media (max-width: 768px) {
                #di-wrapper .di-toolbar-grid { grid-template-columns: 1fr; }
                #di-wrapper .di-surface-stack { padding: 14px; }
                #di-wrapper .di-report-header { padding: 12px 14px; }
                #di-printable .di-table { font-size: 11px; }
                #di-printable .di-table th, #di-printable .di-table td { padding: 6px 4px; }
                #di-printable .di-th-svc { height: 100px; }
                #di-printable .di-th-svc .di-th-rotate { min-height: 75px; font-size: 11px; }
            }

            @page { size: A4 landscape; margin: 0.5cm; }
        `;
        document.head.appendChild(style);
    },

    async view() {
        this.injectStylesOnce();
        const today = this.getLocalIsoDate();
        this.state.reportDate = today;

        Core.navigateTo('openDailyInfo', () => {
            const main = document.getElementById('mainContent');
            if (!main) return;
            main.innerHTML = this.renderShell();
            this.bindDatePicker();
            this.loadReport(today);
        });
    },

    renderShell() {
        const today = this.getLocalIsoDate();
        const tools = [
            { label: 'تحديث', icon: 'bi-arrow-repeat', action: "DailyInfo.loadReport(document.getElementById('di-date-picker')?.value || DailyInfo.getLocalIsoDate())" },
            { label: 'طباعة', icon: 'bi-printer', action: 'DailyInfo.printReport()' },
        ];

        const toolbar = `
            <div class="di-toolbar-grid">
                <div>
                    <label class="form-label fw-bold mb-2">تاريخ التقرير</label>
                    <input type="date" id="di-date-picker" class="form-control" value="${today}">
                </div>
                <div class="di-toolbar-note">
                    <i class="bi bi-info-circle-fill"></i>
                    التقرير يعرض المعلومية اليومية داخل قالب موحّد مع إمكانية الطباعة بنفس النموذج الرسمي.
                </div>
            </div>
        `;

        return Core.renderModulePage({
            title: 'المعلومية اليومية',
            subtitle: 'تقرير يومي متجاوب ومتناسق مع القالب الثابت للنظام مع دعم عرض الشاشة والطباعة.',
            toolsActions: tools,
            toolbar,
            shellClass: 'di-shell',
            surfaceClass: 'di-surface',
            body: `
                <div class="di-surface-stack">
                    <div id="di-report-area" class="di-report-frame">
                        <div class="text-center py-5 text-muted">
                            <div class="spinner-border text-primary mb-3"></div>
                            <div>جاري تحميل البيانات...</div>
                        </div>
                    </div>
                </div>
            `,
        });
    },

    bindDatePicker() {
        const picker = document.getElementById('di-date-picker');
        if (!picker || picker.dataset.bound === '1') return;
        picker.dataset.bound = '1';
        picker.addEventListener('change', () => {
            this.loadReport(picker.value);
        });
    },

    async loadReport(date) {
        this.state.reportDate = date || this.getLocalIsoDate();
        const area = document.getElementById('di-report-area');
        if (!area) return;

        area.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';

        try {
            const res = await Core.apiCall(`reports/daily_info?date=${this.state.reportDate}`, 'GET');
            if (res && res.success) {
                this.state.data = res.data;
                this.renderReport(res.data);
                return;
            }

            const message = res?.message || 'تعذر تحميل بيانات المعلومية اليومية.';
            area.innerHTML = `<div class="p-4"><div class="alert alert-warning mb-0">${message}</div></div>`;
        } catch (e) {
            console.error('daily_info load error:', e);
            const message = e?.message || 'حدث خطأ أثناء تحميل تقرير المعلومية اليومية.';
            area.innerHTML = `<div class="p-4"><div class="alert alert-danger mb-0">${message}</div></div>`;
        }
    },

    renderReport(data) {
        const area = document.getElementById('di-report-area');
        if (!area) return;

        const header = data.header || {};
        const dateObj = new Date(`${data.report_date || this.getLocalIsoDate()}T12:00:00`);
        const dayName = dateObj.toLocaleDateString('ar-YE', { weekday: 'long' });
        const gregDate = dateObj.toLocaleDateString('ar-YE', { year: 'numeric', month: '2-digit', day: '2-digit' });

        let hijriDate = '';
        try {
            hijriDate = dateObj.toLocaleDateString('ar-SA-u-ca-islamic-umalqura', {
                year: 'numeric', month: '2-digit', day: '2-digit'
            });
        } catch (_) {
            hijriDate = '';
        }

        area.innerHTML = `
            <div class="di-report-header">
                <div>
                    <div class="di-report-title">نموذج المعلومية اليومية</div>
                    <div class="di-report-subtitle">عرض حي داخل النظام مع الحفاظ على تنسيق الطباعة الرسمي.</div>
                </div>
                <div class="d-flex flex-wrap gap-2">
                    <span class="di-report-chip"><i class="bi bi-calendar3"></i>${gregDate}</span>
                    <span class="di-report-chip"><i class="bi bi-brightness-alt-high"></i>${dayName}</span>
                    ${hijriDate ? `<span class="di-report-chip"><i class="bi bi-moon-stars"></i>${hijriDate} هـ</span>` : ''}
                </div>
            </div>
            <div class="p-3 p-md-4">
                <div id="di-printable">
                    <div class="report-header">
                        ${this.renderHeaderBlock(header, dayName, gregDate, hijriDate)}
                    </div>
                    <div class="di-scroll">
                        ${this.renderMainTable(data)}
                    </div>
                    <div style="margin-top:8px; font-size:11px; color:#6b7280; text-align:left;">
                        * لا يتم احتساب أي سند أو فاتورة ملغاة ضمن التقرير.
                    </div>
                </div>
            </div>
        `;
    },

    renderHeaderBlock(header, dayName, gregDate, hijriDate) {
        const country = header.header_country || 'الجمهورية اليمنية';
        const ministry = header.header_ministry || 'وزارة الصحة العامة والسكان';
        const office = header.header_office || '';
        const directorate = header.header_directorate || '';
        const center = header.header_center || 'مركز طوارئ الطرق';

        return `
        <div style="border:2px solid #4b5563; margin-bottom:12px;">
            <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
                <tr>
                    <td class="bg-header" style="border:1px solid #4b5563; width:22%; text-align:center; font-weight:700; font-size:20px; padding:14px 10px;">
                        ${center}
                    </td>
                    <td class="bg-header" style="border:1px solid #4b5563; width:56%; text-align:center; padding:8px 10px; line-height:1.7;">
                        <div style="font-weight:700; font-size:15px;">${country}</div>
                        <div style="font-weight:700; font-size:15px;">${ministry}</div>
                        ${office ? `<div style="font-weight:700; font-size:14px;">${office}</div>` : ''}
                        ${directorate ? `<div style="font-weight:700; font-size:14px;">${directorate}</div>` : ''}
                        <div style="font-weight:800; font-size:16px; margin-top:4px;">المعلومية اليومية بإجمالي إيرادات مشاركة المجتمع والمشتركة</div>
                    </td>
                    <td style="border:1px solid #4b5563; width:22%; padding:0; vertical-align:top;">
                        <table style="width:100%; border-collapse:collapse; height:100%;">
                            <tr>
                                <td style="border:1px solid #4b5563; width:38%; font-weight:700; text-align:center; padding:6px;">اليوم</td>
                                <td style="border:1px solid #4b5563; text-align:center; padding:6px; font-weight:700;">${dayName}</td>
                            </tr>
                            <tr>
                                <td style="border:1px solid #4b5563; font-weight:700; text-align:center; padding:6px;">التاريخ</td>
                                <td style="border:1px solid #4b5563; text-align:center; padding:6px; font-weight:700;">${hijriDate || '—'} هـ</td>
                            </tr>
                            <tr>
                                <td style="border:1px solid #4b5563; font-weight:700; text-align:center; padding:6px;">الموافق</td>
                                <td style="border:1px solid #4b5563; text-align:center; padding:6px; font-weight:700;">${gregDate} م</td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </div>`;
    },

    renderMainTable(data) {
        const cols = [
            { key: 'lab', label: 'مختبرات' },
            { key: 'amaliyat', label: 'عمليات' },
            { key: 'ruqood', label: 'رقود' },
            { key: 'mojara', label: 'مجارحة' },
            { key: 'ecg', label: 'تخطيط قلب' },
            { key: 'xray', label: 'أشعة' },
            { key: 'qararat', label: 'قرارات' },
            { key: 'tv_xray', label: 'أشعة تلفزيونية' },
            { key: 'asnan', label: 'أسنان' },
            { key: 'tickets', label: 'تذكر معاينة' },
            { key: 'other', label: 'أخرى' },
        ];

        const M = data.morning || {};
        const E = data.evening || {};
        const T = data.totals || {};
        const SR = data.serial_ranges || {};
        const TS = data.ticket_serials || {};

        const fmt = (value) => {
            const n = Number(value || 0);
            return n > 0 ? Math.round(n).toLocaleString('ar-YE') : '';
        };

        // بناء نطاقات تذاكر المعاينة لكل فترة + الإجمالي (من أول تذكرة إلى آخر تذكرة)
        const ticketMorningRange = TS.morning?.serial_from ? {
            from: TS.morning.serial_from, to: TS.morning.serial_to, count: TS.morning.count
        } : null;
        const ticketEveningRange = TS.evening?.serial_from ? {
            from: TS.evening.serial_from, to: TS.evening.serial_to, count: TS.evening.count
        } : null;
        const ticketSerialAll = this.mergeRanges(ticketMorningRange, ticketEveningRange);
        const ticketSerials = {
            morning: ticketMorningRange,
            evening: ticketEveningRange,
            total: ticketSerialAll,
        };

        const getSection = (shiftKey, sectionKey) => {
            if (shiftKey === 'morning') return M[sectionKey] || {};
            if (shiftKey === 'evening') return E[sectionKey] || {};
            return T[sectionKey] || {};
        };

        const buildBodyCells = (section) => cols.map((c) => `<td>${fmt(section[c.key])}</td>`).join('');

        // دالة مساعدة لتحويل بنية SR إلى أشكال لكل فترة
        const buildSerialPerShift = (sr) => {
            if (!sr) return { morning: null, evening: null, total: null };
            // البنية الجديدة: { morning, evening, total, from, to, count }
            if (sr.morning !== undefined || sr.evening !== undefined || sr.total !== undefined) {
                return {
                    morning: sr.morning || null,
                    evening: sr.evening || null,
                    total:   sr.total   || (sr.from != null ? { from: sr.from, to: sr.to, count: sr.count } : null),
                };
            }
            // توافق عكسي مع البنية القديمة
            return {
                morning: null,
                evening: null,
                total: (sr.from != null) ? { from: sr.from, to: sr.to, count: sr.count } : null,
            };
        };

        const categories = [
            {
                catLabel: 'المترددين على الخدمات',
                sectionKey: 'visitors',
                bayan: 'عدد المترددين بسند تحصيل وتذاكر معاينة',
                bayanTotal: 'إجمالي عدد المترددين بسند تحصيل وتذاكر معاينة',
                docLabel: 'تذاكر معاينة',
                serial: ticketSerials,
                subtotalClass: 'bg-subtotal',
            },
            {
                catLabel: 'مشاركة المجتمع',
                sectionKey: 'center',
                bayan: 'إيرادات مشاركة المجتمع',
                bayanTotal: 'إجمالي إيرادات مشاركة المجتمع',
                docLabel: 'اسناد تحصيل مشاركة مجتمع',
                serial: buildSerialPerShift(SR.A),
                subtotalClass: 'bg-subtotal',
            },
            {
                catLabel: 'المشتركة',
                sectionKey: 'ministry',
                bayan: 'إيرادات مشتركة',
                bayanTotal: 'إجمالي الإيرادات المشتركة',
                docLabel: 'قسائم تحصيل موارد مشتركة',
                serial: { morning: null, evening: null, total: null },
                subtotalClass: 'bg-subtotal',
            },
            {
                catLabel: 'الإعفاء',
                sectionKey: 'exempt',
                bayan: 'الإعفاء',
                bayanTotal: 'إجمالي الإعفاءات',
                docLabel: 'سندات الإعفاء',
                serial: buildSerialPerShift(SR.EXEMPT || SR.C),
                subtotalClass: 'bg-exempt',
            },
        ];

        // دالة مساعدة للحصول على نطاق تسلسلي حسب الفترة
        const pickSerial = (serialObj, shift) => {
            if (!serialObj) return { from: '', to: '', count: '' };
            const r = serialObj[shift] || null;
            if (!r || r.from == null) return { from: '', to: '', count: '' };
            return {
                from: r.from != null ? r.from : '',
                to:   r.to   != null ? r.to   : '',
                count: r.count ? fmt(r.count) : '',
            };
        };

        const buildCategoryRows = (cat) => {
            const morningSec = getSection('morning', cat.sectionKey);
            const eveningSec = getSection('evening', cat.sectionKey);
            const totalSec = getSection('total', cat.sectionKey);

            // نطاقات المستندات لكل فترة + الإجمالي
            const sMorning = pickSerial(cat.serial, 'morning');
            const sEvening = pickSerial(cat.serial, 'evening');
            const sTotal   = pickSerial(cat.serial, 'total');

            const mTotal = Number(morningSec.total || 0);
            const eTotal = Number(eveningSec.total || 0);
            const tTotal = Number(totalSec.total || 0);

            const row1 = `
                <tr class="bg-row">
                    <td class="di-cat bg-cat" rowspan="3">${cat.catLabel}</td>
                    <td class="di-bayan">${cat.bayan}</td>
                    <td class="di-period">ص</td>
                    ${buildBodyCells(morningSec)}
                    <td><strong>${fmt(mTotal)}</strong></td>
                    <td>${sMorning.from}</td>
                    <td>${sMorning.to}</td>
                    <td><strong>${sMorning.count}</strong></td>
                    <td rowspan="3" class="di-cat">${cat.docLabel}</td>
                </tr>`;

            const row2 = `
                <tr class="bg-row">
                    <td class="di-bayan">${cat.bayan}</td>
                    <td class="di-period">م</td>
                    ${buildBodyCells(eveningSec)}
                    <td><strong>${fmt(eTotal)}</strong></td>
                    <td>${sEvening.from}</td>
                    <td>${sEvening.to}</td>
                    <td><strong>${sEvening.count}</strong></td>
                </tr>`;

            const row3 = `
                <tr class="${cat.subtotalClass}" style="font-weight:700;">
                    <td class="di-bayan">${cat.bayanTotal}</td>
                    <td class="di-period">ج</td>
                    ${buildBodyCells(totalSec)}
                    <td><strong>${fmt(tTotal)}</strong></td>
                    <td>${sTotal.from}</td>
                    <td>${sTotal.to}</td>
                    <td><strong>${sTotal.count}</strong></td>
                </tr>`;

            return row1 + row2 + row3;
        };

        // ✨ الحسابات الإجمالية:
        //   - إجمالي الإيرادات مشاركة والمشتركة = (مشاركة المجتمع/center) + (المشتركة/ministry)
        //   - إجمالي الإيرادات المحصلة والإعفاء = مشاركة والمشتركة + الإعفاءات
        //     ⇒ أي (center + ministry + exempt) — وليس (center + exempt) فقط كما كان
        const sumSections = (...keys) => {
            const result = {};
            const allKeys = new Set();
            keys.forEach((k) => Object.keys(T[k] || {}).forEach((kk) => allKeys.add(kk)));
            allKeys.forEach((k) => {
                result[k] = keys.reduce((acc, sec) => acc + Number((T[sec] || {})[k] || 0), 0);
            });
            return result;
        };

        const participationAndJoint = sumSections('center', 'ministry');
        const collectedAndExempt    = sumSections('center', 'ministry', 'exempt');

        // 🆕 (مشكلة #4) استمارات الفحوصات تظهر الآن بصفوف منفصلة لكل فترة (ص/م/ج)
        const labSerial = buildSerialPerShift(SR.L);
        const lMorning  = pickSerial(labSerial, 'morning');
        const lEvening  = pickSerial(labSerial, 'evening');
        const lTotal    = pickSerial(labSerial, 'total');

        // عدد الأعمدة الوسطى = العمود الأيمن (نوع الإيرادات) + البيان + الفترة + خدمات + الإجمالي
        // العمود الأيمن سندمجه هنا (نوع الإيرادات) في rowspan=3 على صفوف استمارات الفحوصات.


        
        // الصفوف الإجمالية النهائية (بـ (ج) فقط — كما طلب المستخدم)
        const grandRow1 = `
            <tr class="bg-grand" style="font-weight:800;">
                <td class="di-cat bg-grand" colspan="2" style="text-align:right; padding-right:10px;">إجمالي الإيرادات مشاركة والمشتركة</td>
                <td class="di-period">ج</td>
                ${cols.map((c) => `<td>${fmt(participationAndJoint[c.key])}</td>`).join('')}
                <td><strong>${fmt(participationAndJoint.total)}</strong></td>
                <td>${lMorning.from}</td>
                <td>${lMorning.to}</td>
               <td><strong>${lMorning.count}</strong></td>
                <td rowspan="3">استمارات الفحوصات</td>
            </tr>`;

        const grandRow2 = `
            <tr class="bg-grand2" style="font-weight:800;">
                <td class="di-cat bg-grand2" colspan="2" style="text-align:right; padding-right:10px;">إجمالي الإيرادات المحصلة والإعفاء</td>
                <td class="di-period">ج</td>
                ${cols.map((c) => `<td>${fmt(collectedAndExempt[c.key])}</td>`).join('')}
                <td><strong>${fmt(collectedAndExempt.total)}</strong></td>
                <td>${lEvening.from}</td>
                <td>${lEvening.to}</td>
                <td><strong>${lEvening.count}</strong></td>
                
            </tr>`;
        const spacerRow = `
            <tr class="bg-row di-spacer" aria-hidden="true">
                <td colspan="${cols.length + 5}" style="height:10px; border-left:0; border-right:0;">&nbsp;</td>
                <td>${lTotal.from}</td>
                <td>${lTotal.to}</td>
                <td><strong>${lTotal.count}</strong></td>
            </tr>`;
        

        const headerCols = cols.map((c) => `<th class="bg-svc-hdr di-th-svc">${c.label}</th>`).join('');

        return `
            <table class="di-table">
                <colgroup>
                    <col style="width:9%;">
                    <col style="width:16%;">
                    <col style="width:3%;">
                    ${cols.map(() => '<col style="width:5%;">').join('')}
                    <col style="width:6%;">
                    <col style="width:5%;">
                    <col style="width:5%;">
                    <col style="width:4%;">
                    <col style="width:10%;">
                </colgroup>
                <thead>
                    <tr>
                        <th class="bg-header di-th-cat" rowspan="2">نوع الإيرادات</th>
                        <th class="bg-header di-th-bayan" rowspan="2">البيان</th>
                        <th class="bg-header di-th-period" rowspan="2">الفترة</th>
                        <th class="bg-header" colspan="${cols.length}">الخدمات والأقسام</th>
                        <th class="bg-header di-th-total" rowspan="2">الإجمالي</th>
                        <th class="bg-header" colspan="2">رقم المطبوعات</th>
                        <th class="bg-header di-th-count" rowspan="2">عددها</th>
                        <th class="bg-header di-th-doc" rowspan="2">نوع المطبوعات</th>
                    </tr>
                    <tr>
                        ${headerCols}
                        <th class="bg-svc-hdr di-th-serial">من</th>
                        <th class="bg-svc-hdr di-th-serial">إلى</th>
                    </tr>
                </thead>
                <tbody>
                    ${categories.map(buildCategoryRows).join('')}
                    ${grandRow1}
                    ${grandRow2}
                    ${spacerRow}
                </tbody>
            </table>`;
    },

    mergeRanges(...ranges) {
        const valid = ranges.filter((r) => r && r.from != null && r.to != null);
        if (!valid.length) return null;
        return {
            from: Math.min(...valid.map((r) => Number(r.from))),
            to: Math.max(...valid.map((r) => Number(r.to))),
            count: valid.reduce((sum, r) => sum + (Number(r.count) || 0), 0),
        };
    },

    printReport() {
        const printable = document.getElementById('di-printable');
        if (!printable) {
            alert('لا يوجد تقرير للطباعة.');
            return;
        }

        const win = window.open('', '_blank', 'width=1400,height=900');
        win.document.write(`
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <meta charset="UTF-8">
                <title>المعلومية اليومية</title>
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;600;700;800&display=swap" rel="stylesheet">
                <style>
                    * { box-sizing: border-box; }
                    body { font-family: 'Noto Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; color:#111; margin:0; padding:6mm; }
                    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                    th, td { border: 1px solid #333; padding: 4px 5px; text-align:center; vertical-align: middle; font-size: 10.5px; word-wrap: break-word; }
                    .di-bayan { text-align: right; padding-right: 8px; }
                    .di-cat { font-weight: 800; }
                    .di-th-rotate { display: inline-block; font-weight: 700; }
                    .report-header { display: block; }
                    .bg-cat, .bg-header { background: #f4b9c8 !important; }
                    .bg-svc-hdr { background: #f7e59d !important; }
                    .bg-subtotal { background: #fff4a8 !important; }
                    .bg-exempt { background: #d8f0d2 !important; }
                    .bg-grand { background: #f7c3d0 !important; }
                    .bg-grand2 { background: #ffffff !important; }
                    .bg-row { background: #ffffff !important; }
                    @page { size: A4 landscape; margin: 0.5cm; }
                    @media print {
                        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body dir="rtl">${printable.innerHTML}</body>
            </html>
        `);
        win.document.close();
        win.focus();
        setTimeout(() => {
            win.print();
            win.close();
        }, 300);
    },
};

window.DailyInfo = DailyInfo;
