/**
 * accounting_module.js
 * موديول المحاسبة والشؤون المالية - النسخة التجريبية (MVP)
 * يتضمن: الفواتير المستحقة، الخزينة اليومية، والإيرادات المتدرجة.
 */

// --- 1. هيكل البيانات الافتراضية (Mock JSON) ---

const AccountantData = {
    currentUser: {},

    // الفواتير المستحقة (الواردة من الطبيب)
    pending_invoices: [
        { 
            Invoice_id: "INV-5001", serial_number: "101", name: "محمد علي", sum: 3500, time: "08:35 AM",
            order: [{ name: "فحص دم CBC", price: 2500 }, { name: "سكر عشوائي", price: 1000 }]
        },
        { 
            Invoice_id: "INV-5002", serial_number: "102", name: "فاطمة أحمد", sum: 5000, time: "09:10 AM",
            order: [{ name: "أشعة صدر", price: 3500 }, { name: "مجارحة", price: 1500 }]
        }
    ],

    // تسلسل الفواتير حسب طلبك
    bill_sequencing: { full_payment_bills: 150, Exemption_bills: 20 },

    // المقبوضات (الخزينة اليومية)
    daily_receipts: [
        { Invoice_id: "INV-4990", name: "سالم عبدالله", amount: 2000, time: "07:30 AM", cashier: "علي عبدالله", type: "كاش" },
        { Invoice_id: "INV-4991", name: "يحيى صالح", amount: 1500, time: "08:00 AM", cashier: "علي عبدالله", type: "إعفاء جزئي" },
        { Invoice_id: "INV-4992", name: "عمر حسن", amount: 0, time: "08:15 AM", cashier: "علي عبدالله", type: "إعفاء كلي" }
    ],

    // إحصائيات الخزينة اليومية
    daily_stats: {
        total_full_exemption: 4000, count_full_exemption: 1,
        total_partial_exemption: 500, count_partial_exemption: 1,
        total_cash: 2000, count_cash: 1,
        total_payments: 3500 // (الكاش + المدفوع من الإعفاء الجزئي)
    },

    // بيانات الإيرادات المتدرجة (Drill-down Mock Data)
    revenues: {
        years: [
            { year: "2026", total_paid: 1500000, total_exempt: 50000, count_partial: 40, count_full: 15, count_cash: 300 }
        ],
        months: {
            "2026": [
                { month: "مارس", total_paid: 500000, total_exempt: 20000, count_partial: 15, count_full: 5, count_cash: 120 },
                { month: "فبراير", total_paid: 600000, total_exempt: 15000, count_partial: 10, count_full: 4, count_cash: 100 }
            ]
        },
        days: {
            "مارس-2026": [
                { day: "20", total_paid: 15000, total_exempt: 1000, count_partial: 2, count_full: 1, count_cash: 10 },
                { day: "19", total_paid: 20000, total_exempt: 500, count_partial: 1, count_full: 0, count_cash: 15 }
            ]
        }
    }
};

const Accountant = {

    // ==========================================
    // 1. الفواتير المستحقة (Pending Invoices)
    // ==========================================
    viewPendingInvoices: function() {
        Core.navigateTo('viewPendingInvoices', () => {
            const mainContent = document.getElementById('mainContent');
            const tools = [{ label: "تحديث القائمة", icon: "bi-arrow-repeat", action: "Accountant.loadPendingInvoices()" }];

            mainContent.innerHTML = `
                <div class="container-fluid p-0 animate-in">
                    ${Core.renderHeaderWithTools('الفواتير المستحقة', 'الفواتير بانتظار التحصيل وتسجيل الدفع.', tools)}
                    <div class="card stat-card p-0 border-0 shadow-sm" id="pendingInvoicesContainer">
                        <div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>
                    </div>
                </div>`;
            this.loadPendingInvoices();
        });
    },

    loadPendingInvoices: async function() {
        const container = document.getElementById('pendingInvoicesContainer');
        if (!container) return;

        container.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>`;

        // الاتصال الحقيقي بالسيرفر لجلب الفواتير
        const response = await Core.apiCall('accounting/pending', 'GET');

        if (response && response.success) {
            AccountantData.pending_invoices = response.data; // تحديث البيانات محلياً للنافذة المنبثقة
            const activeList = response.data;

            if (activeList.length === 0) {
                container.innerHTML = `<div class="p-5 text-center text-muted"><i class="bi bi-check-circle fs-1 text-success mb-3 d-block"></i>لا توجد فواتير معلقة حالياً.</div>`;
                return;
            }

            const headers = ["رقم الفاتورة", "المريض", "الإجمالي", "الوقت", "الإجراء"];
            const rows = activeList.map(inv => [
                `<span class="text-muted fw-bold">${inv.Invoice_id}</span>`,
                `<span class="fw-bold">${inv.name}</span>`,
                `<span class="fw-bold text-danger">${inv.sum} ريال</span>`,
                inv.time
            ]);

            Core.renderTable('pendingInvoicesContainer', headers, rows, (row, index) => {
                const inv = activeList[index];
                return `
                    <button class="btn btn-success btn-sm fw-bold px-3 shadow-sm" onclick="Accountant.openPaymentModal('${inv.Invoice_id}')">
                        <i class="bi bi-cash-coin ms-1"></i> تسديد الفاتورة
                    </button>`;
            });
        } else {
            container.innerHTML = `<div class="p-5 text-center text-danger"><i class="bi bi-exclamation-triangle fs-1 mb-3 d-block"></i>حدث خطأ أثناء جلب الفواتير.</div>`;
        }
    },
    
    openPaymentModal: async function(invoice_id) {
        const existing = document.getElementById('paymentModal');
        if (existing) existing.remove();

        const inv = AccountantData.pending_invoices.find(i => i.Invoice_id === invoice_id);
        if (!inv) return;

        // جلب الأرقام التسلسلية المتوقعة من السيرفر قبل فتح النافذة
        const serialsRes = await Core.apiCall('accounting/next_serials', 'GET');
        if (serialsRes && serialsRes.success) {
            AccountantData.next_serials = serialsRes.data;
        } else {
            AccountantData.next_serials = { 'A': '--', 'B': '--' };
        }

        const servicesList = inv.order.map(srv => `
            <div class="d-flex justify-content-between border-bottom pb-1 mb-1 small">
                <span>${srv.name}</span><span class="fw-bold">${srv.price} ريال</span>
            </div>`).join('');

        const modalHTML = `
        <div class="modal fade" id="paymentModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-dark text-white border-0 py-3">
                        <h5 class="modal-title fw-bold">تحصيل فاتورة: ${inv.Invoice_id}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-4 bg-light">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <div><span class="small text-muted">المريض: </span><span class="fw-bold fs-5">${inv.name}</span></div>
                            
                            <div class="bg-dark text-white px-3 py-1 rounded shadow-sm border border-secondary">
                                <span class="small opacity-75">سند رقم: </span><span id="dynamicSerialNumber" class="fw-bold fs-5 text-warning">--</span>
                            </div>
                        </div>

                        <div class="bg-white p-3 rounded border shadow-sm mb-3">
                            <h6 class="fw-bold text-primary small border-bottom pb-2">تفاصيل الخدمات:</h6>
                            ${servicesList}
                            <div class="d-flex justify-content-between mt-2 pt-2 border-top">
                                <span class="fw-bold">الإجمالي المطلوب:</span>
                                <span class="fw-bold text-danger fs-5" id="totalAmount" data-value="${inv.sum}">${inv.sum} ريال</span>
                            </div>
                        </div>

                        <div class="mb-3">
                            <label class="form-label fw-bold text-success">المبلغ المستلم من المريض (ريال):</label>
                            <input type="number" class="form-control form-control-lg shadow-sm border-success fw-bold text-center" 
                                   id="paidAmountInput" value="${inv.sum}" oninput="Accountant.calculateSmartDiscount()">
                            <div id="paymentLogicFeedback" class="mt-2 text-center small fw-bold"></div>
                        </div>
                    </div>
                    <div class="modal-footer border-0 bg-white">
                        <button class="btn btn-success px-5 fw-bold shadow-sm w-100 py-2" id="btnConfirmPayment" onclick="Accountant.processPayment('${inv.Invoice_id}')">تأكيد السداد والطباعة</button>
                    </div>
                </div>
            </div>
        </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        new bootstrap.Modal(document.getElementById('paymentModal')).show();
        this.calculateSmartDiscount(); 
    },

    calculateSmartDiscount: function() {
        const total = parseFloat(document.getElementById('totalAmount').getAttribute('data-value'));
        const paidInput = document.getElementById('paidAmountInput').value;
        const paid = paidInput === "" ? 0 : parseFloat(paidInput);
        
        const feedback = document.getElementById('paymentLogicFeedback');
        const btnConfirm = document.getElementById('btnConfirmPayment');
        const serialDisplay = document.getElementById('dynamicSerialNumber');
        const serials = AccountantData.next_serials;

        if (paid > total) {
            feedback.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle ms-1"></i>المبلغ المدخل أكبر من الإجمالي!</span>`;
            btnConfirm.disabled = true;
            serialDisplay.innerText = '--';
            serialDisplay.className = "fw-bold fs-5 text-danger";
        } 
        else if (paid === total) {
            feedback.innerHTML = `<span class="text-success"><i class="bi bi-check-circle ms-1"></i>دفع كامل (سند قبض كاش)</span>`;
            btnConfirm.disabled = false;
            feedback.setAttribute('data-doctype', 'A');
            feedback.setAttribute('data-exemption', '0');
            serialDisplay.innerText = serials['A']; // إظهار تسلسل الكاش
            serialDisplay.className = "fw-bold fs-5 text-success";
        } 
        else if (paid > 0 && paid < total) {
            const exemption = total - paid;
            feedback.innerHTML = `<span class="text-warning text-dark"><i class="bi bi-info-circle ms-1"></i>سند إعفاء جزئي (الخصم: ${exemption} ريال)</span>`;
            btnConfirm.disabled = false;
            feedback.setAttribute('data-doctype', 'B');
            feedback.setAttribute('data-exemption', exemption);
            serialDisplay.innerText = serials['B']; // إظهار تسلسل الإعفاء
            serialDisplay.className = "fw-bold fs-5 text-warning";
        } 
        else if (paid === 0) {
            feedback.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle ms-1"></i>سند إعفاء كلي (خصم 100%)</span>`;
            btnConfirm.disabled = false;
            feedback.setAttribute('data-doctype', 'C');
            feedback.setAttribute('data-exemption', total);
            serialDisplay.innerText = serials['B']; // تسلسل الإعفاء (موحد للجزئي والكلي)
            serialDisplay.className = "fw-bold fs-5 text-danger";
        }
    },

    processPayment: async function(invoice_id) {
        const paidAmount = parseFloat(document.getElementById('paidAmountInput').value) || 0;
        const feedback = document.getElementById('paymentLogicFeedback');
        const docType = feedback.getAttribute('data-doctype');
        const exemptionValue = parseFloat(feedback.getAttribute('data-exemption'));

        const payload = {
            Invoice_id: invoice_id,
            net_amount: paidAmount,
            doc_type: docType,
            exemption_value: exemptionValue
        };

        // إرسال البيانات للسيرفر (تنفيذ عملية الدفع وتوليد التسلسل النهائي)
        const response = await Core.apiCall('accounting/pay_invoice', 'POST', payload);

        if (response && response.success) {
            bootstrap.Modal.getInstance(document.getElementById('paymentModal')).hide();
            
            // إظهار تنبيه برقم السند المولد
            Core.showAlert(`تم السداد! رقم السند: ${response.serial_number}`, 'success');
            
            // تحديث الجدول لإخفاء الفاتورة المسددة
            this.loadPendingInvoices();
        } else {
            Core.showAlert(response ? response.message : 'حدث خطأ أثناء السداد', 'error');
        }
    },
  

    // ==========================================
    // 2. الخزينة اليومية (Daily Treasury)
    // ==========================================
    viewTreasury: async function(viewType = 'receipts') {
        Core.navigateTo('viewTreasury', async () => {
            const mainContent = document.getElementById('mainContent');
            
            // قائمة الأدوات
            const tools = [
                { label: "المقبوضات", icon: "bi-receipt", action: "Accountant.viewTreasury('receipts')" },
                { label: "الإحصائيات", icon: "bi-pie-chart", action: "Accountant.viewTreasury('stats')" },
                { label: "تحديث البيانات", icon: "bi-arrow-repeat", action: `Accountant.viewTreasury('${viewType}')` }
            ];

            // إظهار حالة التحميل
            mainContent.innerHTML = `
                <div class="container-fluid p-0 animate-in">
                    ${Core.renderHeaderWithTools('الخزينة اليومية', 'جاري جلب بيانات الخزينة...', tools)}
                    <div class="text-center p-5"><div class="spinner-border text-primary"></div></div>
                </div>`;

            // جلب البيانات من السيرفر
            const response = await Core.apiCall('accounting/daily_treasury', 'GET');
            
            if (response && response.success) {
                // حفظ البيانات محلياً لسهولة التبديل والفلترة
                AccountantData.daily_receipts = response.data.receipts;
                AccountantData.daily_stats = response.data.stats;
            } else {
                mainContent.innerHTML = `<div class="p-5 text-center text-danger">حدث خطأ أثناء جلب الخزينة.</div>`;
                return;
            }

            let contentHTML = '';

            if (viewType === 'receipts') {
                contentHTML = `
                    <div class="row g-3 mb-4">
                        <div class="col-md-6">
                            <input type="text" class="form-control shadow-sm border-0" id="receiptSearch" placeholder="بحث باسم المريض..." onkeyup="Accountant.filterReceipts()">
                        </div>
                        <div class="col-md-6">
                            <select class="form-select shadow-sm border-0" id="receiptFilter" onchange="Accountant.filterReceipts()">
                                <option value="الكل" selected>جميع العمليات</option>
                                <option value="كاش">كاش (سندات القبض)</option>
                                <option value="إعفاء جزئي">إعفاء جزئي</option>
                                <option value="إعفاء كلي">إعفاء كلي</option>
                            </select>
                        </div>
                    </div>
                    <div class="card stat-card p-0 border-0 shadow-sm" id="receiptsContainer"></div>`;
            } else {
                const s = AccountantData.daily_stats;
                contentHTML = `
                    <div class="row g-3">
                        <div class="col-md-4">
                            <div class="card stat-card p-4 border-start border-success border-4 shadow-sm">
                                <h6 class="text-muted small">إجمالي المدفوعات للخزينة</h6>
                                <h3 class="fw-bold text-success">${s.total_payments} ريال</h3>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="card stat-card p-4 shadow-sm">
                                <h6 class="text-muted small">المدفوع كاش (صافي)</h6>
                                <h4 class="fw-bold">${s.total_cash} <span class="fs-6 fw-normal text-muted">(${s.count_cash} سند)</span></h4>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="card stat-card p-4 shadow-sm">
                                <h6 class="text-muted small">إجمالي الإعفاءات الجزئية الممنوحة</h6>
                                <h4 class="fw-bold text-warning">${s.total_partial_exemption} <span class="fs-6 fw-normal text-muted">(${s.count_partial_exemption} سند)</span></h4>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="card stat-card p-4 border-start border-danger border-4 shadow-sm">
                                <h6 class="text-muted small">إجمالي الإعفاءات الكلية الممنوحة</h6>
                                <h4 class="fw-bold text-danger">${s.total_full_exemption} <span class="fs-6 fw-normal text-muted">(${s.count_full_exemption} سند)</span></h4>
                            </div>
                        </div>
                    </div>`;
            }

            mainContent.innerHTML = `
                <div class="container-fluid p-0 animate-in">
                    ${Core.renderHeaderWithTools('الخزينة اليومية', viewType === 'receipts' ? 'سجل العمليات المالية لليوم.' : 'ملخص إحصائي سريع للخزينة.', tools)}
                    ${contentHTML}
                </div>`;
            
            if (viewType === 'receipts') this.filterReceipts();
        });
    },

    filterReceipts: function() {
        const search = document.getElementById('receiptSearch')?.value.toLowerCase() || "";
        const filterType = document.getElementById('receiptFilter')?.value || "الكل";

        const filtered = AccountantData.daily_receipts.filter(r => {
            const matchName = r.name.toLowerCase().includes(search);
            const matchType = filterType === "الكل" ? true : r.type === filterType;
            return matchName && matchType;
        });

        const headers = ["الفاتورة الأساسية", "المريض", "المبلغ المحصل", "نوع السند", "الوقت", "المتحصل"];
        
        if (filtered.length === 0) {
            document.getElementById('receiptsContainer').innerHTML = `<div class="p-4 text-center text-muted">لا توجد عمليات تطابق البحث.</div>`;
            return;
        }

        const rows = filtered.map(r => [
            `<span class="text-muted fw-bold">INV-${r.Invoice_id}</span>`,
            `<span class="fw-bold">${r.name}</span>`,
            `<span class="fw-bold ${r.amount > 0 ? 'text-success' : 'text-danger'}">${r.amount}</span>`,
            `<span class="badge ${r.type === 'كاش' ? 'bg-success' : (r.type === 'إعفاء كلي' ? 'bg-danger' : 'bg-warning')} bg-opacity-10 text-dark px-2">${r.type}</span>`,
            r.time,
            r.cashier
        ]);

        Core.renderTable('receiptsContainer', headers, rows, () => {
             // يمكننا لاحقاً إضافة زر لطباعة السند مرة أخرى من هنا
            return `<button class="btn btn-outline-dark btn-sm fw-bold px-3 shadow-sm"><i class="bi bi-printer ms-1"></i> طباعة</button>`;
        });
    },
        // ==========================================
    // 3. الإيرادات المتدرجة والبحث المالي (Drill-down & Deep Search)
    // ==========================================
    
    // متغير مؤقت لتخزين البيانات الحالية الجاهزة للتصدير
    currentExportData: { title: "الإيرادات", headers: [], rows: [] },

    viewRevenues: function() {
        Core.navigateTo('viewRevenues', () => {
            const mainContent = document.getElementById('mainContent');
            
            mainContent.innerHTML = `
                <div class="container-fluid p-0 animate-in">
                    <div id="revenuesHeaderContainer"></div> 
                    
                    <div class="card stat-card p-3 mb-4 border-0 shadow-sm bg-white">
                        <div class="input-group input-group-lg">
                            <span class="input-group-text bg-light border-end-0"><i class="bi bi-search text-primary"></i></span>
                            <input type="text" class="form-control border-start-0 shadow-none bg-light" 
                                   placeholder="بحث مالي عميق (اسم المريض، رقم الفاتورة الأساسي، أو رقم السند)..." 
                                   id="financialSearchInput" onkeyup="Accountant.handleFinancialSearch()">
                        </div>
                    </div>
                    
                    <div id="revenuesContainer">
                        <div class="text-center p-5"><div class="spinner-border text-primary"></div></div>
                    </div>
                </div>`;
            
            // البداية دائماً من مستوى السنوات
            this.loadRevenues('years');
        });
    },

    // مؤقت لمنع إرسال طلبات كثيرة للسيرفر أثناء الكتابة (Debounce)
    financialSearchTimeout: null,
    handleFinancialSearch: function() {
        clearTimeout(this.financialSearchTimeout);
        this.financialSearchTimeout = setTimeout(() => {
            const query = document.getElementById('financialSearchInput').value.trim();
            if (query.length > 0) {
                // اختراق التدرج والبحث العميق
                this.loadRevenues('search', null, query);
            } else {
                // العودة للوضع الطبيعي إذا تم مسح مربع البحث
                this.loadRevenues('years'); 
            }
        }, 400);
    },

    loadRevenues: async function(level = 'years', filterValue = null, query = null) {
        const container = document.getElementById('revenuesContainer');
        container.innerHTML = `<div class="card stat-card p-0 border-0 shadow-sm"><div class="text-center p-5"><div class="spinner-border text-primary"></div></div></div>`;

        // استدعاء السيرفر (المسار الذي برمجناه مسبقاً)
        const response = await Core.apiCall('accounting/revenues_drilldown', 'POST', { level, filterValue, query });

        if (!response || !response.success) {
            container.innerHTML = `<div class="p-5 text-center text-danger">حدث خطأ أثناء جلب الإيرادات.</div>`;
            return;
        }

        const data = response.data;
        const actualLevel = response.level; 

        let title = "الإيرادات";
        let tools = [{ label: "تصدير إلى Excel", icon: "bi-file-earmark-excel text-success", action: "Accountant.exportToExcel()" }];
        
        let headers = [];
        let rows = [];
        let exportRows = []; // البيانات الخام الخالية من الـ HTML الجاهزة للتصدير

        // دالة مساعدة لتلوين نصوص البحث
        const highlightText = (text, q) => {
            if (!q || !text) return text || '--';
            const regex = new RegExp(`(${q})`, 'gi');
            return text.toString().replace(regex, '<mark class="bg-warning px-1 rounded">$1</mark>');
        };

        if (data.length === 0) {
            container.innerHTML = `<div class="p-5 text-center text-muted">لا توجد بيانات مطابقة.</div>`;
            document.getElementById('revenuesHeaderContainer').innerHTML = Core.renderHeaderWithTools("لا توجد نتائج", "", tools);
            return;
        }

        // --- معالجة البيانات حسب المستوى ---
        if (actualLevel === 'years') {
            title = "الإيرادات المجمعة (بالسنوات)";
            headers = ["السنة", "إجمالي المدفوعات", "إجمالي الإعفاءات", "سندات كاش", "إعفاء جزئي", "إعفاء كلي", "الإجراء"];
            rows = data.map(d => [
                `<span class="fw-bold text-primary">${d.year_val}</span>`,
                `<span class="fw-bold text-success">${d.total_paid || 0}</span>`,
                `<span class="text-danger">${d.total_exempt || 0}</span>`,
                d.count_cash, d.count_partial, d.count_full,
                `<button class="btn btn-primary btn-sm fw-bold px-3 shadow-sm" onclick="Accountant.loadRevenues('months', '${d.year_val}')"><i class="bi bi-list-nested ms-1"></i> عرض الشهور</button>`
            ]);
            exportRows = data.map(d => [d.year_val, d.total_paid||0, d.total_exempt||0, d.count_cash, d.count_partial, d.count_full]);
        } 
        else if (actualLevel === 'months') {
            title = `الإيرادات الشهرية لسنة ${filterValue}`;
            tools.unshift({ label: "عودة للسنوات", icon: "bi-arrow-right", action: "Accountant.loadRevenues('years')" });
            headers = ["الشهر", "إجمالي المدفوعات", "إجمالي الإعفاءات", "سندات كاش", "إعفاء جزئي", "إعفاء كلي", "الإجراء"];
            
            const monthNames = ["", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
            rows = data.map(d => {
                const mName = monthNames[parseInt(d.month_val)] || d.month_val;
                return [
                    `<span class="fw-bold text-primary">${mName}</span>`,
                    `<span class="fw-bold text-success">${d.total_paid || 0}</span>`,
                    `<span class="text-danger">${d.total_exempt || 0}</span>`,
                    d.count_cash, d.count_partial, d.count_full,
                    `<button class="btn btn-primary btn-sm fw-bold px-3 shadow-sm" onclick="Accountant.loadRevenues('days', '${filterValue}-${d.month_val}')"><i class="bi bi-list-nested ms-1"></i> عرض الأيام</button>`
                ];
            });
            exportRows = data.map(d => [monthNames[parseInt(d.month_val)] || d.month_val, d.total_paid||0, d.total_exempt||0, d.count_cash, d.count_partial, d.count_full]);
        }
        else if (actualLevel === 'days') {
            title = `الإيرادات اليومية لشهر ${filterValue}`;
            const parentYear = filterValue.split('-')[0];
            tools.unshift({ label: "عودة للشهور", icon: "bi-arrow-right", action: `Accountant.loadRevenues('months', '${parentYear}')` });
            headers = ["اليوم", "إجمالي المدفوعات", "إجمالي الإعفاءات", "سندات كاش", "إعفاء جزئي", "إعفاء كلي", "الإجراء"];
            
            rows = data.map(d => [
                `<span class="fw-bold text-primary">${d.day_val}</span>`,
                `<span class="fw-bold text-success">${d.total_paid || 0}</span>`,
                `<span class="text-danger">${d.total_exempt || 0}</span>`,
                d.count_cash, d.count_partial, d.count_full,
                `<button class="btn btn-primary btn-sm fw-bold px-3 shadow-sm" onclick="Accountant.loadRevenues('details', '${filterValue}-${d.day_val}')"><i class="bi bi-list-nested ms-1"></i> تفاصيل اليوم</button>`
            ]);
            exportRows = data.map(d => [d.day_val, d.total_paid||0, d.total_exempt||0, d.count_cash, d.count_partial, d.count_full]);
        }
        else if (actualLevel === 'details' || actualLevel === 'search') {
            // حفظ البيانات محلياً لكي نستخدمها عند النقر على "التفاصيل"
            AccountantData.drilldown_invoices = data; 

            if (actualLevel === 'search') {
                title = `نتائج البحث المالي عن: "${query}"`;
                tools.unshift({ label: "إلغاء البحث", icon: "bi-x-circle", action: "document.getElementById('financialSearchInput').value=''; Accountant.loadRevenues('years');" });
            } else {
                title = `التفاصيل المالية ليوم ${filterValue}`;
                const parentMonth = filterValue.substring(0, 7); 
                tools.unshift({ label: "عودة للأيام", icon: "bi-arrow-right", action: `Accountant.loadRevenues('days', '${parentMonth}')` });
            }

            // --- الإضافة: أضفنا عمود 'الإجراء' ---
            headers = ["الفاتورة", "التسلسل", "المريض", "المدفوع", "الإعفاء", "الوقت", "المتحصل", "الإجراء"];
            rows = data.map(d => [
                `<span class="text-muted fw-bold">INV-${highlightText(d.invoice_id.toString(), query)}</span>`,
                `<span class="badge bg-secondary">${highlightText(d.serial_number || '--', query)}</span>`,
                `<span class="fw-bold">${highlightText(d.name, query)}</span>`,
                `<span class="fw-bold text-success">${d.net_amount}</span>`,
                `<span class="text-danger text-opacity-75">${d.exemption_value}</span>`,
                d.time, d.cashier,
                // --- الإضافة: زر التفاصيل ---
                `<button class="btn btn-outline-primary btn-sm fw-bold px-3 shadow-sm" onclick="Accountant.showInvoiceDetails('${d.invoice_id}')"><i class="bi bi-eye ms-1"></i> التفاصيل</button>`
            ]);
            exportRows = data.map(d => [`INV-${d.invoice_id}`, d.serial_number||'--', d.name, d.net_amount, d.exemption_value, d.time, d.cashier]);
        }
        // --- تجهيز بيانات التصدير ---
        // نزيل عمود "الإجراء" من الإكسل لأنه لا معنى له في الورق
        const exportHeaders = (actualLevel !== 'details' && actualLevel !== 'search') ? headers.slice(0, -1) : headers;
        this.currentExportData = { 
            title: title.replace(/<[^>]*>?/gm, ''), // تنظيف العنوان من التاجات
            headers: exportHeaders, 
            rows: exportRows 
        };

        // رسم الواجهة
        document.getElementById('revenuesHeaderContainer').innerHTML = Core.renderHeaderWithTools(title, 'تتبع وتدقيق الإيرادات والعمليات المالية.', tools);
        container.innerHTML = `<div class="card stat-card p-0 border-0 shadow-sm" id="revenuesTableContainer"></div>`;
        Core.renderTable('revenuesTableContainer', headers, rows);
    },
    // دالة لعرض تفاصيل الفاتورة الطبية والمالية
    showInvoiceDetails: function(invoice_id) {
        const existing = document.getElementById('invoiceDetailsModal');
        if (existing) existing.remove();

        // جلب الفاتورة من البيانات المحفوظة محلياً
        const inv = (AccountantData.drilldown_invoices || []).find(i => i.invoice_id == invoice_id);
        if (!inv) return;

        // تجهيز قائمة الخدمات
        let servicesHTML = '';
        if (inv.services && inv.services.length > 0) {
            servicesHTML = inv.services.map(s => `
                <div class="d-flex justify-content-between border-bottom pb-2 mb-2">
                    <span class="text-dark fw-bold"><i class="bi bi-check2-circle text-success ms-1"></i>${s.name}</span>
                    <span class="text-primary fw-bold">${s.price} ريال</span>
                </div>
            `).join('');
        } else {
            servicesHTML = `<div class="text-muted small text-center p-3">لا توجد تفاصيل مسجلة لهذه الفاتورة.</div>`;
        }

        const totalAmount = parseFloat(inv.net_amount) + parseFloat(inv.exemption_value);

        const modalHTML = `
        <div class="modal fade" id="invoiceDetailsModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-dark text-white border-0 py-3">
                        <h5 class="modal-title fw-bold">البيان التفصيلي للفاتورة: INV-${inv.invoice_id}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-4 bg-light">
                        <div class="d-flex justify-content-between align-items-center mb-4">
                            <div><span class="small text-muted">المريض: </span><span class="fw-bold fs-5">${inv.name}</span></div>
                            <div class="bg-white px-3 py-1 rounded shadow-sm border border-secondary">
                                <span class="small opacity-75">سند رقم: </span><span class="fw-bold fs-5 text-dark">${inv.serial_number || '--'}</span>
                            </div>
                        </div>

                        <div class="bg-white p-3 rounded border shadow-sm mb-4">
                            <h6 class="fw-bold text-secondary small border-bottom pb-2 mb-3">الخدمات الطبية المقدمة:</h6>
                            ${servicesHTML}
                            <div class="d-flex justify-content-between mt-3 pt-2 border-top">
                                <span class="fw-bold text-muted">الإجمالي العام (قبل الخصم):</span>
                                <span class="fw-bold fs-5">${totalAmount} ريال</span>
                            </div>
                        </div>
                        
                        <div class="row g-2 text-center">
                            <div class="col-6">
                                <div class="bg-success bg-opacity-10 p-2 rounded border border-success h-100">
                                    <span class="d-block small text-success fw-bold">المدفوع للخزينة (صافي)</span>
                                    <span class="fs-4 fw-bold text-success">${inv.net_amount}</span>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="bg-danger bg-opacity-10 p-2 rounded border border-danger h-100">
                                    <span class="d-block small text-danger fw-bold">مقدار الإعفاء / الخصم</span>
                                    <span class="fs-4 fw-bold text-danger">${inv.exemption_value}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer border-0 bg-white">
                        <div class="w-100 text-start small text-muted">
                            <i class="bi bi-person ms-1"></i> المتحصل: <b>${inv.cashier}</b> | <i class="bi bi-clock ms-1"></i> الوقت: <b>${inv.time}</b>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        new bootstrap.Modal(document.getElementById('invoiceDetailsModal')).show();
    },

    // دالة التصدير إلى Excel
    exportToExcel: function() {
        if (typeof XLSX === 'undefined') {
            return Core.showAlert("مكتبة SheetJS غير محملة. تحقق من اتصال الإنترنت.", "error");
        }
        
        const { title, headers, rows } = this.currentExportData;
        if(rows.length === 0) return Core.showAlert("لا توجد بيانات لتصديرها", "warning");

        // دمج الترويسات مع البيانات الخام
        const worksheetData = [headers, ...rows];
        
        // إنشاء ورقة العمل والمصنف
        const ws = XLSX.utils.aoa_to_sheet(worksheetData);
        ws['!dir'] = 'rtl'; // دعم اللغة العربية (من اليمين لليسار) في الإكسل

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "التقرير المالي");

        // توليد اسم الملف بناءً على العنوان والتاريخ
        const fileName = `${title}_${new Date().toISOString().slice(0,10)}.xlsx`;
        
        // تحميل الملف
        XLSX.writeFile(wb, fileName);
    }

  
};
loading()
// --- التهيئة عند تحميل الموديول ---
 async function loading(){
    // محاكاة تسجيل الدخول للمحاسب
    const response = await Core.apiCall('auth/me', 'GET');
    if(response && response.success) {
        AccountantData.currentUser = response.data;
        Core.renderProfile(AccountantData.currentUser);
    }

    const accountingLinks = [
        { title: "الفواتير المستحقة", icon: "bi-receipt-cutoff", url: "javascript:void(0)", action: "Accountant.viewPendingInvoices()", active: true },
        { title: "الخزينة اليومية", icon: "bi-safe", url: "javascript:void(0)", action: "Accountant.viewTreasury('receipts')" },
        { title: "الإيرادات", icon: "bi-graph-up-arrow", url: "javascript:void(0)", action: "Accountant.viewRevenues('years')" }
    ];
    Core.renderSidebar(accountingLinks);
    Core.initNotifications();
    
    // تشغيل الواجهة الافتراضية
    Accountant.viewPendingInvoices();
}