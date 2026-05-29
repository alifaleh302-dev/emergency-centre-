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
            console.error('daily_info load error:', e);
            const message = e?.message || 'حدث خطأ أثناء تحميل تقرير المعلومية اليومية.';
            if (area) {
                area.innerHTML = `<div class="alert alert-danger">${message}</div>`;
            }
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

        const html = `
        <div id="di-printable" style="direction:rtl; font-size:12px; background:#fff; color:#111;">
            ${this.renderHeaderBlock(header, dayName, gregDate, hijriDate)}
            <div style="overflow-x:auto; border:2px solid #333; border-top:none;">
                ${this.renderMainTable(data)}
            </div>
            <div style="margin-top:8px; font-size:11px; color:#444; text-align:left;">
                * لا يتم احتساب أي سند أو فاتورة ملغاة ضمن التقرير.
            </div>
        </div>`;

        area.innerHTML = html;
    },

    renderHeaderBlock(header, dayName, gregDate, hijriDate) {
        const country = header.header_country || 'الجمهورية اليمنية';
        const ministry = header.header_ministry || 'وزارة الصحة العامة والسكان';
        const office = header.header_office || '';
        const directorate = header.header_directorate || '';
        const center = header.header_center || 'مركز طوارئ الطرق';

        return `
        <div style="border:2px solid #333; border-bottom:none;">
            <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
                <tr>
                    <td style="border:1px solid #333; background:#f8c8d8; width:22%; text-align:center; font-weight:700; font-size:22px; padding:14px 10px;">
                        ${center}
                    </td>
                    <td style="border:1px solid #333; background:#f8c8d8; width:56%; text-align:center; padding:8px 10px; line-height:1.7;">
                        <div style="font-weight:700; font-size:15px;">${country}</div>
                        <div style="font-weight:700; font-size:15px;">${ministry}</div>
                        ${office ? `<div style="font-weight:700; font-size:14px;">${office}</div>` : ''}
                        ${directorate ? `<div style="font-weight:700; font-size:14px;">${directorate}</div>` : ''}
                        <div style="font-weight:800; font-size:16px; margin-top:2px;">المعلومية اليومية بإجمالي إيرادات مشاركة المجتمع والمشتركة</div>
                    </td>
                    <td style="border:1px solid #333; width:22%; padding:0; vertical-align:top;">
                        <table style="width:100%; border-collapse:collapse; height:100%;">
                            <tr>
                                <td style="border:1px solid #333; width:38%; background:#fff; font-weight:700; text-align:center; padding:6px;">اليوم</td>
                                <td style="border:1px solid #333; background:#fff; text-align:center; padding:6px; font-weight:700;">${dayName}</td>
                            </tr>
                            <tr>
                                <td style="border:1px solid #333; background:#fff; font-weight:700; text-align:center; padding:6px;">التاريخ</td>
                                <td style="border:1px solid #333; background:#fff; text-align:center; padding:6px; font-weight:700;">${hijriDate || '—'} هـ</td>
                            </tr>
                            <tr>
                                <td style="border:1px solid #333; background:#fff; font-weight:700; text-align:center; padding:6px;">الموافق</td>
                                <td style="border:1px solid #333; background:#fff; text-align:center; padding:6px; font-weight:700;">${gregDate} م</td>
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
            { key: 'tickets', label: 'تذاكر معاينة' },
            { key: 'other', label: 'أخرى' },
        ];

        const M = data.morning || {};
        const E = data.evening || {};
        const T = data.totals || {};
        const SR = data.serial_ranges || {};
        const TS = data.ticket_serials || {};

        const fmtCount = (value) => {
            const n = Number(value || 0);
            return n > 0 ? Math.round(n).toLocaleString('ar-YE') : '';
        };

        const fmtAmount = (value) => {
            const n = Number(value || 0);
            return n > 0 ? Math.round(n).toLocaleString('ar-YE') : '';
        };

        const tdBase = 'border:1px solid #333; padding:4px 5px; text-align:center; vertical-align:middle;';
        const thBase = 'border:1px solid #333; padding:5px 6px; text-align:center; vertical-align:middle; font-weight:700;';

        const ticketSerialAll = this.mergeRanges(
            TS.morning?.serial_from ? { from: TS.morning.serial_from, to: TS.morning.serial_to, count: TS.morning.count } : null,
            TS.evening?.serial_from ? { from: TS.evening.serial_from, to: TS.evening.serial_to, count: TS.evening.count } : null,
        );

        const getSection = (shiftKey, sectionKey) => {
            if (shiftKey === 'morning') return M[sectionKey] || {};
            if (shiftKey === 'evening') return E[sectionKey] || {};
            return T[sectionKey] || {};
        };

        const buildBodyCells = (section, formatter, bgColor) => cols.map((c) => {
            const val = Number(section[c.key] || 0);
            return `<td style="${tdBase}${bgColor}">${val > 0 ? formatter(val) : ''}</td>`;
        }).join('');

        const buildSerialCells = (serialRange, bgColor, serialLabel = '') => {
            const text = serialRange?.from ? `${serialRange.from} / ${serialRange.to}` : '';
            const count = serialRange?.count ? fmtCount(serialRange.count) : '';
            return `
                <td style="${tdBase}${bgColor} font-size:10px;">${text}</td>
                <td style="${tdBase}${bgColor}">${count}</td>
                <td style="${tdBase}${bgColor} font-size:10px;">${serialLabel || ''}</td>`;
        };

        const buildRow = ({ label, period, sectionKey, shiftKey, bgColor = '', bold = false, serialRange = null, serialLabel = '' }) => {
            const section = getSection(shiftKey, sectionKey);
            const formatter = sectionKey === 'visitors' ? fmtCount : fmtAmount;
            const total = Number(section.total || 0);

            return `
            <tr style="${bold ? 'font-weight:700;' : ''}">
                <td style="${tdBase}${bgColor} text-align:right;">${label}</td>
                <td style="${tdBase}${bgColor}">${period}</td>
                ${buildBodyCells(section, formatter, bgColor)}
                <td style="${tdBase}${bgColor} font-weight:700;">${total > 0 ? formatter(total) : ''}</td>
                ${buildSerialCells(serialRange, bgColor, serialLabel)}
            </tr>`;
        };

        const sumSections = (firstKey, secondKey) => {
            const result = {};
            const keys = new Set([
                ...Object.keys(T[firstKey] || {}),
                ...Object.keys(T[secondKey] || {}),
            ]);
            keys.forEach((key) => {
                result[key] = Number((T[firstKey] || {})[key] || 0) + Number((T[secondKey] || {})[key] || 0);
            });
            return result;
        };

        const buildGrandRow = ({ label, dataObj, bgColor, serialRange, serialLabel }) => {
            const total = Number(dataObj.total || 0);
            const cells = cols.map((c) => {
                const value = Number(dataObj[c.key] || 0);
                return `<td style="${tdBase}${bgColor}">${value > 0 ? fmtAmount(value) : ''}</td>`;
            }).join('');

            return `
            <tr style="font-weight:700;">
                <td colspan="2" style="${tdBase}${bgColor} text-align:right;">${label}</td>
                ${cells}
                <td style="${tdBase}${bgColor}">${total > 0 ? fmtAmount(total) : ''}</td>
                ${buildSerialCells(serialRange, bgColor, serialLabel)}
            </tr>`;
        };

        const participationAndJoint = sumSections('center', 'ministry');
        const collectedAndExempt = sumSections('center', 'exempt');
        const headerCols = cols.map((c) => `<th style="${thBase} background:#f7e59d;">${c.label}</th>`).join('');

        return `
        <table style="width:100%; border-collapse:collapse; font-size:11px; direction:rtl; table-layout:fixed;">
            <thead>
                <tr>
                    <th rowspan="2" style="${thBase} background:#f4b9c8; width:15%;">نوع الإيرادات</th>
                    <th rowspan="2" style="${thBase} background:#f4b9c8; width:4%;">الفترة</th>
                    <th colspan="11" style="${thBase} background:#f4b9c8;">الخدمات والأقسام</th>
                    <th rowspan="2" style="${thBase} background:#f4b9c8; width:6%;">الإجمالي</th>
                    <th colspan="3" style="${thBase} background:#f4b9c8; width:15%;">المطبوعات</th>
                </tr>
                <tr>
                    ${headerCols}
                    <th style="${thBase} background:#f7e59d;">رقم المطبوعات<br>(من / إلى)</th>
                    <th style="${thBase} background:#f7e59d;">عددها</th>
                    <th style="${thBase} background:#f7e59d;">نوع المطبوعات</th>
                </tr>
            </thead>
            <tbody>
                ${buildRow({
                    label: 'عدد المترددين بسند تحصيل وتذاكر معاينة',
                    period: 'ص',
                    sectionKey: 'visitors',
                    shiftKey: 'morning',
                    bgColor: 'background:#fff;',
                })}
                ${buildRow({
                    label: 'عدد المترددين بسند تحصيل وتذاكر معاينة',
                    period: 'م',
                    sectionKey: 'visitors',
                    shiftKey: 'evening',
                    bgColor: 'background:#fff;',
                })}
                ${buildRow({
                    label: 'إجمالي عدد المترددين بسند تحصيل وتذاكر معاينة',
                    period: 'ج',
                    sectionKey: 'visitors',
                    shiftKey: 'total',
                    bgColor: 'background:#fff4a8;',
                    bold: true,
                    serialRange: ticketSerialAll,
                    serialLabel: 'تذاكر معاينة',
                })}

                ${buildRow({
                    label: 'إيرادات مشاركة المجتمع',
                    period: 'ص',
                    sectionKey: 'center',
                    shiftKey: 'morning',
                    bgColor: 'background:#fff;',
                })}
                ${buildRow({
                    label: 'إيرادات مشاركة المجتمع',
                    period: 'م',
                    sectionKey: 'center',
                    shiftKey: 'evening',
                    bgColor: 'background:#fff;',
                })}
                ${buildRow({
                    label: 'إجمالي إيرادات مشاركة المجتمع',
                    period: 'ج',
                    sectionKey: 'center',
                    shiftKey: 'total',
                    bgColor: 'background:#fff4a8;',
                    bold: true,
                    serialRange: SR.A,
                    serialLabel: 'سند تحصيل',
                })}

                ${buildRow({
                    label: 'إيرادات مشتركة',
                    period: 'ص',
                    sectionKey: 'ministry',
                    shiftKey: 'morning',
                    bgColor: 'background:#fff;',
                })}
                ${buildRow({
                    label: 'إيرادات مشتركة',
                    period: 'م',
                    sectionKey: 'ministry',
                    shiftKey: 'evening',
                    bgColor: 'background:#fff;',
                })}
                ${buildRow({
                    label: 'إجمالي الإيرادات المشتركة',
                    period: 'ج',
                    sectionKey: 'ministry',
                    shiftKey: 'total',
                    bgColor: 'background:#fff4a8;',
                    bold: true,
                    serialRange: null,
                    serialLabel: 'غير معتمد حالياً',
                })}

                ${buildRow({
                    label: 'الإعفاءات',
                    period: 'ص',
                    sectionKey: 'exempt',
                    shiftKey: 'morning',
                    bgColor: 'background:#fff;',
                })}
                ${buildRow({
                    label: 'الإعفاءات',
                    period: 'م',
                    sectionKey: 'exempt',
                    shiftKey: 'evening',
                    bgColor: 'background:#fff;',
                })}
                ${buildRow({
                    label: 'إجمالي الإعفاءات',
                    period: 'ج',
                    sectionKey: 'exempt',
                    shiftKey: 'total',
                    bgColor: 'background:#d8f0d2;',
                    bold: true,
                    serialRange: SR.EXEMPT || SR.C,
                    serialLabel: 'سندات إعفاء',
                })}

                ${buildGrandRow({
                    label: 'إجمالي الإيرادات مشاركة والمشتركة',
                    dataObj: participationAndJoint,
                    bgColor: 'background:#f7c3d0;',
                    serialRange: SR.L,
                    serialLabel: 'استمارات فحوصات / مختبر',
                })}
                ${buildGrandRow({
                    label: 'إجمالي الإيرادات المحصلة والإعفاء',
                    dataObj: collectedAndExempt,
                    bgColor: 'background:#e8d4ea;',
                    serialRange: SR.L,
                    serialLabel: 'استمارات فحوصات / مختبر',
                })}
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
                <style>
                    * { box-sizing: border-box; }
                    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; font-size: 11px; padding: 8mm; color:#111; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { border: 1px solid #333; padding: 4px 5px; vertical-align: middle; }
                    @media print {
                        @page { margin: 8mm; size: A3 landscape; }
                        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
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

window.DailyInfo = DailyInfo;
