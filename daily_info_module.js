/**
 * daily_info_module.js
 * واجهة تقرير المعلومية اليومية
 * مركز طوارئ الطرق - نظام إدارة المركز
 */

const DailyInfo = {

    state: {
        reportDate: null,
        data: null,
        header: null,
    },

    // ========== الدخول الرئيسي ==========
    async view() {
        const today = new Date().toISOString().split('T')[0];
        this.state.reportDate = today;

        Core.navigateTo('daily_info', () => {
            document.getElementById('mainContent').innerHTML = this.renderShell();
        });

        this.bindDatePicker();
        await this.loadReport(today);
    },

    // ========== هيكل الصفحة ==========
    renderShell() {
        const today = new Date().toISOString().split('T')[0];
        return `
        <div id="di-container" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif; direction:rtl; padding:16px;">

            <!-- شريط الأدوات -->
            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                <h5 class="mb-0 fw-bold text-primary">
                    <i class="bi bi-newspaper ms-2"></i>المعلومية اليومية
                </h5>
                <div class="d-flex align-items-center gap-2 me-auto">
                    <input type="date" id="di-date-picker" class="form-control form-control-sm"
                           value="${today}" style="width:160px;">
                    <button class="btn btn-primary btn-sm" onclick="DailyInfo.loadReport(document.getElementById('di-date-picker').value)">
                        <i class="bi bi-arrow-clockwise ms-1"></i>تحديث
                    </button>
                    <button class="btn btn-success btn-sm" onclick="DailyInfo.printReport()">
                        <i class="bi bi-printer ms-1"></i>طباعة
                    </button>
                </div>
            </div>

            <!-- منطقة التقرير -->
            <div id="di-report-area">
                <div class="text-center py-5 text-muted">
                    <div class="spinner-border text-primary mb-3"></div>
                    <div>جاري تحميل البيانات...</div>
                </div>
            </div>
        </div>`;
    },

    bindDatePicker() {
        setTimeout(() => {
            const picker = document.getElementById('di-date-picker');
            if (picker) {
                picker.addEventListener('change', () => {
                    this.loadReport(picker.value);
                });
            }
        }, 200);
    },

    // ========== تحميل البيانات ==========
    async loadReport(date) {
        this.state.reportDate = date;
        const area = document.getElementById('di-report-area');
        if (area) area.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';

        try {
            const res = await Core.apiCall(`reports/daily_info?date=${date}`, 'GET');
            if (res && res.success) {
                this.state.data = res.data;
                this.renderReport(res.data);
            } else {
                if (area) area.innerHTML = `<div class="alert alert-warning">لا توجد بيانات لهذا التاريخ.</div>`;
            }
        } catch (e) {
            if (area) area.innerHTML = `<div class="alert alert-danger">حدث خطأ أثناء التحميل.</div>`;
        }
    },

    // ========== رسم التقرير ==========
    renderReport(data) {
        const area = document.getElementById('di-report-area');
        if (!area) return;

        const header = data.header || {};
        const dateObj = new Date(data.report_date + 'T12:00:00');

        // اليوم والتاريخ
        const dayName = dateObj.toLocaleDateString('ar-YE', { weekday: 'long' });
        const gregDate = dateObj.toLocaleDateString('ar-YE', { year: 'numeric', month: '2-digit', day: '2-digit' });
        let hijriDate = '';
        try {
            hijriDate = dateObj.toLocaleDateString('ar-SA-u-ca-islamic-umalqura', {
                year: 'numeric', month: '2-digit', day: '2-digit'
            });
        } catch(e) { hijriDate = ''; }

        const html = `
        <div id="di-printable" style="direction:rtl; font-size:12px;">

            <!-- ترويسة التقرير -->
            <div style="border:2px solid #333; border-bottom:none;">
                <table style="width:100%; border-collapse:collapse;">
                    <tr>
                        <td style="border:1px solid #999; padding:6px 10px; text-align:center; font-weight:bold; font-size:14px; background:#fff3cd; width:20%;">
                            ${header['header_center'] || 'مركز طوارئ الطرق'}
                        </td>
                        <td style="border:1px solid #999; padding:6px 10px; text-align:center; font-weight:bold; font-size:13px; width:60%;">
                            ${header['header_ministry'] || 'وزارة الصحة العامة والسكان'}<br>
                            <span style="font-size:14px; color:#c00;">المعلومية اليومية بإجمالي إيرادات مشاركة المجتمع والمشتركة</span><br>
                            ${header['header_office'] || ''}
                        </td>
                        <td style="border:1px solid #999; padding:6px 10px; text-align:center; width:20%;">
                            <div style="font-size:11px;">
                                <strong>التاريخ:</strong> ${hijriDate} هـ<br>
                                <strong>الموافق:</strong> ${gregDate} م<br>
                                <strong>اليوم:</strong> ${dayName}
                            </div>
                        </td>
                    </tr>
                </table>
            </div>

            <!-- جدول التقرير الرئيسي -->
            <div style="overflow-x:auto;">
                ${this.renderMainTable(data)}
            </div>
        </div>`;

        area.innerHTML = html;
    },

    // ========== الجدول الرئيسي ==========
    renderMainTable(data) {
        const cols = [
            { key: 'mojara',   label: 'مجارحة' },
            { key: 'ruqood',   label: 'رقود' },
            { key: 'amaliyat', label: 'عمليات' },
            { key: 'lab',      label: 'مختبرات' },
            { key: 'ecg',      label: 'تخطيط قلب' },
            { key: 'xray',     label: 'أشعة' },
            { key: 'qararat',  label: 'قرارات' },
            { key: 'tv_xray',  label: 'أشعة تليفزيونية' },
            { key: 'asnan',    label: 'أسنان' },
            { key: 'tickets',  label: 'تذاكر معاينة' },
            { key: 'other',    label: 'أخرى' },
        ];

        const M = data.morning;
        const E = data.evening;
        const T = data.totals;
        const SR = data.serial_ranges || {};
        const TS = data.ticket_serials || {};

        const fmtNum = (v) => v ? (+v).toLocaleString('ar-YE') : '—';
        const fmtAmt = (v) => v ? (+v).toFixed(0) : '—';

        // دالة لبناء صف
        const buildRow = (label, period, sectionKey, shift, bgColor, bold = false) => {
            const d = shift === 'total' ? T : (shift === 'morning' ? M : E);
            const sec = d[sectionKey] || {};
            const isCount = sectionKey === 'visitors';
            const fmt = isCount ? fmtNum : fmtAmt;

            let cells = cols.map(c => {
                const val = sec[c.key] || 0;
                return `<td style="border:1px solid #999; padding:3px 5px; text-align:center; ${bgColor}">${val > 0 ? fmt(val) : ''}</td>`;
            }).join('');

            const totalVal = sec['total'] || 0;

            return `<tr style="${bold ? 'font-weight:bold;' : ''}">
                <td style="border:1px solid #999; padding:3px 5px; text-align:right; ${bgColor}">${label}</td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; ${bgColor}">${period}</td>
                ${cells}
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; font-weight:bold; ${bgColor}">${totalVal > 0 ? fmt(totalVal) : ''}</td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; font-size:10px; ${bgColor}"></td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; ${bgColor}"></td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; font-size:10px; ${bgColor}"></td>
            </tr>`;
        };

        // دالة صف إجمالي مع الأرقام التسلسلية
        const buildTotalRow = (label, period, sectionKey, shift, bgColor, serialRange, serialLabel) => {
            const d = shift === 'total' ? T : (shift === 'morning' ? M : E);
            const sec = d ? (d[sectionKey] || {}) : {};
            const isCount = sectionKey === 'visitors';
            const fmt = isCount ? fmtNum : fmtAmt;

            let cells = cols.map(c => {
                const val = sec[c.key] || 0;
                return `<td style="border:1px solid #999; padding:3px 5px; text-align:center; ${bgColor}">${val > 0 ? fmt(val) : ''}</td>`;
            }).join('');

            const totalVal = sec['total'] || 0;
            const srFrom = serialRange ? serialRange.from : '';
            const srTo   = serialRange ? serialRange.to   : '';
            const srCnt  = serialRange ? serialRange.count : '';

            return `<tr style="font-weight:bold;">
                <td style="border:1px solid #999; padding:3px 5px; text-align:right; ${bgColor}">${label}</td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; ${bgColor}">${period}</td>
                ${cells}
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; font-weight:bold; ${bgColor}">${totalVal > 0 ? fmt(totalVal) : ''}</td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; font-size:10px; ${bgColor}">${srFrom ? srFrom + ' / ' + srTo : ''}</td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; ${bgColor}">${srCnt || ''}</td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; font-size:10px; ${bgColor}">${serialLabel || ''}</td>
            </tr>`;
        };

        // حساب الإجماليات النهائية
        const calcGrandTotal = (sec1, sec2) => {
            const r = {};
            const keys = Object.keys(T[sec1] || {});
            keys.forEach(k => {
                r[k] = (T[sec1][k] || 0) + (T[sec2][k] || 0);
            });
            return r;
        };

        const participationAndJoint = calcGrandTotal('center', 'ministry');
        const collectedAndExempt    = calcGrandTotal('center', 'exempt');

        const buildGrandRow = (label, bgColor, dataObj, serialRange, serialLabel) => {
            const fmt = (v) => v ? (+v).toFixed(0) : '';
            let cells = cols.map(c => {
                const val = dataObj[c.key] || 0;
                return `<td style="border:1px solid #999; padding:3px 5px; text-align:center; ${bgColor}">${val > 0 ? fmt(val) : ''}</td>`;
            }).join('');
            const totalVal = dataObj['total'] || 0;
            const srFrom = serialRange ? serialRange.from : '';
            const srTo   = serialRange ? serialRange.to   : '';
            const srCnt  = serialRange ? serialRange.count : '';

            return `<tr style="font-weight:bold;">
                <td colspan="2" style="border:1px solid #999; padding:3px 8px; text-align:right; ${bgColor}">${label}</td>
                ${cells}
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; ${bgColor}">${totalVal > 0 ? fmt(totalVal) : ''}</td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; font-size:10px; ${bgColor}">${srFrom ? srFrom + ' / ' + srTo : ''}</td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; ${bgColor}">${srCnt || ''}</td>
                <td style="border:1px solid #999; padding:3px 5px; text-align:center; font-size:10px; ${bgColor}">${serialLabel || ''}</td>
            </tr>`;
        };

        // الأرقام التسلسلية للتذاكر
        const ticketSerialAll = {
            from: Math.min(TS.morning?.serial_from || 9999, TS.evening?.serial_from || 9999),
            to:   Math.max(TS.morning?.serial_to   || 0,    TS.evening?.serial_to   || 0),
            count:(TS.morning?.count || 0) + (TS.evening?.count || 0),
        };
        if (ticketSerialAll.from === 9999) ticketSerialAll.from = null;

        const thStyle = 'border:1px solid #666; padding:4px 6px; text-align:center; background:#343a40; color:white; font-size:11px;';
        const headerCols = cols.map(c => `<th style="${thStyle}">${c.label}</th>`).join('');

        return `
        <table style="width:100%; border-collapse:collapse; font-size:11px; direction:rtl; margin-top:0;">
            <thead>
                <tr>
                    <th style="${thStyle}">نوع الإيرادات</th>
                    <th style="${thStyle}">الفترة</th>
                    ${headerCols}
                    <th style="${thStyle}">الإجمالي</th>
                    <th style="${thStyle}">رقم المطبوعات<br>(من / إلى)</th>
                    <th style="${thStyle}">عددها</th>
                    <th style="${thStyle}">نوع المطبوعات</th>
                </tr>
            </thead>
            <tbody>

                <!-- ===== القسم 1: المترددين على الخدمات ===== -->
                ${buildRow('عدد المترددين بسند تحصيل وتذاكر معاينة', 'ص', 'visitors', 'morning', 'background:#fff8;', false)}
                ${buildRow('عدد المترددين بسند تحصيل وتذاكر معاينة', 'م', 'visitors', 'evening', 'background:#fff8;', false)}
                ${buildTotalRow('إجمالي عدد المترددين بسند تحصيل وتذاكر معاينة', 'ج', 'visitors', 'total', 'background:#fffacd;', ticketSerialAll.from ? ticketSerialAll : null, 'تذاكر معاينة')}

                <!-- ===== القسم 2: مشاركة المجتمع ===== -->
                ${buildRow('إيرادات مشاركة المجتمع', 'ص', 'center', 'morning', 'background:#fff8;', false)}
                ${buildRow('إيرادات مشاركة المجتمع', 'م', 'center', 'evening', 'background:#fff8;', false)}
                ${buildTotalRow('إجمالي إيرادات مشاركة المجتمع', 'ج', 'center', 'total', 'background:#fffacd;', SR['A'], 'أ - سند تحصيل')}

                <!-- ===== القسم 3: الإيرادات المشتركة ===== -->
                ${buildRow('إيرادات مشتركة', 'ص', 'ministry', 'morning', 'background:#fff8;', false)}
                ${buildRow('إيرادات مشتركة', 'م', 'ministry', 'evening', 'background:#fff8;', false)}
                ${buildTotalRow('إجمالي الإيرادات المشتركة', 'ج', 'ministry', 'total', 'background:#fffacd;', SR['B'], 'ب - سند مشترك')}

                <!-- ===== القسم 4: الإعفاءات ===== -->
                ${buildRow('الإعفاء', 'ص', 'exempt', 'morning', 'background:#fff8;', false)}
                ${buildRow('الإعفاء', 'م', 'exempt', 'evening', 'background:#fff8;', false)}
                ${buildTotalRow('إجمالي الإعفاءات', 'ج', 'exempt', 'total', 'background:#d4edda;', SR['C'], 'ج - سند إعفاء')}

                <!-- ===== إجمالي المشاركة والمشتركة ===== -->
                ${buildGrandRow('إجمالي الإيرادات مشاركة والمشتركة', 'background:#f8d7da;', participationAndJoint, SR['L'], 'ل - مستند مختبر')}

                <!-- ===== إجمالي المحصلة والإعفاء ===== -->
                ${buildGrandRow('إجمالي الإيرادات المحصلة والإعفاء', 'background:#cfe2ff;', collectedAndExempt, SR['L'], 'ل - مستند مختبر')}

            </tbody>
        </table>`;
    },

    // ========== الطباعة ==========
    printReport() {
        const printable = document.getElementById('di-printable');
        if (!printable) { alert('لا يوجد تقرير للطباعة.'); return; }

        const win = window.open('', '_blank', 'width=1200,height=800');
        win.document.write(`
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <meta charset="UTF-8">
                <title>المعلومية اليومية</title>
                <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; font-size: 11px; padding: 10mm; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { border: 1px solid #333; padding: 3px 5px; }
                    th { background: #343a40; color: white; text-align: center; }
                    @media print {
                        @page { margin: 10mm; size: A3 landscape; }
                    }
                </style>
            </head>
            <body>
                ${printable.innerHTML}
                <script>window.onload = function(){ window.print(); }<\/script>
            </body>
            </html>
        `);
        win.document.close();
    },
};

// تصدير الكائن ليكون متاحاً عالمياً
window.DailyInfo = DailyInfo;
