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

    // ============== Helpers عامة ==============
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
            /* ====== ألوان وأبعاد افتراضية مشتركة ====== */
            #di-printable { direction: rtl; color: #1f2937; background: #fff; }
            #di-printable .di-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
            #di-printable .di-table th,
            #di-printable .di-table td {
                border: 1px solid #4b5563;
                text-align: center;
                vertical-align: middle;
                padding: 10px 8px;
                word-wrap: break-word;
                white-space: normal;
            }
            #di-printable .di-table th { font-weight: 700; }
            #di-printable .di-cat   { font-weight: 800; }
            #di-printable .di-bayan { text-align: right; padding-right: 10px; }
            #di-printable .di-period{ font-weight: 700; width: 40px; }

            /* الحد الأدنى لعرض الخلايا لمنع الانضغاط */
            #di-printable .di-th-cat     { min-width: 110px; }
            #di-printable .di-th-bayan   { min-width: 220px; }
            #di-printable .di-th-period  { min-width: 50px;  }
            #di-printable .di-th-svc     { min-width: 80px;  }
            #di-printable .di-th-total   { min-width: 95px;  }
            #di-printable .di-th-serial  { min-width: 80px;  }
            #di-printable .di-th-count   { min-width: 70px;  }
            #di-printable .di-th-doc     { min-width: 150px; }

            /* الحاوية للتمرير الأفقي على الشاشات الصغيرة */
            #di-printable .di-scroll { overflow-x: auto; }

            /* ====== ألوان وضع المتصفح (هادئة) ====== */
            @media screen {
                .report-header { display: none !important; }

                #di-printable .di-table th,
                #di-printable .di-table td { padding: 12px 10px; }

                #di-printable .bg-cat       { background: #eef2ff; }   /* بنفسجي فاتح */
                #di-printable .bg-header    { background: #e5e7eb; }   /* رمادي فاتح */
                #di-printable .bg-svc-hdr   { background: #f3f4f6; }
                #di-printable .bg-subtotal  { background: #fef9c3; }   /* أصفر هادئ */
                #di-printable .bg-exempt    { background: #dcfce7; }   /* أخضر هادئ */
                #di-printable .bg-grand     { background: #fce7f3; }   /* وردي هادئ */
                #di-printable .bg-grand2    { background: #ede9fe; }   /* بنفسجي خفيف */
                #di-printable .bg-row       { background: #ffffff; }
            }

            /* ====== ألوان وضع الطباعة (مطابقة للنموذج الورقي) ====== */
            @media print {
                .report-header { display: block !important; }

                #di-printable .di-table th,
                #di-printable .di-table td { padding: 4px 5px; font-size: 10.5px; }

                #di-printable .bg-cat       { background: #f4b9c8 !important; }
                #di-printable .bg-header    { background: #f4b9c8 !important; }
                #di-printable .bg-svc-hdr   { background: #f7e59d !important; }
                #di-printable .bg-subtotal  { background: #fff4a8 !important; }
                #di-printable .bg-exempt    { background: #d8f0d2 !important; }
                #di-printable .bg-grand     { background: #f7c3d0 !important; }
                #di-printable .bg-grand2    { background: #ffffff !important; }
                #di-printable .bg-row       { background: #ffffff !important; }

                body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
                #di-printable .di-scroll { overflow: visible !important; }
                #di-printable .di-table  { font-size: 10px; }
            }

            /* إعدادات الصفحة */
            @page { size: A4 landscape; margin: 0.5cm; }
        `;
        document.head.appendChild(style);
    },

    // ============== الواجهة الرئيسية ==============
    async view() {
        this.injectStylesOnce();
        const today = this.getLocalIsoDate();
        this.state.reportDate = today;

        Core.navigateTo('openDailyInfo', () => {
            document.getElementById('mainContent').innerHTML = this.renderShell();
        });

        this.bindDatePicker();
        await this.loadReport(today);
    },

    renderShell() {
        const today = this.getLocalIsoDate();
        return `
        <div id="di-container" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif; direction:rtl; padding:16px;">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                <h5 class="mb-0 fw-bold text-primary">
                    <i class="bi bi-newspaper ms-2"></i>المعلومية اليومية
                </h5>
                <div class="d-flex align-items-center gap-2 me-auto">
                    <input type="date" id="di-date-picker" class="form-control form-control-sm"
                           value="${today}" style="width:170px;">
                    <button class="btn btn-primary btn-sm" onclick="DailyInfo.loadReport(document.getElementById('di-date-picker').value)">
                        <i class="bi bi-arrow-clockwise ms-1"></i>تحديث
                    </button>
                    <button class="btn btn-success btn-sm" onclick="DailyInfo.printReport()">
                        <i class="bi bi-printer ms-1"></i>طباعة
                    </button>
                </div>
            </div>

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

    async loadReport(date) {
        this.state.reportDate = date;
        const area = document.getElementById('di-report-area');
        if (area) {
            area.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
        }

        try {
            const res = await Core.apiCall(`reports/daily_info?date=${date}`, 'GET');
            if (res && res.success) {
                this.state.data = res.data;
                this.renderReport(res.data);
                return;
            }

            const message = res?.message || 'تعذر تحميل بيانات المعلومية اليومية.';
            if (area) area.innerHTML = `<div class="alert alert-warning">${message}</div>`;
        } catch (e) {
            console.error('daily_info load error:', e);
            const message = e?.message || 'حدث خطأ أثناء تحميل تقرير المعلومية اليومية.';
            if (area) area.innerHTML = `<div class="alert alert-danger">${message}</div>`;
        }
    },

    // ============== العرض الرئيسي ==============
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
        } catch (_) { hijriDate = ''; }

        area.innerHTML = `
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
        </div>`;
    },

    renderHeaderBlock(header, dayName, gregDate, hijriDate) {
        const country = header.header_country || 'الجمهورية اليمنية';
        const ministry = header.header_ministry || 'وزارة الصحة العامة والسكان';
        const office = header.header_office || '';
        const directorate = header.header_directorate || '';
        const center = header.header_center || 'مركز طوارئ الطرق';

        return `
        <div style="border:2px solid #4b5563;">
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

    // ============== الجدول الرئيسي ==============
    renderMainTable(data) {
        // ترتيب أعمدة الخدمات يطابق النموذج الورقي (من اليمين إلى اليسار):
        //   مختبرات | عمليات | رقود | مجارحة | تخطيط قلب | أشعة | قرارات | أشعة تلفزيونية | أسنان | تذكر معاينة | أخرى
        const cols = [
            { key: 'lab',       label: 'مختبرات' },
            { key: 'amaliyat',  label: 'عمليات' },
            { key: 'ruqood',    label: 'رقود' },
            { key: 'mojara',    label: 'مجارحة' },
            { key: 'ecg',       label: 'تخطيط قلب' },
            { key: 'xray',      label: 'أشعة' },
            { key: 'qararat',   label: 'قرارات' },
            { key: 'tv_xray',   label: 'أشعة تلفزيونية' },
            { key: 'asnan',     label: 'أسنان' },
            { key: 'tickets',   label: 'تذكر معاينة' },
            { key: 'other',     label: 'أخرى' },
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

        const ticketSerialAll = this.mergeRanges(
            TS.morning?.serial_from ? { from: TS.morning.serial_from, to: TS.morning.serial_to, count: TS.morning.count } : null,
            TS.evening?.serial_from ? { from: TS.evening.serial_from, to: TS.evening.serial_to, count: TS.evening.count } : null,
        );

        const getSection = (shiftKey, sectionKey) => {
            if (shiftKey === 'morning') return M[sectionKey] || {};
            if (shiftKey === 'evening') return E[sectionKey] || {};
            return T[sectionKey] || {};
        };

        const buildBodyCells = (section) =>
            cols.map((c) => `<td>${fmt(section[c.key])}</td>`).join('');

        // ========= تعريف هيكل التصنيفات =========
        // كل تصنيف يحتوي على:
        //   catLabel  : اسم التصنيف الرئيسي (rowspan=3)
        //   sectionKey: مفتاح القسم في البيانات
        //   bayan     : نص بيان نوع الإيراد (يُكرر في صفي ص و م)
        //   bayanTotal: نص بيان الإجمالي (صف ج)
        //   docLabel  : نوع المطبوعات (rowspan=3)
        //   serial    : نطاق التسلسل المرتبط (يظهر في صف ج)
        //   subtotalClass: لون صف الإجمالي
        const categories = [
            {
                catLabel: 'المترددين على الخدمات',
                sectionKey: 'visitors',
                bayan: 'عدد المترددين بسند تحصيل وتذاكر معاينة',
                bayanTotal: 'إجمالي عدد المترددين بسند تحصيل وتذاكر معاينة',
                docLabel: 'تذاكر معاينة',
                serial: ticketSerialAll,
                subtotalClass: 'bg-subtotal',
            },
            {
                catLabel: 'مشاركة المجتمع',
                sectionKey: 'center',
                bayan: 'إيرادات مشاركة المجتمع',
                bayanTotal: 'إجمالي إيرادات مشاركة المجتمع',
                docLabel: 'اسناد تحصيل مشاركة مجتمع',
                serial: SR.A,
                subtotalClass: 'bg-subtotal',
            },
            {
                catLabel: 'المشتركة',
                sectionKey: 'ministry',
                bayan: 'إيرادات مشتركة',
                bayanTotal: 'إجمالي الإيرادات المشتركة',
                docLabel: 'قسائم تحصيل موارد مشتركة',
                serial: null,
                subtotalClass: 'bg-subtotal',
            },
            {
                catLabel: 'الإعفاء',
                sectionKey: 'exempt',
                bayan: 'الإعفاء',
                bayanTotal: 'إجمالي الإعفاءات',
                docLabel: 'سندات الإعفاء',
                serial: SR.EXEMPT || SR.C,
                subtotalClass: 'bg-exempt',
            },
        ];

        // ========= بناء صفوف التصنيفات =========
        // كل تصنيف يولّد 3 صفوف:
        //  - الصف الأول (ص): يحوي خلية التصنيف rowspan=3 + بيان + ص + بيانات + إجمالي + خلية المطبوعات (من/إلى/عدد) ثم خلية نوع المطبوعات rowspan=3
        //    لكن المطبوعات (من/إلى/عدد) تظهر في صف الإجمالي (ج) فقط، ولها rowspan=3 على خلايا نوع المطبوعات.
        //  - بناءً على النموذج: "نوع المطبوعات" rowspan=3، أما (من/إلى/عدد) فتظهر مرة واحدة فقط في صف "ج" (rowspan=3 من صف ص).
        //  - الحل: نضع خلايا (من/إلى/عدد) في صف "ص" بـ rowspan=3 ولكن قيمتها مأخوذة من نطاق التسلسل. وكذلك "نوع المطبوعات" بـ rowspan=3.
        //  - هذا يحقق المطابقة الكاملة للنموذج الورقي.

        const buildCategoryRows = (cat) => {
            const morningSec = getSection('morning', cat.sectionKey);
            const eveningSec = getSection('evening', cat.sectionKey);
            const totalSec   = getSection('total',   cat.sectionKey);

            const serial = cat.serial || {};
            const sFrom  = serial.from != null ? serial.from : '';
            const sTo    = serial.to   != null ? serial.to   : '';
            const sCount = serial.count ? fmt(serial.count) : '';

            const mTotal = Number(morningSec.total || 0);
            const eTotal = Number(eveningSec.total || 0);
            const tTotal = Number(totalSec.total || 0);

            // صف ص
            const row1 = `
                <tr class="bg-row">
                    <td class="di-cat bg-cat" rowspan="3">${cat.catLabel}</td>
                    <td class="di-bayan">${cat.bayan}</td>
                    <td class="di-period">ص</td>
                    ${buildBodyCells(morningSec)}
                    <td><strong>${fmt(mTotal)}</strong></td>
                    <td rowspan="3">${sFrom}</td>
                    <td rowspan="3">${sTo}</td>
                    <td rowspan="3"><strong>${sCount}</strong></td>
                    <td rowspan="3" class="di-cat">${cat.docLabel}</td>
                </tr>`;

            // صف م
            const row2 = `
                <tr class="bg-row">
                    <td class="di-bayan">${cat.bayan}</td>
                    <td class="di-period">م</td>
                    ${buildBodyCells(eveningSec)}
                    <td><strong>${fmt(eTotal)}</strong></td>
                </tr>`;

            // صف ج (الإجمالي اليومي للتصنيف)
            const row3 = `
                <tr class="${cat.subtotalClass}" style="font-weight:700;">
                    <td class="di-bayan">${cat.bayanTotal}</td>
                    <td class="di-period">ج</td>
                    ${buildBodyCells(totalSec)}
                    <td><strong>${fmt(tTotal)}</strong></td>
                </tr>`;

            return row1 + row2 + row3;
        };

        // ========= صفان نهائيان: إجمالي مشاركة + المشتركة، وإجمالي المحصلة + الإعفاء =========
        const sumSections = (firstKey, secondKey) => {
            const result = {};
            const keys = new Set([
                ...Object.keys(T[firstKey] || {}),
                ...Object.keys(T[secondKey] || {}),
            ]);
            keys.forEach((k) => {
                result[k] = Number((T[firstKey] || {})[k] || 0) + Number((T[secondKey] || {})[k] || 0);
            });
            return result;
        };

        const participationAndJoint = sumSections('center', 'ministry');
        const collectedAndExempt    = sumSections('center', 'exempt');

        const labL = SR.L || {};
        const lFrom  = labL.from != null ? labL.from : '';
        const lTo    = labL.to   != null ? labL.to   : '';
        const lCount = labL.count ? fmt(labL.count) : '';

        const grandRow1 = `
            <tr class="bg-grand" style="font-weight:800;">
                <td class="di-cat bg-grand" colspan="2" style="text-align:right; padding-right:10px;">إجمالي الإيرادات مشاركة والمشتركة</td>
                <td class="di-period">ج</td>
                ${cols.map((c) => `<td>${fmt(participationAndJoint[c.key])}</td>`).join('')}
                <td><strong>${fmt(participationAndJoint.total)}</strong></td>
                <td rowspan="2">${lFrom}</td>
                <td rowspan="2">${lTo}</td>
                <td rowspan="2"><strong>${lCount}</strong></td>
                <td rowspan="2" class="di-cat">استمارات الفحوصات</td>
            </tr>`;

        const grandRow2 = `
            <tr class="bg-grand2" style="font-weight:800;">
                <td class="di-cat bg-grand2" colspan="2" style="text-align:right; padding-right:10px;">إجمالي الإيرادات المحصلة والإعفاء</td>
                <td class="di-period">ج</td>
                ${cols.map((c) => `<td>${fmt(collectedAndExempt[c.key])}</td>`).join('')}
                <td><strong>${fmt(collectedAndExempt.total)}</strong></td>
            </tr>`;

        // ========= رؤوس الجدول =========
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
                    <th class="bg-header di-th-cat"    rowspan="2">نوع الإيرادات</th>
                    <th class="bg-header di-th-bayan"  rowspan="2">البيان</th>
                    <th class="bg-header di-th-period" rowspan="2">الفترة</th>
                    <th class="bg-header" colspan="${cols.length}">الخدمات والأقسام</th>
                    <th class="bg-header di-th-total"  rowspan="2">الإجمالي</th>
                    <th class="bg-header" colspan="2">رقم المطبوعات</th>
                    <th class="bg-header di-th-count"  rowspan="2">عددها</th>
                    <th class="bg-header di-th-doc"    rowspan="2">نوع المطبوعات</th>
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
            </tbody>
        </table>`;
    },

    mergeRanges(...ranges) {
        const valid = ranges.filter((r) => r && r.from != null && r.to != null);
        if (!valid.length) return null;
        return {
            from: Math.min(...valid.map((r) => Number(r.from))),
            to:   Math.max(...valid.map((r) => Number(r.to))),
            count: valid.reduce((sum, r) => sum + (Number(r.count) || 0), 0),
        };
    },

    // ============== الطباعة ==============
    printReport() {
        const printable = document.getElementById('di-printable');
        if (!printable) { alert('لا يوجد تقرير للطباعة.'); return; }

        const win = window.open('', '_blank', 'width=1400,height=900');
        win.document.write(`
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <meta charset="UTF-8">
                <title>المعلومية اليومية</title>
                <style>
                    * { box-sizing: border-box; }
                    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; color:#111; margin:0; padding:6mm; }
                    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                    th, td { border: 1px solid #333; padding: 4px 5px; text-align:center; vertical-align: middle; font-size: 10.5px; word-wrap: break-word; }
                    .di-bayan { text-align: right; padding-right: 8px; }
                    .di-cat { font-weight: 800; }
                    .report-header { display: block; }

                    .bg-cat,    .bg-header   { background: #f4b9c8 !important; }
                    .bg-svc-hdr               { background: #f7e59d !important; }
                    .bg-subtotal              { background: #fff4a8 !important; }
                    .bg-exempt                { background: #d8f0d2 !important; }
                    .bg-grand                 { background: #f7c3d0 !important; }
                    .bg-grand2                { background: #ffffff !important; }
                    .bg-row                   { background: #ffffff !important; }

                    @page { size: A4 landscape; margin: 0.5cm; }
                    @media print {
                        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                ${printable.innerHTML}
                <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 200); }<\/script>
            </body>
            </html>
        `);
        win.document.close();
    },
};

window.DailyInfo = DailyInfo;
