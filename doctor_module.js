/**
 * doctor_module.js
 * موديول الطبيب العام - الإصدار الثاني
 *
 * تحديثات هذه النسخة:
 *   1) تقييد فتح أكثر من زيارة نشطة لنفس المريض (رسالة عربية واضحة).
 *   2) حذف إصدار التذاكر اليدوي - أصبحت التذكرة تُصدر تلقائياً مع الزيارة.
 *   3) نافذة "إغلاق الزيارة" الجديدة:
 *        - تصميم مطابق لنموذج "تذكرة المعاينة" الورقي.
 *        - تعبئة تلقائية لبيانات المريض والطبيب.
 *        - حقول إجبارية: التشخيص النهائي + الملاحظات.
 *        - حقل العيادة اختياري.
 *        - زر طباعة مباشر (Print-Friendly).
 *        - ترويسة ديناميكية تُجلب من system_settings عبر settings/header.
 */

const DoctorData = {
    currentUser: {},

    waiting_list: [],
    data_patients: [],
    sent_orders: [],

    caseTypes: ["طوارئ باطنية", "تسمم", "سقوط", "حوادث سير", "حروق", "نوبة قلبية", "ضيق تنفس", "إصابة عمل", "نزيف", "أخرى"],
    districts: ["السبعين", "الوحدة", "عمران", "التحرير", "بني الحارث"],
    availableServices: [],

    // إعدادات الترويسة الديناميكية (تُجلب من السيرفر مرة واحدة عند الإقلاع)
    headerSettings: null
};

const Doctor = {

    // ============================================================
    // 1) واجهة: حالة جديدة (New Case)
    // ============================================================
    viewNewCase: function() {
        Core.navigateTo('viewNewCase', () => {
            const mainContent = document.getElementById('mainContent');
            const tools = [
                { label: "تحديث الصفحة", icon: "bi-arrow-clockwise", action: "Doctor.viewNewCase()" }
            ];

            mainContent.innerHTML = `
                <div class="container-fluid p-0 animate-in">
                    ${Core.renderHeaderWithTools('حالة جديدة', 'ابحث عن مريض لفتح زيارة أو أضف مريضاً جديداً.', tools)}

                    <div class="card stat-card p-4 mb-4 border-0 shadow-sm">
                        <div class="input-group input-group-lg">
                            <span class="input-group-text bg-white border-start-0"><i class="bi bi-search text-primary"></i></span>
                            <input type="text" class="form-control border-end-0 shadow-none"
                                   placeholder="بحث ذكي بالاسم، أو أجزاء متفرقة من الاسم..." id="patientSearchInput" onkeyup="Doctor.handleSearchInput()">
                        </div>
                    </div>

                    <div id="searchResultArea">
                        <div class="text-center p-5 text-muted bg-white rounded-4 shadow-sm border">
                            <i class="bi bi-search fs-1 mb-3 d-block text-secondary"></i>
                            <p>أدخل اسم المريض للبحث في قاعدة البيانات.</p>
                        </div>
                    </div>
                </div>`;
        });
    },

    searchTimeout: null,
    handleSearchInput: function() {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.executeSearch(), 400);
    },

    executeSearch: async function() {
        const query = document.getElementById('patientSearchInput').value.trim();
        const resultArea = document.getElementById('searchResultArea');

        if (query.length < 2) {
            resultArea.innerHTML = `<div class="text-center p-5 text-muted bg-white rounded-4 shadow-sm border"><i class="bi bi-search fs-1 mb-3 d-block text-secondary"></i><p>أدخل اسم المريض للبحث في قاعدة البيانات.</p></div>`;
            return;
        }

        resultArea.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>`;
        const response = await Core.apiCall('doctor/search_patient', 'POST', { query });

        if (response && response.success) {
            const results = response.data;
            if (results.length > 0) {
                const headers = ['اسم المريض', 'العنوان', 'معلومات'];
                const keywords = query.split(/\s+/).filter(kw => kw.length > 0);
                const highlightText = (text) => {
                    let highlighted = text;
                    keywords.forEach(kw => {
                        const regex = new RegExp(`(${kw})`, 'gi');
                        highlighted = highlighted.replace(regex, '<mark class="bg-warning px-1 rounded">$1</mark>');
                    });
                    return highlighted;
                };

                const rows = results.map(p => {
                    // 🚨 لو لدى المريض زيارة نشطة نُظهر شارة تحذيرية واضحة بالإضافة لعدد الزيارات السابقة.
                    let infoBadges = `<span class="badge bg-light text-dark border">زيارات سابقة: ${p.visit_num}</span>`;
                    if (p.has_active_visit) {
                        const doctorName = p.active_visit_doctor ? ` (د. ${this._escapeHtml(p.active_visit_doctor)})` : '';
                        infoBadges += ` <span class="badge bg-danger ms-1" title="يوجد لدى المريض زيارة مفتوحة - يجب إغلاقها أولاً"><i class="bi bi-exclamation-triangle-fill ms-1"></i> زيارة مفتوحة${doctorName}</span>`;
                    }
                    return [
                        `<span class="fw-bold">${highlightText(p.full_name)}</span>`,
                        `${p.place1} / ${p.place2}`,
                        infoBadges
                    ];
                });

                resultArea.innerHTML = `<div class="card stat-card p-0 border-0 shadow-sm" id="patientTableContainer"></div>`;
                Core.renderTable('patientTableContainer', headers, rows, (row, index) => {
                    const p = results[index];
                    // 🚫 إن كانت هناك زيارة نشطة - نعطل زر فتح زيارة ونجبر الطبيب على إغلاق السابقة أولاً
                    if (p.has_active_visit) {
                        const visitFormatted = 'VIS-' + p.active_visit_id;
                        return `
                            <button class="btn btn-outline-danger btn-sm fw-bold px-3 shadow-sm" disabled title="لا يمكن فتح زيارة جديدة - الزيارة السابقة ما زالت مفتوحة">
                                <i class="bi bi-lock-fill ms-1"></i> زيارة مفتوحة
                            </button>
                            <button class="btn btn-success btn-sm fw-bold px-3 shadow-sm ms-1" onclick="Doctor.openCloseVisitModal('${visitFormatted}')">
                                <i class="bi bi-check2 ms-1"></i> إغلاق الزيارة السابقة
                            </button>`;
                    }
                    return `
                        <button class="btn btn-primary btn-sm fw-bold px-3 shadow-sm" onclick="Doctor.openVisitModal('${p.patient_id}', '${(p.full_name || '').replace(/'/g, "\\'")}')">
                            <i class="bi bi-door-open ms-1"></i> فتح زيارة
                        </button>`;
                });
            } else {
                resultArea.innerHTML = `
                    <div class="alert alert-warning p-4 border-0 shadow-sm d-flex flex-column flex-md-row justify-content-between align-items-center">
                        <div class="mb-3 mb-md-0"><i class="bi bi-person-exclamation fs-3 ms-3"></i><span class="fw-bold">المريض غير مسجل مسبقاً.</span></div>
                        <button class="btn btn-warning fw-bold px-4 shadow-sm" onclick="Doctor.openNewPatientModal('${query.replace(/'/g, "\\'")}')">
                            <i class="bi bi-person-plus-fill ms-1"></i> إضافة مريض جديد
                        </button>
                    </div>`;
            }
        } else {
            resultArea.innerHTML = `<div class="alert alert-danger">حدث خطأ أثناء البحث.</div>`;
        }
    },

    openNewPatientModal: function(searchedName) {
        const existing = document.getElementById('newPatientModal');
        if (existing) existing.remove();

        const caseOptions = DoctorData.caseTypes.map(c => `<option value="${c}">${c}</option>`).join('');

        const modalHTML = `
        <div class="modal fade" id="newPatientModal" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable modal-fullscreen-sm-down">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-warning text-dark border-0">
                        <h5 class="modal-title fw-bold"><i class="bi bi-person-plus-fill me-2"></i>إضافة مريض وفتح زيارة</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-4 bg-light">
                        <div class="row g-3">
                            <div class="col-md-6"><label class="form-label small fw-bold">الاسم</label><input type="text" id="np_name" class="form-control shadow-none" value="${searchedName}"></div>
                            <div class="col-md-3 col-6"><label class="form-label small fw-bold">العمر</label><input type="number" id="np_age" class="form-control shadow-none"></div>
                            <div class="col-md-3 col-6"><label class="form-label small fw-bold">الجنس</label><select id="np_gender" class="form-select shadow-none"><option value="ذكر">ذكر</option><option value="أنثى">أنثى</option></select></div>
                            <div class="col-md-6"><label class="form-label small fw-bold">المديرية</label><input type="text" id="np_place1" class="form-control shadow-none" placeholder="اكتب اسم المديرية"></div>
                            <div class="col-md-6"><label class="form-label small fw-bold">الحي</label><input type="text" id="np_place2" class="form-control shadow-none"></div>

                            <div class="col-12 mt-3"><hr></div>
                            <div class="col-md-6"><label class="form-label small fw-bold text-danger">نوع الحالة</label><select id="np_type_case" class="form-select shadow-none">${caseOptions}</select></div>
                            <div class="col-md-6"><label class="form-label small fw-bold text-primary">التشخيص المبدئي</label><input type="text" id="np_diagnosis" class="form-control shadow-none"></div>
                            <div class="col-12"><label class="form-label small fw-bold">ملاحظة</label><textarea id="np_note" class="form-control shadow-none" rows="2"></textarea></div>
                        </div>
                        <div class="alert alert-info small mt-3 mb-0">
                            <i class="bi bi-info-circle ms-1"></i>
                            سيتم إصدار تذكرة معاينة (صباحية/مسائية حسب الوقت الحالي) تلقائياً عند حفظ الزيارة.
                        </div>
                    </div>
                    <div class="modal-footer border-0 flex-wrap gap-2">
                        <button type="button" class="btn btn-outline-secondary fw-bold" data-bs-dismiss="modal">إلغاء</button>
                        <button class="btn btn-warning px-4 fw-bold shadow-sm" onclick="Core.guard(this, () => Doctor.saveNewPatient())">حفظ وفتح الزيارة</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        new bootstrap.Modal(document.getElementById('newPatientModal')).show();
    },

    saveNewPatient: async function() {
        const payload = {
            name: document.getElementById('np_name').value,
            age: document.getElementById('np_age').value,
            gender: document.getElementById('np_gender').value,
            place1: document.getElementById('np_place1').value,
            place2: document.getElementById('np_place2').value,
            type_case: document.getElementById('np_type_case').value,
            diagnosis: document.getElementById('np_diagnosis').value,
            note: document.getElementById('np_note').value
        };

        const response = await Core.apiCall('doctor/new_patient', 'POST', payload);
        if (response && response.success) {
            bootstrap.Modal.getInstance(document.getElementById('newPatientModal')).hide();
            Core.showAlert(response.message || 'تم تسجيل المريض وفتح الزيارة بنجاح', 'success');
            document.getElementById('patientSearchInput').value = '';
            document.getElementById('searchResultArea').innerHTML = '';
        } else {
            Core.showAlert(response ? response.message : 'حدث خطأ أثناء تسجيل المريض', 'error');
        }
    },

    openVisitModal: function(id_pat, name) {
        const existing = document.getElementById('openVisitModal');
        if (existing) existing.remove();

        const caseOptions = DoctorData.caseTypes.map(c => `<option value="${c}">${c}</option>`).join('');

        const modalHTML = `
        <div class="modal fade" id="openVisitModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-primary text-white border-0">
                        <h5 class="modal-title fw-bold">فتح زيارة: ${name}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-4 bg-light">
                        <div class="mb-3"><label class="form-label small fw-bold text-danger">نوع الحالة</label><select id="v_type_case" class="form-select shadow-none">${caseOptions}</select></div>
                        <div class="mb-3"><label class="form-label small fw-bold text-primary">التشخيص المبدئي</label><input type="text" id="v_diagnosis" class="form-control shadow-none"></div>
                        <div class="mb-3"><label class="form-label small fw-bold">ملاحظة</label><textarea id="v_note" class="form-control shadow-none" rows="2"></textarea></div>
                        <div class="alert alert-info small mb-0">
                            <i class="bi bi-info-circle ms-1"></i>
                            سيتم إصدار تذكرة معاينة (صباحية/مسائية) تلقائياً عند حفظ الزيارة.
                        </div>
                    </div>
                    <div class="modal-footer border-0">
                        <button class="btn btn-primary px-5 fw-bold shadow-sm" onclick="Core.guard(this, () => Doctor.saveExistingPatientVisit('${id_pat}'))">حفظ وفتح الزيارة</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        new bootstrap.Modal(document.getElementById('openVisitModal')).show();
    },

    saveExistingPatientVisit: async function(id_pat) {
        const payload = {
            id_pat: id_pat,
            type_case: document.getElementById('v_type_case').value,
            diagnosis: document.getElementById('v_diagnosis').value,
            note: document.getElementById('v_note').value
        };

        const response = await Core.apiCall('doctor/existing_patient_visit', 'POST', payload);
        if (response && response.success) {
            bootstrap.Modal.getInstance(document.getElementById('openVisitModal')).hide();
            Core.showAlert(response.message || 'تم فتح الزيارة بنجاح', 'success');
        } else {
            // إبراز رسالة الخطأ بشكل واضح (خاصة قيد الزيارة النشطة الواحدة)
            Core.showAlert(response ? response.message : 'حدث خطأ أثناء فتح الزيارة', 'warning');
        }
    },

    // ============================================================
    // 2) واجهة: قائمة الانتظار (Waiting List)
    // ============================================================
    viewWaitingList: function() {
        Core.navigateTo('viewWaitingList', () => {
            const mainContent = document.getElementById('mainContent');
            const tools = [
                { label: "تحديث القائمة", icon: "bi-arrow-repeat", action: "Doctor.loadWaitingList()" }
            ];

            mainContent.innerHTML = `
                <div class="container-fluid p-0 animate-in">
                    ${Core.renderHeaderWithTools('قائمة الانتظار', 'المرضى بانتظار المعاينة وإصدار الطلبات أو التشخيص النهائي.', tools)}
                    <div class="card stat-card p-0 border-0 shadow-sm" id="waitingListContainer">
                        <div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>
                    </div>
                </div>`;
            this.loadWaitingList();
        });
    },

    loadWaitingList: async function() {
        const container = document.getElementById('waitingListContainer');
        if (!container) return;

        container.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>`;
        const response = await Core.apiCall('doctor/waiting_list', 'GET');

        if (response && response.success) {
            const activeList = response.data;
            if (activeList.length === 0) {
                container.innerHTML = `<div class="p-5 text-center text-muted"><i class="bi bi-check-circle fs-1 text-success mb-3 d-block"></i>لا توجد حالات في قائمة الانتظار حالياً.</div>`;
                return;
            }

            const headers = ["التذكرة", "المريض", "الحالة", "الوقت", "الإجراء"];
            const rows = activeList.map(item => {
                const typeIcon = item.ticket_type === 'morning' ? 'bi-sun text-warning' : 'bi-moon-stars text-info';
                const ticketBadge = item.ticket_serial
                    ? `<span class="badge bg-info bg-opacity-10 text-info fw-bold px-3 py-2"><i class="bi ${typeIcon} ms-1"></i> T-${item.ticket_serial}</span>`
                    : `<span class="badge bg-secondary bg-opacity-10 text-secondary">بدون</span>`;
                return [
                    ticketBadge,
                    `<span class="fw-bold text-dark">${item.name}</span>`,
                    `<span class="badge bg-warning bg-opacity-10 text-warning px-3">${item.type_case}</span>`,
                    item.time
                ];
            });

            Core.renderTable('waitingListContainer', headers, rows, (row, index) => {
                const item = activeList[index];
                // ⚠️ ملاحظة مهمة: تم حذف زر "تذكرة" - التذكرة تُصدر تلقائياً عند فتح الزيارة.
                return `
                    <div class="d-flex gap-1 flex-wrap">
                        <button class="btn btn-outline-primary btn-sm fw-bold shadow-sm" onclick="Doctor.openOrdersModal('${item.visit}', '${(item.name || '').replace(/'/g, "\\'")}')"><i class="bi bi-file-medical ms-1"></i> طلبات</button>
                        <button class="btn btn-success btn-sm fw-bold shadow-sm" onclick="Doctor.openCloseVisitModal('${item.visit}')"><i class="bi bi-check2 ms-1"></i> إغلاق الزيارة</button>
                    </div>`;
            });
        } else {
            container.innerHTML = `<div class="p-5 text-center text-danger"><i class="bi bi-exclamation-triangle fs-1 mb-3 d-block"></i>حدث خطأ أثناء جلب قائمة الانتظار.</div>`;
        }
    },

    // ============================================================
    // 3) نافذة إغلاق الزيارة الجديدة (Examination Ticket Modal)
    // ============================================================
    /**
     * يفتح نافذة الإغلاق المصممة على غرار "تذكرة المعاينة" الورقية.
     * - يجلب بيانات المريض والطبيب من السيرفر.
     * - يجلب إعدادات الترويسة (مخزّنة محلياً بعد أول طلب).
     * - يدعم الطباعة وحفظ الإغلاق مع التشخيص النهائي والملاحظات.
     */
    openCloseVisitModal: async function(visitFormatted) {
        // visitFormatted قد يكون "VIS-55" - نستخرج الرقم
        const visitId = String(visitFormatted).replace(/\D+/g, '');
        if (!visitId) return Core.showAlert('معرف زيارة غير صالح', 'error');

        // إظهار loading toast
        Core.showAlert('جاري تحضير نموذج إغلاق الزيارة...', 'info');

        const response = await Core.apiCall('doctor/visit_close_data', 'POST', { id_vis: visitId });
        if (!response || !response.success) {
            return Core.showAlert(response ? response.message : 'تعذر جلب بيانات الزيارة', 'error');
        }

        const data = response.data;
        // حفظ إعدادات الترويسة محلياً
        DoctorData.headerSettings = data.header || DoctorData.headerSettings;

        this._renderCloseVisitModal(visitId, data);
    },

    _renderCloseVisitModal: function(visitId, data) {
        const existing = document.getElementById('closeVisitModal');
        if (existing) existing.remove();

        const h = data.header || {};
        const safe = (value) => this._escapeHtml(value ?? '');
        const today = new Date();
        const dateStr = today.toLocaleDateString('en-GB'); // dd/mm/yyyy
        const hijriStr = (() => {
            try {
                return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                }).format(today).replace(/هـ?$/, '').trim();
            } catch (e) { return ''; }
        })();

        const ticketSerial = data.ticket_serial ? String(data.ticket_serial).padStart(4, '0') : '----';
        const ticketTypeAr = data.ticket_type === 'morning' ? 'صباحية' : (data.ticket_type === 'evening' ? 'مسائية' : '');
        const ticketTypeColor = data.ticket_type === 'morning' ? '#f59e0b' : (data.ticket_type === 'evening' ? '#6366f1' : '#6c757d');

        const modalHTML = `
        <div class="modal fade" id="closeVisitModal" tabindex="-1" aria-modal="true">
            <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable modal-fullscreen-lg-down">
                <div class="modal-content border-0 shadow-lg">

                    <div class="modal-header text-white border-0 py-3 d-print-none" style="background: linear-gradient(135deg, #198754 0%, #0f766e 100%);">
                        <div>
                            <h5 class="modal-title fw-bold d-flex align-items-center gap-2 mb-1">
                                <i class="bi bi-clipboard2-check fs-4"></i>
                                <span>إغلاق الزيارة</span>
                            </h5>
                            <small class="opacity-75">واجهة موحدة لإتمام التذكرة النهائية بشكل منظم وسريع.</small>
                        </div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body p-0 bg-light">
                        <div id="printableTicket" class="cv-print-wrapper">
                            <div class="ticket-paper">
                                <div class="ticket-header ticket-header-compact">
                                    <div class="ticket-meta-row">
                                        <div class="ticket-date-line">
                                            <span class="dl-label">التاريخ:</span>
                                            <span class="ticket-date-value">${safe(hijriStr || dateStr)}</span>
                                            <span class="hijri-suffix">هـ</span>
                                        </div>
                                        <div class="ticket-date-line">
                                            <span class="dl-label">الموافق:</span>
                                            <span class="ticket-date-value">${safe(dateStr)}</span>
                                            <span class="hijri-suffix">م</span>
                                        </div>
                                        ${ticketTypeAr ? `<div class="ticket-period-badge" style="border-color:${ticketTypeColor}; color:${ticketTypeColor};">
                                            <i class="bi bi-${data.ticket_type === 'morning' ? 'sun' : 'moon-stars'} ms-1"></i>فترة ${safe(ticketTypeAr)}
                                        </div>` : ''}
                                    </div>
                                </div>

                                <hr class="ticket-divider">

                                <div class="ticket-section">
                                    <div class="ticket-section-title">
                                        <i class="bi bi-person-vcard"></i>
                                        <span>بيانات المريض</span>
                                    </div>
                                    <div class="ticket-grid">
                                        <div class="ticket-field-card field-span-12">
                                            <span class="ticket-label">اسم المريض</span>
                                            <span class="ticket-value">${safe(data.patient_name || '—')}</span>
                                        </div>
                                        <div class="ticket-field-card field-span-6 ticket-field-compact">
                                            <div class="ticket-field-inline">
                                                <div class="ticket-mini-field">
                                                    <span class="ticket-label">العمر</span>
                                                    <span class="ticket-value">${safe(data.age || '—')}</span>
                                                </div>
                                                <span class="ticket-mini-divider"></span>
                                                <div class="ticket-mini-field">
                                                    <span class="ticket-label">الجنس</span>
                                                    <span class="ticket-value">${safe(data.gender_ar || '—')}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="ticket-field-card field-span-6">
                                            <span class="ticket-label">نوع الحالة</span>
                                            <span class="ticket-value">${safe(data.type_case || '—')}</span>
                                        </div>
                                        <div class="ticket-field-card field-span-12">
                                            <span class="ticket-label">العيادة</span>
                                            <input type="text" id="cv_clinic" class="ticket-input d-print-none" placeholder="اختياري">
                                            <span class="ticket-value d-none d-print-inline" id="cv_clinic_print">&nbsp;</span>
                                        </div>
                                    </div>
                                </div>

                                <div class="ticket-section ticket-section-accent">
                                    <div class="ticket-section-title">
                                        <i class="bi bi-clipboard2-pulse"></i>
                                        <span>الإغلاق الطبي</span>
                                    </div>
                                    <div class="ticket-grid">
                                        <div class="ticket-field-card field-span-12 ticket-field-required">
                                            <span class="ticket-label">التشخيص النهائي <span class="text-danger">*</span></span>
                                            <input type="text" id="cv_diagnosis" class="ticket-input d-print-none" value="${safe(data.initial_diagnosis || '')}" placeholder="حقل إجباري">
                                            <span class="ticket-value d-none d-print-inline" id="cv_diagnosis_print"></span>
                                        </div>
                                        <div class="ticket-field-card field-span-12 ticket-notes-card">
                                            <div class="ticket-notes-head d-print-none">
                                                <span class="ticket-label mb-0">ملاحظات المعاينة والوصفة <span class="text-danger">*</span></span>
                                                <small class="text-muted">اكتب التعليمات بشكل واضح ومختصر.</small>
                                            </div>
                                            <div class="ticket-notes-shell">
                                                <div class="ticket-rx-label">Rx</div>
                                                <div class="ticket-rx-body">
                                                    <textarea id="cv_notes" class="form-control ticket-textarea d-print-none" rows="7" placeholder="حقل إجباري - اكتب ملاحظات المعاينة والوصفة العلاجية هنا..."></textarea>
                                                    <div class="ticket-notes-print d-none d-print-block" id="cv_notes_print"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="ticket-footer">
                                    <div class="ticket-footer-doctor">
                                        <div class="ticket-footer-line">
                                            <span class="ticket-label">الطبيب المعالج:</span>
                                            <span class="ticket-value">${safe(data.attending_doctor || '—')}</span>
                                        </div>
                                    </div>
                                    <div class="ticket-footer-meta d-print-none">
                                        <span class="ticket-footer-badge"><i class="bi bi-shield-check"></i> الحقول الإلزامية: التشخيص والملاحظات</span>
                                    </div>
                                    <div class="ticket-footer-stamp d-none d-print-block">
                                        <div class="stamp-circle">ختم الإدارة</div>
                                    </div>
                                </div>

                                ${h.footer_note ? `<div class="ticket-footer-note"><i class="bi bi-info-circle ms-1 d-print-none"></i>${safe(h.footer_note)}</div>` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer border-0 bg-white d-print-none flex-wrap gap-2 justify-content-between">
                        <small class="text-muted d-flex align-items-center order-3 order-md-1">
                            <i class="bi bi-phone text-success ms-1 fs-5"></i>
                            <span>تم تحسين العرض ليتناسب مع الهاتف والشاشات الصغيرة.</span>
                        </small>
                        <div class="d-flex flex-wrap gap-2 ms-md-auto order-1 order-md-2 w-100 justify-content-md-end">
                            <button type="button" class="btn btn-outline-secondary fw-bold cv-action-btn" data-bs-dismiss="modal">
                                <i class="bi bi-x-lg ms-1"></i> إلغاء
                            </button>
                            <button type="button" class="btn btn-info text-white fw-bold cv-action-btn" onclick="Doctor.printCloseVisit()">
                                <i class="bi bi-printer-fill ms-1"></i> طباعة
                            </button>
                            <button type="button" class="btn btn-success fw-bold shadow-sm cv-action-btn" onclick="Core.guard(this, () => Doctor.saveCloseVisit('${visitId}'))">
                                <i class="bi bi-check2-circle ms-1"></i> حفظ وإغلاق الزيارة
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this._injectTicketStyles();
        new bootstrap.Modal(document.getElementById('closeVisitModal')).show();
    },
    _injectTicketStyles: function() {
        if (document.getElementById('ticketStylesInjected')) return;
        const css = `
        /* ============================================================
           تنسيق نافذة إغلاق الزيارة - موحد ومتجاوب
           ============================================================ */
        #closeVisitModal .modal-content {
            border-radius: 18px;
            overflow: hidden;
            background: #f4f7fb;
        }
        #closeVisitModal .modal-header { border-radius: 0 !important; }
        #closeVisitModal .cv-print-wrapper { padding: 24px; }
        #closeVisitModal .ticket-paper {
            border: 1px solid #dbe4ee;
            border-radius: 24px;
            padding: 28px;
            background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
            color: #1f2937;
            font-family: 'Cairo', 'Tajawal', sans-serif;
            box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);
            max-width: 1040px;
            margin: 0 auto;
            position: relative;
        }
        #closeVisitModal .ticket-paper::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: 24px;
            background: radial-gradient(circle at top right, rgba(25, 135, 84, 0.08), transparent 35%),
                        radial-gradient(circle at bottom left, rgba(13, 110, 253, 0.06), transparent 35%);
            pointer-events: none;
        }
        #closeVisitModal .ticket-header,
        #closeVisitModal .ticket-section,
        #closeVisitModal .ticket-footer,
        #closeVisitModal .ticket-footer-note {
            position: relative;
            z-index: 1;
        }
        #closeVisitModal .ticket-header {
            margin-bottom: 14px;
        }
        #closeVisitModal .ticket-header-compact { margin-bottom: 10px; }
        #closeVisitModal .ticket-meta-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: flex-start;
            gap: 10px 18px;
            direction: rtl;
        }
        #closeVisitModal .ticket-date-line {
            display: inline-flex;
            gap: 6px;
            align-items: center;
            margin-top: 0;
            direction: rtl;
        }
        #closeVisitModal .dl-label { font-weight: 700; color: #475569; min-width: 60px; }
        #closeVisitModal .ticket-date-value {
            font-weight: 700;
            min-width: 98px;
            border-bottom: 1px dashed #94a3b8;
            padding: 0 8px;
            text-align: center;
        }
        #closeVisitModal .hijri-suffix { color: #64748b; }
        #closeVisitModal .ticket-period-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-top: 0;
            margin-inline-start: auto;
            border: 1px solid;
            border-radius: 999px;
            padding: 5px 12px;
            font-size: 0.8rem;
            font-weight: 800;
            background: #fff;
        }
        #closeVisitModal .ticket-divider {
            border: none;
            border-top: 1px solid #dbe4ee;
            margin: 0 0 18px;
            opacity: 1;
        }
        #closeVisitModal .ticket-section {
            background: rgba(255, 255, 255, 0.78);
            border: 1px solid #e2e8f0;
            border-radius: 22px;
            padding: 18px;
            margin-bottom: 16px;
            box-shadow: 0 10px 25px rgba(15, 23, 42, 0.04);
        }
        #closeVisitModal .ticket-section-accent {
            border-color: rgba(25, 135, 84, 0.16);
            background: linear-gradient(180deg, rgba(25, 135, 84, 0.05) 0%, rgba(255, 255, 255, 0.92) 100%);
        }
        #closeVisitModal .ticket-section-title {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 14px;
            color: #0f172a;
            font-size: 1rem;
            font-weight: 800;
        }
        #closeVisitModal .ticket-section-title i {
            width: 34px;
            height: 34px;
            border-radius: 12px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: rgba(25, 135, 84, 0.12);
            color: #198754;
        }
        #closeVisitModal .ticket-grid {
            display: grid;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            gap: 12px;
        }
        #closeVisitModal .ticket-field-card {
            grid-column: span 12;
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 90px;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
        }
        #closeVisitModal .field-span-3 { grid-column: span 3; }
        #closeVisitModal .ticket-field-compact { padding: 10px 14px; min-height: auto; }
        #closeVisitModal .ticket-field-inline {
            display: flex;
            align-items: stretch;
            gap: 14px;
            flex-wrap: nowrap;
        }
        #closeVisitModal .ticket-mini-field {
            flex: 1 1 0;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        #closeVisitModal .ticket-mini-field .ticket-label { font-size: 0.78rem; }
        #closeVisitModal .ticket-mini-field .ticket-value { font-size: 0.9rem; min-height: 20px; }
        #closeVisitModal .ticket-mini-divider {
            width: 1px;
            background: #e2e8f0;
            align-self: stretch;
        }
        #closeVisitModal .field-span-4 { grid-column: span 4; }
        #closeVisitModal .field-span-6 { grid-column: span 6; }
        #closeVisitModal .field-span-12 { grid-column: span 12; }
        #closeVisitModal .ticket-field-required {
            border-color: rgba(220, 53, 69, 0.22);
            box-shadow: 0 0 0 1px rgba(220, 53, 69, 0.06);
        }
        #closeVisitModal .ticket-label {
            font-weight: 800;
            font-size: 0.86rem;
            color: #475569;
            margin-bottom: 0;
        }
        #closeVisitModal .ticket-value {
            font-weight: 700;
            color: #0f172a;
            font-size: 0.98rem;
            min-height: 24px;
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
        }
        #closeVisitModal .ticket-input {
            width: 100%;
            border: 1px solid #cbd5e1;
            outline: none;
            background: #f8fafc;
            padding: 11px 12px;
            font-family: inherit;
            font-weight: 700;
            transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
            border-radius: 14px;
        }
        #closeVisitModal .ticket-input:focus {
            background: #fff;
            border-color: #198754;
            box-shadow: 0 0 0 0.2rem rgba(25, 135, 84, 0.1);
        }
        #closeVisitModal .ticket-notes-card {
            padding: 16px;
            min-height: auto;
        }
        #closeVisitModal .ticket-notes-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 10px;
        }
        #closeVisitModal .ticket-notes-shell {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 16px;
            align-items: start;
        }
        #closeVisitModal .ticket-rx-label {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 64px;
            height: 56px;
            padding: 0 16px;
            border-radius: 18px;
            font-size: 1.8rem;
            font-style: italic;
            font-family: 'Georgia', 'Times New Roman', serif;
            font-weight: 700;
            color: #198754;
            background: rgba(25, 135, 84, 0.08);
        }
        #closeVisitModal .ticket-rx-body { width: 100%; }
        #closeVisitModal .ticket-textarea {
            display: block;
            width: 100%;
            min-height: 210px;
            resize: vertical;
            border: 1px dashed #94a3b8;
            border-radius: 18px;
            background: #fcfdfd;
            font-family: inherit;
            font-size: 0.95rem;
            transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
            padding: 14px;
        }
        #closeVisitModal .ticket-textarea:focus {
            border-color: #198754;
            background: #fff;
            box-shadow: 0 0 0 0.2rem rgba(25, 135, 84, 0.08);
        }
        #closeVisitModal .ticket-notes-print {
            padding: 12px;
            min-height: 160px;
            white-space: pre-wrap;
            line-height: 1.9;
            border: 1px dashed #cbd5e1;
            border-radius: 12px;
            background: #fff;
        }
        #closeVisitModal .ticket-footer {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 18px;
            margin-top: 22px;
            padding-top: 16px;
            border-top: 1px dashed #cbd5e1;
        }
        #closeVisitModal .ticket-footer-doctor { flex: 1; }
        #closeVisitModal .ticket-footer-line {
            display: flex;
            gap: 8px;
            align-items: baseline;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }
        #closeVisitModal .ticket-footer-meta {
            display: flex;
            align-items: center;
            gap: 12px;
            justify-content: flex-end;
        }
        #closeVisitModal .ticket-footer-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(25, 135, 84, 0.1);
            color: #0f5132;
            border-radius: 999px;
            padding: 8px 14px;
            font-size: 0.84rem;
            font-weight: 700;
        }
        #closeVisitModal .stamp-circle {
            width: 100px;
            height: 100px;
            border: 2px dashed #198754;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #198754;
            font-weight: 700;
            font-size: 0.85rem;
            opacity: 0.6;
        }
        #closeVisitModal .ticket-footer-note {
            font-size: 0.8rem;
            color: #64748b;
            text-align: center;
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px dotted #cbd5e1;
        }
        #closeVisitModal .cv-action-btn {
            min-width: 150px;
            border-radius: 14px;
            padding: 10px 16px;
        }

        @media (max-width: 991.98px) {
            #closeVisitModal .modal-dialog { margin: 0; max-width: 100%; }
            #closeVisitModal .modal-content { border-radius: 0; min-height: 100vh; }
            #closeVisitModal .cv-print-wrapper { padding: 16px; }
            #closeVisitModal .ticket-paper { padding: 20px 18px; border-radius: 0; max-width: 100%; }
            #closeVisitModal .ticket-meta-row { justify-content: center; gap: 8px 14px; }
            #closeVisitModal .ticket-period-badge { margin-inline-start: 0; }
            #closeVisitModal .field-span-3,
            #closeVisitModal .field-span-4,
            #closeVisitModal .field-span-6 { grid-column: span 6; }
            #closeVisitModal .ticket-footer {
                flex-direction: column;
                align-items: stretch;
            }
            #closeVisitModal .ticket-footer-meta { justify-content: flex-start; }
            #closeVisitModal .modal-footer {
                padding: 12px 16px 16px;
            }
        }

        @media (max-width: 575.98px) {
            #closeVisitModal .cv-print-wrapper { padding: 10px; }
            #closeVisitModal .ticket-paper { padding: 14px 12px; }
            #closeVisitModal .ticket-section { padding: 14px; border-radius: 18px; }
            #closeVisitModal .ticket-grid { grid-template-columns: 1fr; gap: 10px; }
            #closeVisitModal .field-span-3,
            #closeVisitModal .field-span-4,
            #closeVisitModal .field-span-6,
            #closeVisitModal .field-span-12 { grid-column: span 1; }
            #closeVisitModal .ticket-field-card {
                min-height: auto;
                padding: 12px 13px;
                border-radius: 16px;
                gap: 6px;
            }
            #closeVisitModal .ticket-field-compact { padding: 10px 12px; }
            #closeVisitModal .ticket-field-inline { gap: 10px; }
            #closeVisitModal .ticket-mini-field .ticket-label { font-size: 0.72rem; }
            #closeVisitModal .ticket-mini-field .ticket-value { font-size: 0.85rem; }
            #closeVisitModal .ticket-label { font-size: 0.78rem; }
            #closeVisitModal .ticket-value { font-size: 0.9rem; }
            #closeVisitModal .ticket-input { padding: 9px 10px; border-radius: 12px; }
            #closeVisitModal .ticket-date-value { min-width: 76px; padding: 0 4px; font-size: 0.84rem; }
            #closeVisitModal .dl-label { min-width: 0; font-size: 0.82rem; }
            #closeVisitModal .ticket-period-badge { font-size: 0.72rem; padding: 3px 9px; }
            #closeVisitModal .ticket-notes-head { margin-bottom: 8px; }
            #closeVisitModal .ticket-notes-shell {
                grid-template-columns: 1fr;
                gap: 10px;
            }
            #closeVisitModal .ticket-rx-label {
                min-width: auto;
                width: 100%;
                height: 44px;
                font-size: 1.35rem;
                border-radius: 14px;
            }
            #closeVisitModal .ticket-textarea {
                min-height: 150px;
                border-radius: 14px;
                font-size: 0.9rem;
                padding: 12px;
            }
            #closeVisitModal .modal-footer {
                padding: 10px 12px 14px;
                gap: 6px !important;
            }
            #closeVisitModal .modal-footer small { width: 100%; font-size: 0.72rem; }
            #closeVisitModal .modal-footer > .d-flex {
                width: 100%;
                flex-wrap: nowrap;
                gap: 6px;
            }
            /* تصغير أزرار الإلغاء والطباعة على الجوال */
            #closeVisitModal .cv-action-btn {
                flex: 1 1 auto;
                min-width: 0;
                padding: 7px 8px;
                font-size: 0.78rem;
                border-radius: 10px;
            }
            #closeVisitModal .btn-outline-secondary.cv-action-btn,
            #closeVisitModal .btn-info.cv-action-btn {
                flex: 0 0 auto;
                font-size: 0.74rem;
                padding: 6px 10px;
            }
            #closeVisitModal .btn-success.cv-action-btn {
                flex: 1 1 auto;
                font-size: 0.82rem;
                padding: 8px 10px;
            }
            #closeVisitModal .cv-action-btn i { font-size: 0.85rem; }
        }

        @media print {
            @page { size: A4; margin: 14mm 12mm; }
            html, body { background: #fff !important; }
            body * { visibility: hidden; }
            #printableTicket, #printableTicket * { visibility: visible; }
            #printableTicket {
                position: absolute;
                left: 0;
                right: 0;
                top: 0;
                width: 100%;
                padding: 0 !important;
                background: #fff !important;
            }
            #closeVisitModal .ticket-paper {
                box-shadow: none !important;
                border: 1px solid #000 !important;
                padding: 18px 20px !important;
                max-width: 100% !important;
                border-radius: 0 !important;
                background: #fff !important;
            }
            #closeVisitModal .ticket-paper::before,
            #closeVisitModal .ticket-footer-meta { display: none !important; }
            #closeVisitModal .ticket-input,
            #closeVisitModal .ticket-textarea { display: none !important; }
            #closeVisitModal .d-print-inline { display: inline !important; }
            #closeVisitModal .d-print-block  { display: block !important; }
            #closeVisitModal .d-print-none   { display: none !important; }
            #closeVisitModal .ticket-field-card,
            #closeVisitModal .ticket-section,
            #closeVisitModal .ticket-notes-print,
            #closeVisitModal .ticket-value,
            #closeVisitModal .ticket-label,
            #closeVisitModal .ticket-date-value {
                color: #000 !important;
                background: #fff !important;
                box-shadow: none !important;
            }
            #closeVisitModal .ticket-section,
            #closeVisitModal .ticket-field-card,
            #closeVisitModal .ticket-notes-print {
                border-color: #000 !important;
                border-radius: 0 !important;
            }
            #closeVisitModal .ticket-divider,
            #closeVisitModal .ticket-footer,
            #closeVisitModal .ticket-footer-note {
                border-color: #000 !important;
            }
            #closeVisitModal .ticket-section-title i { background: #fff !important; color: #000 !important; }
            #closeVisitModal .ticket-period-badge {
                color: #000 !important;
                border-color: #000 !important;
                background: #fff !important;
            }
            #closeVisitModal .ticket-rx-label {
                color: #000 !important;
                background: #fff !important;
                border: 1px solid #000 !important;
            }
            #closeVisitModal .stamp-circle { border-color: #000 !important; color: #000 !important; }
            .modal-backdrop { display: none !important; }
            #closeVisitModal {
                position: static !important;
                overflow: visible !important;
                background: none !important;
            }
            #closeVisitModal .modal-dialog {
                max-width: 100% !important;
                margin: 0 !important;
            }
            #closeVisitModal .modal-content {
                border: none !important;
                box-shadow: none !important;
                background: #fff !important;
            }
        }
        `;
        const styleEl = document.createElement('style');
        styleEl.id = 'ticketStylesInjected';
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
    },
    /**
     * طباعة النموذج: ينسخ القيم من الحقول التفاعلية إلى عناصر العرض،
     * ثم يستدعي window.print().
     */
    printCloseVisit: function() {
        const clinic     = document.getElementById('cv_clinic')?.value || '';
        const diagnosis  = document.getElementById('cv_diagnosis')?.value || '';
        const notes      = document.getElementById('cv_notes')?.value || '';

        const clinicEl    = document.getElementById('cv_clinic_print');
        const diagEl      = document.getElementById('cv_diagnosis_print');
        const notesEl     = document.getElementById('cv_notes_print');

        if (clinicEl)  clinicEl.textContent  = clinic || ' ';
        if (diagEl)    diagEl.textContent    = diagnosis || ' ';
        if (notesEl)   notesEl.innerText     = notes || ' ';

        // إعطاء المتصفح فرصة لتطبيق التحديثات قبل الطباعة
        setTimeout(() => window.print(), 50);
    },

    /**
     * حفظ الإغلاق على السيرفر بعد التحقق من الحقول الإجبارية.
     */
    saveCloseVisit: async function(visitId) {
        const clinic    = document.getElementById('cv_clinic').value.trim();
        const diagnosis = document.getElementById('cv_diagnosis').value.trim();
        const notes     = document.getElementById('cv_notes').value.trim();

        if (!diagnosis) {
            document.getElementById('cv_diagnosis').focus();
            return Core.showAlert('التشخيص النهائي حقل إجباري', 'warning');
        }
        if (!notes) {
            document.getElementById('cv_notes').focus();
            return Core.showAlert('الملاحظات حقل إجباري', 'warning');
        }

        const payload = {
            id_vis: visitId,
            diagnosis,
            final_notes: notes,
            clinic
        };

        const response = await Core.apiCall('doctor/final_diagnosis', 'POST', payload);
        if (response && response.success) {
            bootstrap.Modal.getInstance(document.getElementById('closeVisitModal')).hide();
            Core.showAlert(response.message || 'تم إغلاق الزيارة بنجاح', 'success');
            // تحديث قائمة الانتظار - المريض سيختفي تلقائياً
            this.loadWaitingList();
        } else {
            Core.showAlert(response ? response.message : 'حدث خطأ أثناء الإغلاق', 'error');
        }
    },

    // ============================================================
    // 4) الطلبات (Orders) - بدون تغيير جوهري
    // ============================================================
    renderServiceCheckboxes: function(groupKey, items) {
        if (!items || items.length === 0) return `<div class="text-muted small">لا توجد خدمات في هذا القسم.</div>`;
        return `
        <div class="row g-2">
            ${items.map(item => `
                <div class="col-12 col-md-6">
                    <div class="form-check p-2 border rounded-3 hover-shadow bg-light h-100">
                        <input class="form-check-input ms-2" type="checkbox" value="${item.id}" data-group="${groupKey}" id="check_${item.id}">
                        <label class="form-check-label small fw-bold" for="check_${item.id}">${item.name}</label>
                    </div>
                </div>`).join('')}
        </div>`;
    },

    openOrdersModal: function(id_vis, name) {
        const existing = document.getElementById('ordersModal');
        if (existing) existing.remove();

        const departments = Array.isArray(DoctorData.availableServices)
            ? DoctorData.availableServices
            : [];

        const normalizeTabId = (dept, index) => {
            const raw = String(dept.code || dept.id || index + 1).trim();
            const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
            return `dept-tab-${safe || index + 1}`;
        };

        const navTabs = departments.length
            ? departments.map((dept, index) => {
                const tabId = normalizeTabId(dept, index);
                return `<li class="nav-item" role="presentation">
                    <button class="nav-link ${index === 0 ? 'active' : ''} btn-sm px-4 fw-bold" data-bs-toggle="pill" data-bs-target="#${tabId}" type="button" role="tab">
                        ${this._escapeHtml(dept.name || `قسم ${index + 1}`)}
                    </button>
                </li>`;
            }).join('')
            : '<li class="nav-item"><span class="nav-link disabled btn-sm px-4">لا توجد أقسام مفعلة</span></li>';

        const tabPanels = departments.length
            ? departments.map((dept, index) => {
                const tabId = normalizeTabId(dept, index);
                const groupKey = String(dept.code || `dept_${dept.id || index + 1}`).trim() || `dept_${index + 1}`;
                return `<div class="tab-pane fade ${index === 0 ? 'show active' : ''}" id="${tabId}" role="tabpanel">
                    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                        <div>
                            <h6 class="mb-0 fw-bold text-primary">${this._escapeHtml(dept.name || `قسم ${index + 1}`)}</h6>
                            <small class="text-muted">الخدمات المتاحة داخل هذا القسم</small>
                        </div>
                        <span class="badge bg-primary-subtle text-primary rounded-pill px-3 py-2">${dept.services.length} خدمة</span>
                    </div>
                    ${this.renderServiceCheckboxes(groupKey, dept.services)}
                </div>`;
            }).join('')
            : `<div class="text-center text-muted py-5">
                <i class="bi bi-inboxes fs-1 d-block mb-2"></i>
                لا توجد أقسام مرتبطة بخدمات حالياً.
            </div>`;

        const modalHTML = `
        <div class="modal fade" id="ordersModal" tabindex="-1">
            <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-primary text-white border-0 py-3">
                        <h5 class="modal-title fw-bold"><i class="bi bi-file-medical ms-2"></i>إرسال طلبات: ${name}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-4 bg-light">
                        <div class="card p-3 border-0 shadow-sm">
                            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                                <div>
                                    <h6 class="fw-bold mb-1">الأقسام الطبية</h6>
                                    <small class="text-muted">يتم عرض الأقسام المضافة فعلياً فقط، مع الخدمات التابعة لكل قسم مباشرة.</small>
                                </div>
                                <span class="badge bg-success-subtle text-success rounded-pill px-3 py-2">${departments.length} قسم</span>
                            </div>
                            <ul class="nav nav-pills mb-3 gap-2 flex-wrap" id="pills-tab" role="tablist">
                                ${navTabs}
                            </ul>
                            <div class="tab-content border p-3 rounded-3 bg-white" id="pills-tabContent" style="min-height: 220px;">
                                ${tabPanels}
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer border-0 bg-white">
                        <button class="btn btn-light px-4 fw-bold" data-bs-dismiss="modal">إلغاء</button>
                        <button class="btn btn-primary px-5 fw-bold shadow-sm" onclick="Core.guard(this, () => Doctor.sendOrders('${id_vis}'))">إرسال الطلبات للأقسام</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        new bootstrap.Modal(document.getElementById('ordersModal')).show();
    },

    sendOrders: async function(id_vis) {
        const payload = { id_vis: id_vis, order: {} };
        let selectedCount = 0;

        document.querySelectorAll('#ordersModal input[type="checkbox"]:checked').forEach(chk => {
            const groupKey = chk.getAttribute('data-group') || 'default';
            if (!payload.order[groupKey]) payload.order[groupKey] = [];
            payload.order[groupKey].push(parseInt(chk.value));
            selectedCount += 1;
        });

        if (selectedCount === 0) {
            return Core.showAlert('يرجى اختيار طلب واحد على الأقل', 'warning');
        }

        const response = await Core.apiCall('doctor/send_orders', 'POST', payload);
        if (response && response.success) {
            bootstrap.Modal.getInstance(document.getElementById('ordersModal')).hide();
            Core.showAlert('تم إرسال الطلبات للأقسام بنجاح', 'success');
            this.loadWaitingList();
        } else {
            Core.showAlert(response ? response.message : 'حدث خطأ أثناء إرسال الطلبات', 'error');
        }
    },

    // ============================================================
    // 5) الطلبات المرسلة (Sent Orders)
    // ============================================================
    viewSentOrders: function() {
        Core.navigateTo('viewSentOrders', () => {
            const mainContent = document.getElementById('mainContent');
            const tools = [{ label: "تحديث", icon: "bi-arrow-repeat", action: "Doctor.loadSentOrders()" }];
            mainContent.innerHTML = `
                <div class="container-fluid p-0 animate-in">
                    ${Core.renderHeaderWithTools('الطلبات المرسلة', 'تتبع الفحوصات والخدمات التي طلبتها لمرضى اليوم.', tools)}
                    <div class="card stat-card p-0 border-0 shadow-sm" id="sentOrdersContainer"></div>
                </div>`;
            this.loadSentOrders();
        });
    },

    loadSentOrders: async function() {
        const container = document.getElementById('sentOrdersContainer');
        if(!container) return;
        container.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>`;
        const response = await Core.apiCall('doctor/sent_orders', 'GET');
        if (response && response.success) {
            DoctorData.sent_orders = response.data;
            const activeList = response.data;
            if (activeList.length === 0) {
                container.innerHTML = `<div class="p-5 text-center text-muted"><i class="bi bi-check-circle fs-1 text-success mb-3 d-block"></i>لا توجد طلبات مرسلة اليوم.</div>`;
                return;
            }
            const headers = ["المريض", "نوع الحالة", "عدد الطلبات", "الإجراء"];
            const rows = activeList.map(item => [
                `<span class="fw-bold">${item.name}</span>`,
                `<span class="badge bg-secondary bg-opacity-10 text-dark px-3">${item.type_case}</span>`,
                `<span class="badge bg-primary rounded-pill px-3">${item.order_count}</span>`
            ]);
            Core.renderTable('sentOrdersContainer', headers, rows, (row, index) => {
                const item = activeList[index];
                return `
                    <button class="btn btn-primary btn-sm fw-bold px-3 shadow-sm" onclick="Doctor.openSentOrdersDetails('${item.visit}')">
                        <i class="bi bi-list-check ms-1"></i> عرض الطلبات
                    </button>`;
            });
        } else {
            container.innerHTML = `<div class="p-5 text-center text-danger">حدث خطأ أثناء جلب البيانات.</div>`;
        }
    },

    openSentOrdersDetails: function(visit_id) {
        const existing = document.getElementById('sentOrdersDetailsModal');
        if (existing) existing.remove();
        const patientData = DoctorData.sent_orders.find(s => s.visit === visit_id);
        if(!patientData) return;
        const rows = patientData.details.map(d => {
            const statusBadge = d.status === 'مكتمل' ? '<span class="badge bg-success bg-opacity-10 text-success">مكتمل</span>' : '<span class="badge bg-warning bg-opacity-10 text-warning">قيد الانتظار</span>';
            return `<tr><td class="fw-bold text-end">${d.orders}</td><td class="text-muted small text-end">${d.time}</td><td class="text-end">${statusBadge}</td></tr>`;
        }).join('');
        const modalHTML = `
        <div class="modal fade" id="sentOrdersDetailsModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-dark text-white border-0">
                        <h5 class="modal-title fw-bold">طلبات المريض: ${patientData.name}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-0">
                        <table class="table mb-0 align-middle">
                            <thead class="bg-light text-muted small text-end"><tr><th>الطلبات</th><th>وقت الإرسال</th><th>الحالة</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        new bootstrap.Modal(document.getElementById('sentOrdersDetailsModal')).show();
    },

    // ============================================================
    // 6) السجل الطبي (Medical Archive)
    // ============================================================
    viewMedicalArchive: function() {
        Core.navigateTo('viewMedicalArchive', () => {
            const mainContent = document.getElementById('mainContent');
            const tools = [
                { label: "تحديث السجل", icon: "bi-arrow-repeat", action: "Doctor.loadMedicalArchive()" }
            ];
            mainContent.innerHTML = `
                <div class="container-fluid p-0 animate-in">
                    ${Core.renderHeaderWithTools('السجل الطبي', 'الأرشيف الكامل لجميع المرضى وزياراتهم السابقة.', tools)}
                    <div class="card stat-card p-4 mb-4 border-0 shadow-sm">
                        <input type="text" class="form-control shadow-none bg-light" placeholder="بحث سريع باسم المريض في السجل الطبي..." id="archiveSearch" onkeyup="Doctor.filterArchive()">
                    </div>
                    <div class="card stat-card p-0 border-0 shadow-sm" id="archiveTableContainer"></div>
                </div>`;
            this.loadMedicalArchive();
        });
    },

    loadMedicalArchive: async function(filteredData = null) {
        const container = document.getElementById('archiveTableContainer');
        if (!container) return;
        if (!filteredData) {
            container.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>`;
            const response = await Core.apiCall('doctor/medical_archive', 'GET');
            if (response && response.success) {
                DoctorData.data_patients = response.data;
                filteredData = response.data;
            } else {
                container.innerHTML = `<div class="p-5 text-center text-danger">حدث خطأ أثناء جلب السجل الطبي.</div>`;
                return;
            }
        }
        if (filteredData.length === 0) {
            container.innerHTML = `<div class="p-5 text-center text-muted">لا يوجد سجلات مطابقة.</div>`;
            return;
        }
        const headers = ["اسم المريض", "عدد الزيارات", "آخر زيارة", "الإجراء"];
        const rows = filteredData.map(p => [
            `<span class="fw-bold">${p.name}</span>`,
            `<span class="badge bg-primary bg-opacity-10 text-primary px-3">${p.visit_num}</span>`,
            `<span class="small text-muted">${p.last_visit_date}</span>`
        ]);
        Core.renderTable('archiveTableContainer', headers, rows, (row, index) => {
            const p = filteredData[index];
            return `
                <button class="btn btn-dark btn-sm fw-bold px-3 shadow-sm" onclick="Doctor.viewFullFile('${p.id_pat}')">
                    <i class="bi bi-folder2-open ms-1"></i> الملف الكامل
                </button>`;
        });
    },

    filterArchive: function() {
        const query = document.getElementById('archiveSearch').value.toLowerCase();
        const filtered = DoctorData.data_patients.filter(p => p.name.toLowerCase().includes(query));
        this.loadMedicalArchive(filtered);
    },

    viewFullFile: async function(patient_id) {
        const existing = document.getElementById('historyModal');
        if (existing) existing.remove();
        let patient = DoctorData.data_patients.find(p => p.id_pat == patient_id);
        if (!patient) {
            const response = await Core.apiCall('doctor/medical_archive', 'GET');
            if (response && response.success) {
                DoctorData.data_patients = response.data;
                patient = DoctorData.data_patients.find(p => p.id_pat == patient_id);
            }
        }
        if (!patient) { Core.showAlert('لم يتم العثور على الملف الطبي', 'warning'); return; }

        const cards = patient.medical_file.map((v) => {
            // ===== شارة رقم التذكرة (بارزة وواضحة) =====
            const ticketSerialPadded = v.ticket_serial ? String(v.ticket_serial).padStart(4, '0') : null;
            const ticketTypeAr = v.ticket_type === 'morning' ? 'صباحية' : (v.ticket_type === 'evening' ? 'مسائية' : '');
            const ticketTypeIcon = v.ticket_type === 'morning' ? 'sun-fill' : 'moon-stars-fill';
            const ticketTypeColor = v.ticket_type === 'morning' ? '#f59e0b' : '#6366f1';

            const ticketBadge = ticketSerialPadded
                ? `<span class="mf-ticket-badge" title="رقم التذكرة التسلسلي">
                       <i class="bi bi-ticket-perforated-fill"></i>
                       <span class="mf-ticket-serial">T-${ticketSerialPadded}</span>
                       ${ticketTypeAr ? `<span class="mf-ticket-period" style="background:${ticketTypeColor};">
                           <i class="bi bi-${ticketTypeIcon}"></i> ${ticketTypeAr}
                       </span>` : ''}
                   </span>`
                : `<span class="badge bg-secondary bg-opacity-10 text-secondary" title="لا توجد تذكرة لهذه الزيارة">
                       <i class="bi bi-ticket ms-1"></i> بدون تذكرة
                   </span>`;

            // ===== ملاحظات المعاينة (الأولوية لـ final_notes ثم ticket_notes) =====
            const examinationNotes = v.final_notes || v.ticket_notes || '';
            const examinationNotesHTML = examinationNotes
                ? `<div class="col-12 mt-2">
                       <div class="mf-exam-notes">
                           <div class="mf-exam-notes-header">
                               <i class="bi bi-clipboard2-pulse-fill"></i>
                               <span>ملاحظات المعاينة</span>
                               ${ticketSerialPadded ? `<span class="mf-exam-notes-ticket">للتذكرة T-${ticketSerialPadded}</span>` : ''}
                           </div>
                           <div class="mf-exam-notes-body">${this._escapeHtml(examinationNotes).replace(/\n/g, '<br>')}</div>
                       </div>
                   </div>`
                : '';

            const clinicHTML = v.clinic_name
                ? `<div class="col-md-6"><div class="small text-muted mb-1"><i class="bi bi-building ms-1"></i> العيادة</div><div class="fw-bold small">${this._escapeHtml(v.clinic_name)}</div></div>`
                : '';

            return `
            <div class="card mb-3 border-0 shadow-sm mf-visit-card">
                <div class="card-header bg-white d-flex justify-content-between align-items-center py-3 flex-wrap gap-2 border-bottom">
                    <div class="d-flex gap-2 align-items-center flex-wrap">
                        <span class="badge bg-warning bg-opacity-10 text-warning px-3 py-2"><i class="bi bi-clipboard-pulse ms-1"></i>${v.type_case || ''}</span>
                        ${ticketBadge}
                    </div>
                    <span class="small text-muted"><i class="bi bi-calendar3 ms-1"></i> ${v.date_visit}</span>
                </div>
                <div class="card-body py-3">
                    <div class="row g-3">
                        <div class="col-md-6"><div class="small text-muted mb-1"><i class="bi bi-clipboard2-pulse ms-1"></i> التشخيص النهائي</div><div class="fw-bold">${this._escapeHtml(v.diagnosis || '--')}</div></div>
                        <div class="col-md-6"><div class="small text-muted mb-1"><i class="bi bi-file-medical ms-1"></i> الإجراءات / الطلبات</div><div class="text-primary small">${v.procedures ? this._escapeHtml(v.procedures) : 'لا يوجد'}</div></div>
                        ${clinicHTML}
                        ${v.notes ? `<div class="col-12"><div class="small text-muted mb-1"><i class="bi bi-chat-text ms-1"></i> ملاحظات أولية (وقت فتح الزيارة)</div><div class="small text-secondary">${this._escapeHtml(v.notes)}</div></div>` : ''}
                        ${examinationNotesHTML}
                    </div>
                </div>
            </div>`;
        }).join('');

        const modalHTML = `
        <div class="modal fade" id="historyModal" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-dark text-white border-0 py-3">
                        <h5 class="modal-title fw-bold"><i class="bi bi-folder2-open ms-2"></i> الملف الطبي: ${patient.name}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-3 bg-light">
                        <div class="mb-3 text-muted small d-flex align-items-center gap-2">
                            <i class="bi bi-info-circle"></i>
                            <span>عدد الزيارات المسجلة: <strong class="text-dark">${patient.medical_file.length}</strong></span>
                        </div>
                        ${cards || '<div class="text-center text-muted p-4">لا توجد زيارات مسجلة</div>'}
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this._injectArchiveStyles();
        new bootstrap.Modal(document.getElementById('historyModal')).show();
    },

    // أداة مساعدة لتأمين عرض النصوص (XSS-safe)
    _escapeHtml: function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    // CSS الخاص بواجهة السجل الطبي - حقن لمرة واحدة
    _injectArchiveStyles: function() {
        if (document.getElementById('archiveStylesInjected')) return;
        const css = `
        /* ====== بطاقة الزيارة في السجل الطبي ====== */
        .mf-visit-card { transition: transform 0.15s, box-shadow 0.15s; border-radius: 12px; overflow: hidden; }
        .mf-visit-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.08) !important; }

        /* ====== شارة رقم التذكرة (بارزة) ====== */
        .mf-ticket-badge {
            display: inline-flex; align-items: center; gap: 6px;
            background: linear-gradient(135deg, #fff 0%, #f8f9fa 100%);
            border: 1.5px solid #0dcaf0;
            border-radius: 999px;
            padding: 4px 12px;
            box-shadow: 0 1px 3px rgba(13, 202, 240, 0.15);
        }
        .mf-ticket-badge > i { color: #0dcaf0; font-size: 1rem; }
        .mf-ticket-serial {
            font-family: 'Courier New', 'Cairo', monospace;
            font-weight: 800;
            color: #c0392b;
            letter-spacing: 1px;
            font-size: 0.95rem;
        }
        .mf-ticket-period {
            display: inline-flex; align-items: center; gap: 3px;
            color: #fff; font-size: 0.7rem; font-weight: 700;
            padding: 2px 8px; border-radius: 999px;
            margin-right: 4px;
        }
        .mf-ticket-period i { font-size: 0.75rem; }

        /* ====== صندوق ملاحظات المعاينة ====== */
        .mf-exam-notes {
            background: linear-gradient(135deg, rgba(13, 202, 240, 0.06) 0%, rgba(13, 202, 240, 0.02) 100%);
            border: 1px solid rgba(13, 202, 240, 0.2);
            border-right: 4px solid #0dcaf0;
            border-radius: 8px;
            padding: 12px 14px;
        }
        .mf-exam-notes-header {
            display: flex; align-items: center; gap: 8px;
            margin-bottom: 8px;
            padding-bottom: 6px;
            border-bottom: 1px dashed rgba(13, 202, 240, 0.3);
            font-weight: 700;
            color: #087a92;
            font-size: 0.9rem;
        }
        .mf-exam-notes-header i { font-size: 1.1rem; }
        .mf-exam-notes-ticket {
            margin-right: auto;
            font-family: 'Courier New', monospace;
            background: #fff;
            border: 1px solid rgba(13, 202, 240, 0.3);
            padding: 1px 8px;
            border-radius: 4px;
            font-size: 0.78rem;
            color: #c0392b;
        }
        .mf-exam-notes-body {
            color: #1a1a1a;
            font-size: 0.92rem;
            line-height: 1.7;
            white-space: pre-wrap;
        }

        @media (max-width: 576px) {
            .mf-ticket-badge { padding: 3px 9px; gap: 4px; }
            .mf-ticket-serial { font-size: 0.85rem; }
            .mf-ticket-period { font-size: 0.65rem; padding: 1px 6px; }
        }
        `;
        const styleEl = document.createElement('style');
        styleEl.id = 'archiveStylesInjected';
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
    }
};

initDoctorModule();

async function initDoctorModule() {
    const response = await Core.apiCall('auth/me', 'GET');
    if(response && response.success) {
        DoctorData.currentUser = response.data;
        Core.renderProfile(DoctorData.currentUser);
    }

    // جلب الخدمات
    const servicesResponse = await Core.apiCall('doctor/services_list', 'GET');
    if (servicesResponse && servicesResponse.success) {
        DoctorData.availableServices = servicesResponse.data;
    }

    // جلب إعدادات الترويسة (تخزين محلي - الترويسة ديناميكية ويعدّلها الأدمن)
    const headerResponse = await Core.apiCall('settings/header', 'GET');
    if (headerResponse && headerResponse.success) {
        DoctorData.headerSettings = headerResponse.data;
    }

    const doctorLinks = [
        { title: "حالة جديدة", icon: "bi-person-plus", url: "javascript:void(0)", action: "Doctor.viewNewCase()", active: true },
        { title: "قائمة الانتظار", icon: "bi-person-badge", url: "javascript:void(0)", action: "Doctor.viewWaitingList()" },
        { title: "الطلبات المرسلة", icon: "bi-send-check", url: "javascript:void(0)", action: "Doctor.viewSentOrders()" },
        { title: "السجل الطبي", icon: "bi-folder2-open", url: "javascript:void(0)", action: "Doctor.viewMedicalArchive()" }
    ];
    Core.renderSidebar(doctorLinks);
    await Core.initRealtime(DoctorData.currentUser);
    Doctor.viewNewCase();
}
