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

    // ===================== Helpers =====================
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
            #dj-wrapper { direction: rtl; }
            #dj-wrapper .dj-table {
                width: 100%; border-collapse: collapse; font-size: 13px; background: #fff;
            }
            #dj-wrapper .dj-table th, #dj-wrapper .dj-table td {
                border: 1px solid #d1d5db; padding: 10px 8px; text-align: center; vertical-align: middle;
            }
            #dj-wrapper .dj-table thead th {
                background: #1e40af; color: #fff; font-weight: 700; position: sticky; top: 0; z-index: 2;
            }
            #dj-wrapper .dj-row-a       { background: #ffffff; }
            #dj-wrapper .dj-row-a:hover { background: #eff6ff; }
            #dj-wrapper .dj-row-b       { background: #fef9f3; }
            #dj-wrapper .dj-row-b:hover { background: #fff4e6; }
            #dj-wrapper .dj-row-separator {
                background: linear-gradient(90deg,#fde68a 0%,#fcd34d 50%,#fde68a 100%);
                font-weight: 700; color: #78350f; font-size: 14px;
            }
            #dj-wrapper .dj-row-shift {
                background: #fef3c7; color: #78350f; font-weight: 700; font-size: 13.5px;
            }
            #dj-wrapper .dj-row-shift td { padding: 14px 10px; }
            #dj-wrapper .dj-row-closed { background: #d1fae5; color: #064e3b; font-weight: 700; }
            #dj-wrapper .dj-badge {
                display: inline-block; padding: 3px 8px; border-radius: 12px;
                font-size: 11px; font-weight: 700;
            }
            #dj-wrapper .dj-badge-a  { background: #dbeafe; color: #1e40af; }
            #dj-wrapper .dj-badge-b  { background: #fed7aa; color: #9a3412; }
            #dj-wrapper .dj-badge-c  { background: #fecaca; color: #991b1b; }
            #dj-wrapper .dj-badge-dept { background: #e0e7ff; color: #3730a3; }
            #dj-wrapper .dj-filters {
                background: #f9fafb; padding: 14px; border-radius: 10px; margin-bottom: 14px;
            }
            #dj-wrapper .dj-empty { padding: 40px; text-align: center; color: #6b7280; }
            #dj-wrapper .dj-detail-btn {
                background: #4f46e5; color: #fff; border: 0; padding: 5px 12px;
                border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;
            }
            #dj-wrapper .dj-detail-btn:hover { background: #4338ca; }
            #dj-wrapper .dj-close-btn {
                background: #dc2626; color: #fff; border: 0; padding: 6px 14px;
                border-radius: 6px; cursor: pointer; font-size: 12.5px; font-weight: 700;
            }
            #dj-wrapper .dj-close-btn:hover { background: #b91c1c; }
            #dj-wrapper .dj-close-btn:disabled { background: #9ca3af; cursor: not-allowed; }

            /* Modal */
            #dj-modal-bg {
                position: fixed; inset: 0; background: rgba(0,0,0,0.5);
                display: none; align-items: center; justify-content: center; z-index: 9999;
            }
            #dj-modal-bg.show { display: flex; }
            #dj-modal {
                background: #fff; border-radius: 12px; max-width: 720px; width: 90%;
                max-height: 80vh; overflow: auto; padding: 22px; direction: rtl;
            }
            #dj-modal h3 { margin: 0 0 14px 0; color: #1e40af; }
            #dj-modal table { width: 100%; border-collapse: collapse; }
            #dj-modal th, #dj-modal td {
                border: 1px solid #d1d5db; padding: 8px; text-align: center; font-size: 13px;
            }
            #dj-modal th { background: #f3f4f6; font-weight: 700; }
            #dj-modal-close {
                margin-top: 14px; background: #6b7280; color: #fff;
                border: 0; padding: 8px 18px; border-radius: 6px; cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    },

    // ===================== Main entry =====================
    view() {
        Core.navigateTo('viewDailyJournal', () => {
            this.injectStylesOnce();
            this.state.date = this.getTodayIso();
            this.state.departmentId = 0;

            const main = document.getElementById('mainContent');
            const tools = [
                { label: 'تحديث', icon: 'bi-arrow-repeat', action: 'DailyJournal.load()' },
                { label: 'طباعة', icon: 'bi-printer', action: 'window.print()' },
            ];
            main.innerHTML = `
                <div class="container-fluid p-0 animate-in" id="dj-wrapper">
                    ${Core.renderHeaderWithTools('اليومية', 'سجل السندات اليومية مع إقفال فترات تذاكر المعاينة.', tools)}

                    <div class="dj-filters">
                        <div class="row g-3 align-items-end">
                            <div class="col-md-3">
                                <label class="form-label fw-bold">التاريخ</label>
                                <input type="date" id="dj-date" class="form-control" value="${this.state.date}">
                            </div>
                            <div class="col-md-3">
                                <label class="form-label fw-bold">القسم (اختياري)</label>
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
                            <div class="col-md-2">
                                <button class="btn btn-primary w-100" onclick="DailyJournal.load()">
                                    <i class="bi bi-funnel"></i> تطبيق
                                </button>
                            </div>
                        </div>
                    </div>

                    <div id="dj-container" class="card shadow-sm border-0 p-0" style="overflow:auto;">
                        <div class="text-center p-5">
                            <div class="spinner-border text-primary"></div>
                        </div>
                    </div>
                </div>

                <!-- Modal التفاصيل -->
                <div id="dj-modal-bg" onclick="if(event.target===this) DailyJournal.closeModal()">
                    <div id="dj-modal">
                        <h3 id="dj-modal-title">تفاصيل السند</h3>
                        <div id="dj-modal-body">
                            <div class="text-center"><div class="spinner-border text-primary"></div></div>
                        </div>
                        <button id="dj-modal-close" onclick="DailyJournal.closeModal()">إغلاق</button>
                    </div>
                </div>
            `;
            this.load();
        });
    },

    async load() {
        this.state.date = document.getElementById('dj-date')?.value || this.getTodayIso();
        this.state.departmentId = parseInt(document.getElementById('dj-dept')?.value || '0', 10);

        const container = document.getElementById('dj-container');
        container.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary"></div></div>`;

        const params = new URLSearchParams({ date: this.state.date });
        if (this.state.departmentId > 0) params.append('department_id', String(this.state.departmentId));

        const res = await Core.apiCall('accounting/daily_journal?' + params.toString(), 'GET');
        if (!res || !res.success) {
            container.innerHTML = `<div class="dj-empty">⚠️ تعذر جلب بيانات اليومية.</div>`;
            return;
        }
        this.state.data = res.data;
        this.render();
    },

    render() {
        const { invoices, shift_totals, closures } = this.state.data;
        const container = document.getElementById('dj-container');

        if ((!invoices || invoices.length === 0) && (!shift_totals || shift_totals.length === 0)
            && (!closures || closures.length === 0)) {
            container.innerHTML = `<div class="dj-empty">📭 لا توجد سندات أو فترات لهذا اليوم.</div>`;
            return;
        }

        // فصل بصري بين A و (B/C)
        const groupA = invoices.filter(i => i.group_order === 0);
        const groupBC = invoices.filter(i => i.group_order === 1);

        let html = `
            <table class="dj-table">
                <thead>
                    <tr>
                        <th style="width: 60px;">#</th>
                        <th>اسم المريض</th>
                        <th style="width: 110px;">رقم السند</th>
                        <th style="width: 130px;">القسم</th>
                        <th style="width: 150px;">نوع السند</th>
                        <th style="width: 130px;">المبلغ</th>
                        <th style="width: 100px;">الوقت</th>
                        <th style="width: 110px;">التفاصيل</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let rowNum = 1;
        // المجموعة A
        if (groupA.length > 0) {
            for (const inv of groupA) {
                html += this.renderInvoiceRow(inv, rowNum++, 'a');
            }
        }

        // فاصل بصري
        if (groupA.length > 0 && groupBC.length > 0) {
            html += `
                <tr class="dj-row-separator">
                    <td colspan="8">⚠️ ──── سندات الإعفاءات (B / C) ────</td>
                </tr>
            `;
        }

        // المجموعة B/C
        if (groupBC.length > 0) {
            for (const inv of groupBC) {
                html += this.renderInvoiceRow(inv, rowNum++, 'b');
            }
        }

        // صفوف إقفالات سابقة في نفس اليوم (إنجازات مكتملة)
        if (closures && closures.length > 0) {
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
                            | بواسطة: ${c.closed_by_name ?? '—'}
                        </td>
                    </tr>
                `;
            }
        }

        // صفوف الفترات المفتوحة (تحتاج إقفال)
        if (shift_totals && shift_totals.length > 0) {
            for (const st of shift_totals) {
                html += `
                    <tr class="dj-row-shift">
                        <td colspan="8">
                            تذاكر ${st.shift_label}ة من تسلسل [${st.start_no}] إلى تسلسل [${st.end_no}]
                            (${st.tickets_count} تذكرة)،
                            حصة المركز (${this.fmtMoney(st.center_share)})،
                            حصة الوزارة (${this.fmtMoney(st.ministry_share)})
                            &nbsp;&nbsp;
                            <button class="dj-close-btn"
                                onclick="DailyJournal.closeShift('${st.shift_type}', this)">
                                🔒 إقفال الفترة
                            </button>
                        </td>
                    </tr>
                `;
            }
        }

        html += `</tbody></table>`;
        container.innerHTML = html;
    },

    renderInvoiceRow(inv, idx, group) {
        const docClass = inv.doc_name === 'A' ? 'dj-badge-a'
                      : inv.doc_name === 'B' ? 'dj-badge-b' : 'dj-badge-c';
        return `
            <tr class="dj-row-${group}">
                <td>${idx}</td>
                <td>${this.escape(inv.patient_name)}</td>
                <td><strong>${inv.serial_number}</strong> <small class="text-muted">(${inv.doc_name})</small></td>
                <td><span class="dj-badge dj-badge-dept">${this.escape(inv.department_name || '—')}</span></td>
                <td><span class="dj-badge ${docClass}">${this.escape(inv.type_label)}</span></td>
                <td><strong>${this.fmtMoney(inv.amount)}</strong></td>
                <td>${this.escape(inv.time || '')}</td>
                <td>
                    <button class="dj-detail-btn" onclick="DailyJournal.showDetails(${inv.invoice_id}, '${this.escape(inv.patient_name).replace(/'/g, '')}')">
                        <i class="bi bi-eye"></i> عرض
                    </button>
                </td>
            </tr>
        `;
    },

    async showDetails(invoiceId, patientName) {
        document.getElementById('dj-modal-bg').classList.add('show');
        document.getElementById('dj-modal-title').textContent = `تفاصيل السند للمريض: ${patientName}`;
        const body = document.getElementById('dj-modal-body');
        body.innerHTML = `<div class="text-center"><div class="spinner-border text-primary"></div></div>`;

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
    },

    closeModal() {
        document.getElementById('dj-modal-bg').classList.remove('show');
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
        // إعادة تحميل البيانات
        await this.load();
    },

    escape(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    },
};

// ربط تلقائي لتفعيل الموديول من القائمة الجانبية
window.DailyJournal = DailyJournal;
