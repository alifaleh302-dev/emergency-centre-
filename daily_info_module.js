/**
 * daily_info_module.js
 * واجهة تقرير المعلومية اليومية
 * مركز طوارئ الطرق - نظام إدارة المركز
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

    async view() {
        const today = this.getLocalIsoDate();
        this.state.reportDate = today;

        Core.navigateTo('daily_info', () => {
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
            if (area) {
                area.innerHTML = `<div class="alert alert-warning">${message}</div>`;
            }
        } catch (e) {
            const message = e?.message || 'حدث خطأ أثناء تحميل التقرير.';
            if (area) {
                area.innerHTML = `<div class="alert alert-danger">${message}</div>`;
            }
        }
    },

    renderReport(data) {
        const area = document.getElementById('di-report-area');
        if (!area) return;

        const header = data.header || {};
        const dateObj = new Date(`${data.report_date}T12:00:00`);
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

        const html = `
        <div id="di-printable" style="direction:rtl; font-size:12px; color:#111;">
            <div style="border:2px solid #222; border-bottom:none;">
                <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
                    <tr>
                        <td style="border:1px solid #777; padding:8px; text-align:center; width:22%; background:#f8d7da; font-weight:700; font-size:15px;">
                            ${header.header_directorate || header.header_center || 'اسم المركز'}
                        </td>
                        <td style="border:1px solid #777; padding:8px; text-align:center; width:56%; background:#fce4ec; font-weight:700; line-height:1.7;">
                            <div>${header.header_ministry || 'وزارة الصحة العامة والسكان'}</div>
                            <div>${header.header_office || ''}</div>
                            <div style="font-size:15px; color:#8b0000;">المعلومية اليومية بإجمالي إيرادات مشاركة المجتمع والمشتركة</div>
                            <div>${header.header_center || ''}</div>
                        </td>
                        <td style="border:1px solid #777; padding:8px; text-align:center; width:22%; background:#fff3cd; font-weight:700; line-height:1.8;">
                            <div><span style="display:inline-block; min-width:66px;">اليوم:</span> ${dayName}</div>
                            <div><span style="display:inline-block; min-width:66px;">التاريخ:</span> ${hijriDate || '—'} هـ</div>
                            <div><span style="display:inline-block; min-width:66px;">الموافق:</span> ${gregDate} م</div>
                        </td>
                    </tr>
                </table>
            </div>

            <div style="overflow-x:auto; border:2px solid #222; border-top:none;">
                ${this.renderMainTable(data)}
            </div>

            <div style="margin-top:8px; font-size:11px; color:#444; text-align:left;">
                * لا يتم احتساب أي سند أو فاتورة ملغاة ضمن التقرير.
            </div>
        </div>`;

        area.innerHTML = html;
    },

    renderMainTable(data) {
        const cols = [
            { key: 'mojara',   label: 'مجارحة' },
            { key: 'ruqood',   label: 'رقود' },
            { key: 'amaliyat', label: 'عمليات' },
            { key: 'lab',      label: 'مختبرات' },
            { key: 'ecg',      label: 'تخطيط قلب' },
            { key: 'xray',     label: 'أشعة' },
            { key: 'qararat',  label: 'قرارات' },
            { key: 'tv_xray',  label: 'أشعة تلفزيونية' },
            { key: 'asnan',    label: 'أسنان' },
            { key: 'tickets',  label: 'تذاكر معاينة' },
            { key: 'other',    label: 'أخرى' },
        ];

        const M = data.morning || {};
        const E = data.evening || {};
        const T = data.totals || {};
        const SR = data.serial_ranges || {};
        const TS = data.ticket_serials || {};

        const fmtCount = (value) => {
            const n = Number(value || 0);
            return n > 0 ? n.toLocaleString('ar-YE') : '';
        };

        const fmtAmount = (value) => {
            const n = Number(value || 0);
            return n > 0 ? n.toLocaleString('ar-YE', { maximumFractionDigits: 0 }) : '';
        };

        const buildSerialCells = (serialRange, bgColor, serialLabel = '') => {
            const from = serialRange?.from ?? '';
            const to = serialRange?.to ?? '';
            const count = serialRange?.count ?? '';
            return `
                <td style="border:1px solid #666; padding:4px 5px; text-align:center; ${bgColor}">${from || ''}</td>
                <td style="border:1px solid #666; padding:4px 5px; text-align:center; ${bgColor}">${to || ''}</td>
                <td style="border:1px solid #666; padding:4px 5px; text-align:center; ${bgColor}">${count || ''}</td>
                <td style="border:1px solid #666; padding:4px 5px; text-align:center; ${bgColor}; font-size:10px;">${serialLabel || ''}</td>
            `;
        };

        const getSection = (shift, sectionKey) => {
            if (shift === 'morning') return M[sectionKey] || {};
            if (shift === 'evening') return E[sectionKey] || {};
            return T[sectionKey] || {};
        };

        const buildCells = (section, formatter, bgColor) => cols.map((col) => {
            const value = Number(section[col.key] || 0);
            return `<td style="border:1px solid #666; padding:4px 5px; text-align:center; ${bgColor}">${formatter(value)}</td>`;
        }).join('');

        const buildRow = ({ label, period, sectionKey, shift, bgColor, formatter, serialRange = null, serialLabel = '', bold = false }) => {
            const section = getSection(shift, sectionKey);
            const totalValue = Number(section.total || 0);
            return `
                <tr style="${bold ? 'font-weight:700;' : ''}">
                    <td style="border:1px solid #666; padding:4px 6px; text-align:right; ${bgColor}">${label}</td>
                    <td style="border:1px solid #666; padding:4px 6px; text-align:center; ${bgColor}">${period}</td>
                    ${buildCells(section, formatter, bgColor)}
                    <td style="border:1px solid #666; padding:4px 5px; text-align:center; font-weight:700; ${bgColor}">${formatter(totalValue)}</td>
                    ${buildSerialCells(serialRange, bgColor, serialLabel)}
                </tr>
            `;
        };

        const sumObjects = (...objects) => {
            const keys = new Set();
            objects.forEach(obj => Object.keys(obj || {}).forEach(key => keys.add(key)));
            const result = {};
            keys.forEach(key => {
                result[key] = objects.reduce((sum, obj) => sum + Number(obj?.[key] || 0), 0);
            });
            return result;
        };

        const ticketSerialAll = (() => {
            const morningFrom = TS.morning?.serial_from ?? null;
            const eveningFrom = TS.evening?.serial_from ?? null;
            const morningTo = TS.morning?.serial_to ?? null;
            const eveningTo = TS.evening?.serial_to ?? null;
            const valuesFrom = [morningFrom, eveningFrom].filter(v => v !== null && v !== undefined);
            const valuesTo = [morningTo, eveningTo].filter(v => v !== null && v !== undefined);
            return {
                from: valuesFrom.length ? Math.min(...valuesFrom.map(Number)) : '',
                to: valuesTo.length ? Math.max(...valuesTo.map(Number)) : '',
                count: Number(TS.morning?.count || 0) + Number(TS.evening?.count || 0),
            };
        })();

        const participationAndJoint = sumObjects(T.center || {}, T.ministry || {});
        const collectedAndExempt = sumObjects(participationAndJoint, T.exempt || {});

        const thBase = 'border:1px solid #555; padding:5px 6px; text-align:center; font-size:11px;';
        const mainHead = `${thBase} background:#f8d7da; color:#111; font-weight:700;`;
        const subHead = `${thBase} background:#fde2e4; color:#111; font-weight:700;`;

        return `
        <table style="width:100%; border-collapse:collapse; font-size:11px; table-layout:fixed; direction:rtl;">
            <thead>
                <tr>
                    <th rowspan="2" style="${mainHead} width:13%;">نوع الإيرادات</th>
                    <th rowspan="2" style="${mainHead} width:4%;">الفترة</th>
                    ${cols.map(col => `<th rowspan="2" style="${mainHead}">${col.label}</th>`).join('')}
                    <th rowspan="2" style="${mainHead} width:6%;">الإجمالي</th>
                    <th colspan="2" style="${mainHead} width:8%;">رقم المطبوعات</th>
                    <th rowspan="2" style="${mainHead} width:5%;">عددها</th>
                    <th rowspan="2" style="${mainHead} width:8%;">نوع المطبوعات</th>
                </tr>
                <tr>
                    <th style="${subHead}">من</th>
                    <th style="${subHead}">إلى</th>
                </tr>
            </thead>
            <tbody>
                ${buildRow({
                    label: 'عدد المترددين بسند تحصيل وتذاكر معاينة',
                    period: 'ص',
                    sectionKey: 'visitors',
                    shift: 'morning',
                    bgColor: 'background:#fff;',
                    formatter: fmtCount,
                })}
                ${buildRow({
                    label: 'عدد المترددين بسند تحصيل وتذاكر معاينة',
                    period: 'م',
                    sectionKey: 'visitors',
                    shift: 'evening',
                    bgColor: 'background:#fff;',
                    formatter: fmtCount,
                })}
                ${buildRow({
                    label: 'إجمالي عدد المترددين بسند تحصيل وتذاكر معاينة',
                    period: 'ج',
                    sectionKey: 'visitors',
                    shift: 'total',
                    bgColor: 'background:#fff3a6;',
                    formatter: fmtCount,
                    serialRange: ticketSerialAll.count ? ticketSerialAll : null,
                    serialLabel: 'تذاكر معاينة',
                    bold: true,
                })}

                ${buildRow({
                    label: 'إيرادات مشاركة المجتمع',
                    period: 'ص',
                    sectionKey: 'center',
                    shift: 'morning',
                    bgColor: 'background:#fff;',
                    formatter: fmtAmount,
                })}
                ${buildRow({
                    label: 'إيرادات مشاركة المجتمع',
                    period: 'م',
                    sectionKey: 'center',
                    shift: 'evening',
                    bgColor: 'background:#fff;',
                    formatter: fmtAmount,
                })}
                ${buildRow({
                    label: 'إجمالي إيرادات مشاركة المجتمع',
                    period: 'ج',
                    sectionKey: 'center',
                    shift: 'total',
                    bgColor: 'background:#fff3a6;',
                    formatter: fmtAmount,
                    serialRange: SR.A,
                    serialLabel: 'أ - سند تحصيل',
                    bold: true,
                })}

                ${buildRow({
                    label: 'إيرادات مشتركة',
                    period: 'ص',
                    sectionKey: 'ministry',
                    shift: 'morning',
                    bgColor: 'background:#fff;',
                    formatter: fmtAmount,
                })}
                ${buildRow({
                    label: 'إيرادات مشتركة',
                    period: 'م',
                    sectionKey: 'ministry',
                    shift: 'evening',
                    bgColor: 'background:#fff;',
                    formatter: fmtAmount,
                })}
                ${buildRow({
                    label: 'إجمالي الإيرادات المشتركة',
                    period: 'ج',
                    sectionKey: 'ministry',
                    shift: 'total',
                    bgColor: 'background:#fff3a6;',
                    formatter: fmtAmount,
                    serialRange: SR.B,
                    serialLabel: 'ب - سند مشترك',
                    bold: true,
                })}

                ${buildRow({
                    label: 'الإعفاء',
                    period: 'ص',
                    sectionKey: 'exempt',
                    shift: 'morning',
                    bgColor: 'background:#fff;',
                    formatter: fmtAmount,
                })}
                ${buildRow({
                    label: 'الإعفاء',
                    period: 'م',
                    sectionKey: 'exempt',
                    shift: 'evening',
                    bgColor: 'background:#fff;',
                    formatter: fmtAmount,
                })}
                ${buildRow({
                    label: 'إجمالي الإعفاءات',
                    period: 'ج',
                    sectionKey: 'exempt',
                    shift: 'total',
                    bgColor: 'background:#d8f3dc;',
                    formatter: fmtAmount,
                    serialRange: SR.C,
                    serialLabel: 'ج - سند إعفاء',
                    bold: true,
                })}

                <tr style="font-weight:700;">
                    <td colspan="2" style="border:1px solid #666; padding:5px 8px; text-align:right; background:#f4b6c2;">إجمالي الإيرادات مشاركة والمشتركة</td>
                    ${buildCells(participationAndJoint, fmtAmount, 'background:#f4b6c2;')}
                    <td style="border:1px solid #666; padding:4px 5px; text-align:center; background:#f4b6c2;">${fmtAmount(participationAndJoint.total || 0)}</td>
                    ${buildSerialCells(SR.L, 'background:#f4b6c2;', 'ل - مستند مختبر')}
                </tr>

                <tr style="font-weight:700;">
                    <td colspan="2" style="border:1px solid #666; padding:5px 8px; text-align:right; background:#e2f0d9;">إجمالي الإيرادات المحصلة والإعفاء</td>
                    ${buildCells(collectedAndExempt, fmtAmount, 'background:#e2f0d9;')}
                    <td style="border:1px solid #666; padding:4px 5px; text-align:center; background:#e2f0d9;">${fmtAmount(collectedAndExempt.total || 0)}</td>
                    ${buildSerialCells(SR.L, 'background:#e2f0d9;', 'ل - مستند مختبر')}
                </tr>
            </tbody>
        </table>`;
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
                <style>
                    * { box-sizing: border-box; }
                    body {
                        font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
                        direction: rtl;
                        font-size: 11px;
                        padding: 8mm;
                        margin: 0;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { border: 1px solid #333; padding: 4px 5px; }
                    @page { size: A3 landscape; margin: 8mm; }
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

window.DailyInfo = DailyInfo;
