/**
 * doctor_module.js
 * موديول الطبيب العام - النسخة التجريبية (MVP)
 * متوافق مع العرض الديناميكي للجداول ومجهز للربط المستقبلي بـ WebSockets
 */

const DoctorData = {
    currentUser: {}, 

    waiting_list: [
        { visit: "VIS-101", name: "محمد علي", type_case: "تسمم", time: "08:15 AM", diagnosis: "اشتباه تسمم غذائي حاد" },
        { visit: "VIS-102", name: "فاطمة أحمد", type_case: "حريق", time: "09:00 AM", diagnosis: "حروق من الدرجة الثانية في اليد اليمنى" },
        { visit: "VIS-103", name: "صالح عبدالكريم", type_case: "سقوط", time: "09:30 AM", diagnosis: "اشتباه كسر في الساعد" }
    ],

    data_patients: [
        {
            id_pat: "PAT-001", name: "سالم عبدالله", address: "السبعين / صنعاء", visit_num: 2, last_visit_date: "2026-03-20",
            medical_file: [
                { date_visit: "2026-03-20", type_case: "سقوط", diagnosis: "كدمات خفيفة في الركبة", procedures: "أشعة للقدم", notes: "راحة لمدة يومين مع مسكنات" },
                { date_visit: "2025-10-15", type_case: "حمى", diagnosis: "التهاب لوزتين", procedures: "فحص دم CBC", notes: "صرف مضاد حيوي" }
            ]
        },
        {
            id_pat: "PAT-002", name: "يحيى صالح المنعي", address: "عمران / حارة النصر", visit_num: 1, last_visit_date: "2026-01-10",
            medical_file: [
                { date_visit: "2026-01-10", type_case: "ضيق تنفس", diagnosis: "نوبة ربو خفيفة", procedures: "جلسة أكسجين", notes: "مراجعة العيادة بعد أسبوع" }
            ]
        }
    ],

    sent_orders: [
        { 
            visit: "VIS-101", name: "محمد علي", type_case: "تسمم", order_count: 2, 
            details: [
                { orders: "CBC, STOOL", time: "08:30 AM", status: "مكتمل" },
                { orders: "تركيب مغذية", time: "08:35 AM", status: "قيد الانتظار" }
            ]
        }
    ],

    caseTypes: ["طوارئ باطنية", "تسمم", "سقوط", "حوادث سير", "حروق", "نوبة قلبية", "ضيق تنفس", "إصابة عمل", "نزيف", "أخرى"],
    districts: ["السبعين", "الوحدة", "عمران", "التحرير", "بني الحارث"],
    availableServices: {
        lab: ["CBC", "STOOL", "سكر عشوائي", "وظائف كبد"],
        sur: ["خياطة جرح", "تركيب مغذية", "تغيير ضماد", "ضرب إبرة"],
        ray: ["أشعة صدر", "القدم اليسرى", "الجمجمة", "تلفزيون بطن"]
    }
};

const Doctor = {

    // --- 1. واجهة: حالة جديدة (New Case) ---
        // --- 1. واجهة: حالة جديدة (New Case) ---
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

    // مؤقت (Debounce) لمنع إرسال طلبات كثيرة للسيرفر مع كل حرف
    searchTimeout: null,
    handleSearchInput: function() {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.executeSearch();
        }, 400); // ينتظر 400 ملي ثانية بعد توقف المستخدم عن الكتابة
    },

    executeSearch: async function() {
        const query = document.getElementById('patientSearchInput').value.trim();
        const resultArea = document.getElementById('searchResultArea');

        if (query.length < 2) {
            resultArea.innerHTML = `<div class="text-center p-5 text-muted bg-white rounded-4 shadow-sm border"><i class="bi bi-search fs-1 mb-3 d-block text-secondary"></i><p>أدخل اسم المريض للبحث في قاعدة البيانات.</p></div>`;
            return;
        }

        resultArea.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>`;

        // الاتصال الحقيقي بالـ Backend
        const response = await Core.apiCall('doctor/search_patient', 'POST', { query: query });

        if (response && response.success) {
            const results = response.data;

            if (results.length > 0) {
                const headers = ['اسم المريض', 'العنوان', 'معلومات'];
                
                // دالة مساعدة لتلوين الكلمات المبحوث عنها
                const keywords = query.split(/\s+/).filter(kw => kw.length > 0);
                const highlightText = (text) => {
                    let highlighted = text;
                    keywords.forEach(kw => {
                        const regex = new RegExp(`(${kw})`, 'gi');
                        highlighted = highlighted.replace(regex, '<mark class="bg-warning px-1 rounded">$1</mark>');
                    });
                    return highlighted;
                };

                const rows = results.map(p => [
                    `<span class="fw-bold">${highlightText(p.full_name)}</span>`,
                    `${p.place1} / ${p.place2}`,
                    `<span class="badge bg-light text-dark border">زيارات سابقة: ${p.visit_num}</span>`
                ]);

                resultArea.innerHTML = `<div class="card stat-card p-0 border-0 shadow-sm" id="patientTableContainer"></div>`;
                
                Core.renderTable('patientTableContainer', headers, rows, (row, index) => {
                    const p = results[index]; 
                    return `
                        <button class="btn btn-primary btn-sm fw-bold px-3 shadow-sm" onclick="Doctor.openVisitModal('${p.patient_id}', '${p.full_name}')">
                            <i class="bi bi-door-open ms-1"></i> فتح زيارة
                        </button>`;
                });

            } else {
                resultArea.innerHTML = `
                    <div class="alert alert-warning p-4 border-0 shadow-sm d-flex flex-column flex-md-row justify-content-between align-items-center">
                        <div class="mb-3 mb-md-0"><i class="bi bi-person-exclamation fs-3 ms-3"></i><span class="fw-bold">المريض غير مسجل مسبقاً.</span></div>
                        <button class="btn btn-warning fw-bold px-4 shadow-sm" onclick="Doctor.openNewPatientModal('${query}')">
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

        const districtOptions = DoctorData.districts.map(d => `<option value="${d}">${d}</option>`).join('');
        const caseOptions = DoctorData.caseTypes.map(c => `<option value="${c}">${c}</option>`).join('');

        const modalHTML = `
        <div class="modal fade" id="newPatientModal" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-warning text-dark border-0">
                        <h5 class="modal-title fw-bold"><i class="bi bi-person-plus-fill me-2"></i>إضافة مريض وفتح زيارة</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-4 bg-light">
                        <div class="row g-3">
                            <div class="col-md-6"><label class="form-label small fw-bold">الاسم</label><input type="text" id="np_name" class="form-control shadow-none" value="${searchedName}"></div>
                            <div class="col-md-3"><label class="form-label small fw-bold">العمر</label><input type="number" id="np_age" class="form-control shadow-none"></div>
                            <div class="col-md-3"><label class="form-label small fw-bold">الجنس</label><select id="np_gender" class="form-select shadow-none"><option value="ذكر">ذكر</option><option value="أنثى">أنثى</option></select></div>
                            <div class="col-md-6"><label class="form-label small fw-bold">المديرية</label><select id="np_place1" class="form-select shadow-none">${districtOptions}</select></div>
                            <div class="col-md-6"><label class="form-label small fw-bold">الحي</label><input type="text" id="np_place2" class="form-control shadow-none"></div>
                            
                            <div class="col-12 mt-3"><hr></div>
                            <div class="col-md-6"><label class="form-label small fw-bold text-danger">نوع الحالة</label><select id="np_type_case" class="form-select shadow-none">${caseOptions}</select></div>
                            <div class="col-md-6"><label class="form-label small fw-bold text-primary">التشخيص المبدئي</label><input type="text" id="np_diagnosis" class="form-control shadow-none"></div>
                            <div class="col-12"><label class="form-label small fw-bold">ملاحظة</label><textarea id="np_note" class="form-control shadow-none" rows="2"></textarea></div>
                        </div>
                    </div>
                    <div class="modal-footer border-0">
                        <button class="btn btn-warning px-5 fw-bold shadow-sm" onclick="Doctor.saveNewPatient()">حفظ وفتح الزيارة</button>
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
            Core.showAlert('تم تسجيل المريض وفتح الزيارة بنجاح', 'success');
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
                    </div>
                    <div class="modal-footer border-0">
                        <button class="btn btn-primary px-5 fw-bold shadow-sm" onclick="Doctor.saveExistingPatientVisit('${id_pat}')">حفظ وفتح الزيارة</button>
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
            Core.showAlert('تم فتح الزيارة بنجاح', 'success');
        } else {
            Core.showAlert(response ? response.message : 'حدث خطأ أثناء فتح الزيارة', 'error');
        }
    },

// --- 2. واجهة: قائمة الانتظار (Waiting List) ---
    viewWaitingList: function() {
        Core.navigateTo('viewWaitingList', () => {
            const mainContent = document.getElementById('mainContent');
            const tools = [
                // تعديل بسيط هنا لكي يقوم الزر بتحديث البيانات من السيرفر مباشرة دون إعادة رسم الواجهة كاملة
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

        // إظهار مؤشر التحميل أثناء جلب البيانات من السيرفر
        container.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>`;

        // الاتصال الحقيقي بالـ Backend لجلب قائمة الانتظار للطبيب الحالي
        const response = await Core.apiCall('doctor/waiting_list', 'GET');

        if (response && response.success) {
            const activeList = response.data;

            if (activeList.length === 0) {
                container.innerHTML = `<div class="p-5 text-center text-muted"><i class="bi bi-check-circle fs-1 text-success mb-3 d-block"></i>لا توجد حالات في قائمة الانتظار حالياً.</div>`;
                return;
            }

            const headers = ["المريض", "الحالة", "التشخيص المبدئي", "الوقت", "الاجراء"];
            const rows = activeList.map(item => [
                `<span class="fw-bold text-dark">${item.name}</span>`,
                `<span class="badge bg-warning bg-opacity-10 text-warning px-3">${item.type_case}</span>`,
                `<span class="small text-muted">${item.diagnosis}</span>`,
                item.time
            ]);

            Core.renderTable('waitingListContainer', headers, rows, (row, index) => {
                const item = activeList[index];
                return `
                    <div class="d-flex gap-2">
                        <button class="btn btn-outline-primary btn-sm fw-bold shadow-sm" onclick="Doctor.openOrdersModal('${item.visit}', '${item.name}')">الطلبات</button>
                        <button class="btn btn-success btn-sm fw-bold shadow-sm" onclick="Doctor.openFinalDiagnosisModal('${item.visit}', '${item.name}', '${item.diagnosis}')">التشخيص النهائي</button>
                        <button class="btn btn-dark btn-sm shadow-sm" onclick="Doctor.viewFullFile('${item.patient_id}')" title="الملف الكامل"><i class="bi bi-folder2-open"></i></button>
                    </div>`;
            });
        } else {
            container.innerHTML = `<div class="p-5 text-center text-danger"><i class="bi bi-exclamation-triangle fs-1 mb-3 d-block"></i>حدث خطأ أثناء جلب قائمة الانتظار.</div>`;
        }
    },

    // ... (دوال openOrdersModal و sendOrders تبقى كما هي مؤقتاً وسنحدثها في الخطوة القادمة) ...

    // تحديث دالة حفظ التشخيص النهائي لتلغي الاعتماد على localStorage
    saveFinalDiagnosis: async function(id_vis) {
        const diagnosis = document.getElementById('final_diag_text').value;
        if(!diagnosis) return Core.showAlert('يرجى كتابة التشخيص النهائي', 'error');

        // إرسال التشخيص للسيرفر
        const response = await Core.apiCall('doctor/final_diagnosis', 'POST', { id_vis: id_vis, diagnosis: diagnosis });
        
        if (response && response.success) {
            bootstrap.Modal.getInstance(document.getElementById('finalDiagModal')).hide();
            Core.showAlert('تم حفظ التشخيص وإغلاق الزيارة بنجاح', 'success');
            
            // تحديث الجدول مباشرة من السيرفر (المريض سيختفي تلقائياً لأن حالته أصبحت Completed في القاعدة)
            this.loadWaitingList(); 
        } else {
            Core.showAlert(response ? response.message : 'حدث خطأ أثناء حفظ التشخيص', 'error');
        }
    },
// دالة مساعدة لرسم مربعات الاختيار داخل التبويبات (نفس التصميم الأصلي)
    renderServiceCheckboxes: function(category, items) {
        if (!items || items.length === 0) return `<div class="text-muted small">لا توجد خدمات في هذا القسم.</div>`;
        return `
        <div class="row g-2">
            ${items.map(item => `
                <div class="col-md-6">
                    <div class="form-check p-2 border rounded-3 hover-shadow bg-light">
                        <input class="form-check-input ms-2" type="checkbox" value="${item.id}" data-cat="${category}" id="check_${item.id}">
                        <label class="form-check-label small fw-bold" for="check_${item.id}">${item.name}</label>
                    </div>
                </div>`).join('')}
        </div>`;
    },
    openOrdersModal: function(id_vis, name) {
        const existing = document.getElementById('ordersModal');
        if (existing) existing.remove();

        // استخدام نفس تصميم التبويبات (Nav Pills) الأصلي والأنيق
        const modalHTML = `
        <div class="modal fade" id="ordersModal" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-primary text-white border-0 py-3">
                        <h5 class="modal-title fw-bold"><i class="bi bi-file-medical ms-2"></i>إرسال طلبات: ${name}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-4 bg-light">
                        <div class="card p-3 border-0 shadow-sm">
                            <ul class="nav nav-pills mb-3 gap-2" id="pills-tab" role="tablist">
                                <li class="nav-item">
                                    <button class="nav-link active btn-sm px-4 fw-bold" data-bs-toggle="pill" data-bs-target="#tab-lab">مختبر</button>
                                </li>
                                <li class="nav-item">
                                    <button class="nav-link btn-sm px-4 fw-bold" data-bs-toggle="pill" data-bs-target="#tab-ray">أشعة</button>
                                </li>
                                <li class="nav-item">
                                    <button class="nav-link btn-sm px-4 fw-bold" data-bs-toggle="pill" data-bs-target="#tab-sur">تمريض</button>
                                </li>
                            </ul>
                            <div class="tab-content border p-3 rounded-3 bg-white" id="pills-tabContent" style="min-height: 200px;">
                                <div class="tab-pane fade show active" id="tab-lab">
                                    ${this.renderServiceCheckboxes('lab', DoctorData.availableServices.lab)}
                                </div>
                                <div class="tab-pane fade" id="tab-ray">
                                    ${this.renderServiceCheckboxes('ray', DoctorData.availableServices.ray)}
                                </div>
                                <div class="tab-pane fade" id="tab-sur">
                                    ${this.renderServiceCheckboxes('sur', DoctorData.availableServices.sur)}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer border-0 bg-white">
                        <button class="btn btn-light px-4 fw-bold" data-bs-dismiss="modal">إلغاء</button>
                        <button class="btn btn-primary px-5 fw-bold shadow-sm" onclick="Doctor.sendOrders('${id_vis}')">إرسال الطلبات للأقسام</button>
                    </div>
                </div>
            </div>
        </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        new bootstrap.Modal(document.getElementById('ordersModal')).show();
    },
    sendOrders: async function(id_vis) {
        const payload = { id_vis: id_vis, order: { lab: [], sur: [], ray: [] } };
        
        document.querySelectorAll('#ordersModal input[type="checkbox"]:checked').forEach(chk => {
            const cat = chk.getAttribute('data-cat');
            payload.order[cat].push(parseInt(chk.value));
        });

        if (payload.order.lab.length === 0 && payload.order.sur.length === 0 && payload.order.ray.length === 0) {
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

    openFinalDiagnosisModal: function(id_vis, name, initialDiag) {
        const existing = document.getElementById('finalDiagModal');
        if (existing) existing.remove();

        const modalHTML = `
        <div class="modal fade" id="finalDiagModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-success text-white border-0">
                        <h5 class="modal-title fw-bold">التشخيص النهائي وإغلاق الزيارة: ${name}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-4">
                        <label class="form-label small fw-bold text-success">التشخيص النهائي</label>
                        <textarea id="final_diag_text" class="form-control shadow-none border-success" rows="4">${initialDiag}</textarea>
                    </div>
                    <div class="modal-footer border-0 bg-light">
                        <button class="btn btn-success px-5 fw-bold shadow-sm" onclick="Doctor.saveFinalDiagnosis('${id_vis}')">حفظ وإغلاق الزيارة</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        new bootstrap.Modal(document.getElementById('finalDiagModal')).show();
    },

    // --- 3. واجهة: الطلبات المرسلة (Sent Orders) ---
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
        
        // مؤشر التحميل
        container.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>`;
        
        // جلب البيانات من السيرفر
        const response = await Core.apiCall('doctor/sent_orders', 'GET');
        
        if (response && response.success) {
            // حفظ البيانات محلياً لتستخدمها نافذة "عرض الطلبات" دون الحاجة لطلب السيرفر مرة أخرى
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

  // --- 4. واجهة: السجل الطبي (Medical Record) ---
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

        // إذا لم يتم تمرير بيانات مفلترة، نجلبها من السيرفر
        if (!filteredData) {
            container.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>`;
            const response = await Core.apiCall('doctor/medical_archive', 'GET');
            
            if (response && response.success) {
                DoctorData.data_patients = response.data; // حفظها محلياً لتسريع البحث
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
        // تصفية البيانات المحفوظة محلياً بناءً على الاسم لسرعة الاستجابة
        const filtered = DoctorData.data_patients.filter(p => p.name.toLowerCase().includes(query));
        this.loadMedicalArchive(filtered);
    },

    viewFullFile: async function(patient_id) {
        const existing = document.getElementById('historyModal');
        if (existing) existing.remove();

        // جلب السجل الطبي من السيرفر إذا لم يكن محملاً
        let patient = DoctorData.data_patients.find(p => p.id_pat == patient_id);
        if (!patient) {
            const response = await Core.apiCall('doctor/medical_archive', 'GET');
            if (response && response.success) {
                DoctorData.data_patients = response.data;
                patient = DoctorData.data_patients.find(p => p.id_pat == patient_id);
            }
        }
        if (!patient) { Core.showAlert('لم يتم العثور على الملف الطبي', 'warning'); return; }

        const rows = patient.medical_file.map(v => `
            <tr>
                <td class="small fw-bold text-muted text-end">${v.date_visit}</td>
                <td class="text-end"><span class="badge bg-warning bg-opacity-10 text-warning">${v.type_case}</span></td>
                <td class="small fw-bold text-end">${v.diagnosis}</td>
                <td class="small text-primary text-end">${v.procedures}</td>
                <td class="small text-muted text-end">${v.notes}</td>
            </tr>`).join('');

        const modalHTML = `
        <div class="modal fade" id="historyModal" tabindex="-1">
            <div class="modal-dialog modal-xl modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-dark text-white border-0 py-3">
                        <h5 class="modal-title fw-bold">الملف الطبي الكامل: ${patient.name}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-0">
                        <div class="table-responsive">
                            <table class="table table-hover align-middle bg-white mb-0">
                                <thead class="table-secondary small text-end">
                                    <tr><th>التاريخ</th><th>الحالة</th><th>التشخيص النهائي</th><th>الإجراءات / الطلبات</th><th>الملاحظات</th></tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        new bootstrap.Modal(document.getElementById('historyModal')).show();
    }
};
initDoctorModule();
// --- دالة التهيئة التي تعمل فوراً عند الحقن الديناميكي ---
async function initDoctorModule() {
    const response = await Core.apiCall('auth/me', 'GET');
    if(response && response.success) {
        DoctorData.currentUser = response.data;
        Core.renderProfile(DoctorData.currentUser);
    }

    // === الإضافة الجديدة: جلب الخدمات من السيرفر ===
    const servicesResponse = await Core.apiCall('doctor/services_list', 'GET');
    if (servicesResponse && servicesResponse.success) {
        DoctorData.availableServices = servicesResponse.data; // استبدال البيانات الوهمية بالحقيقية
    }
    // ===========================================

    const doctorLinks = [
        { title: "حالة جديدة", icon: "bi-person-plus", url: "javascript:void(0)", action: "Doctor.viewNewCase()", active: true },
        { title: "قائمة الانتظار", icon: "bi-person-badge", url: "javascript:void(0)", action: "Doctor.viewWaitingList()" },
        { title: "الطلبات المرسلة", icon: "bi-send-check", url: "javascript:void(0)", action: "Doctor.viewSentOrders()" },
        { title: "السجل الطبي", icon: "bi-folder2-open", url: "javascript:void(0)", action: "Doctor.viewMedicalArchive()" }
    ];
    Core.renderSidebar(doctorLinks);
    Doctor.viewNewCase();
}