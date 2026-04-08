const AdminData = {
    currentUser: {},
    schema: [],
    schemaMap: {},
    dashboard: null,
    currentTable: null,
    currentRows: [],
    currentMeta: null,
    filters: {},
    search: '',
    sortBy: null,
    sortDir: 'DESC',
    page: 1,
    perPage: 15,
};

const Admin = {
    init: async function() {
        const me = await Core.apiCall('auth/me', 'GET');
        if (!me || !me.success) {
            Core.showAlert('تعذر تحميل بيانات المدير.', 'error');
            return;
        }

        AdminData.currentUser = me.data;
        Core.renderProfile(AdminData.currentUser);

        const schemaRes = await Core.apiCall('admin/schema', 'GET');
        if (!schemaRes || !schemaRes.success) {
            Core.showAlert('تعذر تحميل بنية قاعدة البيانات.', 'error');
            return;
        }

        AdminData.schema = schemaRes.data.tables || [];
        AdminData.schemaMap = Object.fromEntries(AdminData.schema.map(table => [table.table, table]));
        this.renderSidebar();
        await Core.initRealtime(AdminData.currentUser);
        await this.viewDashboard();
    },

    renderSidebar: function() {
        const links = [
            { title: 'الرئيسية التحليلية', icon: 'bi-speedometer2', url: 'javascript:void(0)', action: 'Admin.viewDashboard()', active: !AdminData.currentTable },
            ...AdminData.schema.map(table => ({
                title: table.label,
                icon: this.getTableIcon(table.table),
                url: 'javascript:void(0)',
                action: `Admin.openTable('${table.table}')`,
                active: AdminData.currentTable === table.table,
            })),
        ];
        Core.renderSidebar(links);
    },

    getTableIcon: function(tableName) {
        const map = {
            users: 'bi-people',
            roles: 'bi-shield-lock',
            patients: 'bi-person-vcard',
            visits: 'bi-clipboard2-pulse',
            invoices: 'bi-receipt',
            invoice_details: 'bi-list-check',
            document_types: 'bi-file-earmark-text',
            services_master: 'bi-bandaid',
            service_categories: 'bi-diagram-3',
            emergency_case_types: 'bi-heart-pulse',
            medical_results: 'bi-clipboard2-data',
            notifications: 'bi-bell',
            examination_tickets: 'bi-ticket-perforated',
        };
        return map[tableName] || 'bi-table';
    },

    viewDashboard: async function() {
        AdminData.currentTable = null;
        this.renderSidebar();
        Core.navigateTo('Admin.viewDashboard', async () => {
            const response = await Core.apiCall('admin/dashboard', 'GET');
            if (!response || !response.success) {
                document.getElementById('mainContent').innerHTML = this.renderErrorState('تعذر تحميل لوحة التحليلات.');
                return;
            }

            AdminData.dashboard = response.data;
            const stats = response.data.stats || {};
            const topTables = response.data.tables || [];
            const cards = [
                { label: 'المستخدمون الفعّالون', value: stats.active_users_count || 0, icon: 'bi-people-fill', color: 'icon-blue' },
                { label: 'الزيارات النشطة', value: stats.active_visits_count || 0, icon: 'bi-heart-pulse-fill', color: 'icon-green' },
                { label: 'إيراد اليوم', value: this.formatCurrency(stats.revenue_today || 0), icon: 'bi-cash-coin', color: 'icon-orange' },
                { label: 'الفواتير غير المحصلة', value: stats.pending_invoices_count || 0, icon: 'bi-hourglass-split', color: 'icon-blue' },
                { label: 'تذاكر اليوم', value: stats.tickets_today || 0, icon: 'bi-ticket-perforated-fill', color: 'icon-green' },
                { label: 'إجمالي الجداول', value: stats.tables_count || 0, icon: 'bi-grid-3x3-gap-fill', color: 'icon-orange' },
            ].map(card => `
                <div class="col-12 col-md-6 col-xl-4">
                    <div class="stat-card p-4 h-100">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <div class="stat-icon ${card.color}"><i class="bi ${card.icon}"></i></div>
                            <span class="badge bg-light text-dark fw-bold">لوحة المدير</span>
                        </div>
                        <h6 class="text-muted mb-2">${card.label}</h6>
                        <h2 class="fw-bold mb-0 text-dark">${card.value}</h2>
                    </div>
                </div>
            `).join('');

            const tableRows = topTables.map(table => `
                <tr>
                    <td class="fw-bold">${table.label}</td>
                    <td><span class="badge bg-primary-subtle text-primary">${table.table}</span></td>
                    <td>${table.count}</td>
                    <td>${table.primary_key}</td>
                    <td>
                        <button class="btn-action btn-view" onclick="Admin.openTable('${table.table}')">
                            <i class="bi bi-eye"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

            document.getElementById('mainContent').innerHTML = `
                ${Core.renderHeaderWithTools('لوحة إدارة النظام', 'تحليل شامل لبنية قاعدة البيانات وإدارة مباشرة لكل الجداول')}
                <div class="row g-4 mb-4">${cards}</div>
                <div class="row g-4">
                    <div class="col-12 col-xl-7">
                        <div class="card border-0 shadow-sm rounded-4 h-100">
                            <div class="card-body p-4">
                                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                                    <div>
                                        <h5 class="fw-bold mb-1 text-dark">إحصائيات التشغيل</h5>
                                        <p class="text-muted small mb-0">ملخص سريع لواقع النظام الحالي.</p>
                                    </div>
                                    <button class="btn btn-outline-primary rounded-pill" onclick="Admin.viewDashboard()">
                                        <i class="bi bi-arrow-repeat ms-1"></i> تحديث
                                    </button>
                                </div>
                                <div class="row row-cols-1 row-cols-md-2 g-3">
                                    ${this.renderMiniStat('إجمالي المستخدمين', stats.users_count || 0, 'bi-person-lines-fill')}
                                    ${this.renderMiniStat('إجمالي المرضى', stats.patients_count || 0, 'bi-people')}
                                    ${this.renderMiniStat('الزيارات المكتملة', stats.completed_visits_count || 0, 'bi-check2-circle')}
                                    ${this.renderMiniStat('الفواتير المحصلة اليوم', stats.paid_invoices_today || 0, 'bi-receipt-cutoff')}
                                    ${this.renderMiniStat('إشعارات اليوم', stats.notifications_today || 0, 'bi-bell-fill')}
                                    ${this.renderMiniStat('حجم البيانات', topTables.reduce((sum, item) => sum + Number(item.count || 0), 0), 'bi-database-fill')}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12 col-xl-5">
                        <div class="card border-0 shadow-sm rounded-4 h-100">
                            <div class="card-body p-4">
                                <h5 class="fw-bold mb-1 text-dark">الجداول الأعلى من حيث السجلات</h5>
                                <p class="text-muted small mb-3">يمكن فتح أي جدول مباشرة وإدارة سجلاته عبر CRUD.</p>
                                <div class="table-responsive">
                                    <table class="custom-table text-end mb-0">
                                        <thead>
                                            <tr>
                                                <th>الجدول</th>
                                                <th>الاسم التقني</th>
                                                <th>عدد السجلات</th>
                                                <th>المفتاح</th>
                                                <th>إجراء</th>
                                            </tr>
                                        </thead>
                                        <tbody>${tableRows}</tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
    },

    renderMiniStat: function(label, value, icon) {
        return `
            <div class="col">
                <div class="border rounded-4 p-3 h-100 bg-light-subtle">
                    <div class="d-flex align-items-center gap-3">
                        <div class="stat-icon icon-blue" style="width:48px;height:48px;font-size:1.2rem;">
                            <i class="bi ${icon}"></i>
                        </div>
                        <div>
                            <div class="text-muted small">${label}</div>
                            <div class="fw-bold fs-4 text-dark">${value}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    openTable: async function(tableName) {
        AdminData.currentTable = tableName;
        AdminData.page = 1;
        AdminData.search = '';
        AdminData.filters = {};
        AdminData.sortBy = null;
        AdminData.sortDir = 'DESC';
        this.renderSidebar();
        await this.loadTableData();
    },

    loadTableData: async function() {
        const tableMeta = AdminData.schemaMap[AdminData.currentTable];
        if (!tableMeta) return;

        Core.navigateTo(`Admin.openTable('${AdminData.currentTable}')`, async () => {
            document.getElementById('mainContent').innerHTML = this.renderLoadingState(tableMeta.label);
            const response = await Core.apiCall('admin/list', 'POST', {
                table: AdminData.currentTable,
                page: AdminData.page,
                per_page: AdminData.perPage,
                search: AdminData.search,
                filters: AdminData.filters,
                sort_by: AdminData.sortBy,
                sort_dir: AdminData.sortDir,
            });

            if (!response || !response.success) {
                document.getElementById('mainContent').innerHTML = this.renderErrorState(response?.message || 'تعذر تحميل البيانات.');
                return;
            }

            AdminData.currentRows = response.data.rows || [];
            AdminData.currentMeta = response.data.meta || null;
            this.renderTableScreen(tableMeta, AdminData.currentRows, AdminData.currentMeta);
        });
    },

    renderTableScreen: function(tableMeta, rows, meta) {
        const visibleColumns = Object.values(tableMeta.columns).filter(column => column.visible_in_list !== false);
        const cardsSummary = `
            <div class="row g-3 mb-4">
                <div class="col-12 col-md-4">
                    <div class="stat-card p-3 h-100">
                        <div class="text-muted small">إجمالي السجلات</div>
                        <div class="fw-bold fs-3 text-dark">${meta.total}</div>
                    </div>
                </div>
                <div class="col-12 col-md-4">
                    <div class="stat-card p-3 h-100">
                        <div class="text-muted small">الصفحة الحالية</div>
                        <div class="fw-bold fs-3 text-dark">${meta.page} / ${Math.max(meta.pages, 1)}</div>
                    </div>
                </div>
                <div class="col-12 col-md-4">
                    <div class="stat-card p-3 h-100">
                        <div class="text-muted small">البحث / الفلاتر</div>
                        <div class="fw-bold fs-5 text-dark">${AdminData.search || Object.keys(AdminData.filters).length ? 'مفعّلة' : 'غير مفعّلة'}</div>
                    </div>
                </div>
            </div>
        `;

        const rowsHtml = rows.length ? rows.map(row => this.renderRow(tableMeta, visibleColumns, row)).join('') : `
            <tr>
                <td colspan="${visibleColumns.length + 1}" class="text-center text-muted py-5">لا توجد بيانات مطابقة لنتيجة البحث الحالية.</td>
            </tr>
        `;

        const filterFields = Object.values(tableMeta.columns).filter(column => column.name !== 'password_hash').map(column => this.renderFilterField(column)).join('');

        document.getElementById('mainContent').innerHTML = `
            ${Core.renderHeaderWithTools(tableMeta.label, `إدارة مباشرة لجدول ${tableMeta.table}`, [
                { label: 'إضافة سجل جديد', icon: 'bi-plus-circle', action: `Admin.openForm('${tableMeta.table}')` },
                { label: 'إعادة تحميل البيانات', icon: 'bi-arrow-repeat', action: 'Admin.loadTableData()' },
                { label: 'فتح لوحة المؤشرات', icon: 'bi-speedometer2', action: 'Admin.viewDashboard()' },
            ])}
            ${cardsSummary}
            <div class="card border-0 shadow-sm rounded-4 mb-4">
                <div class="card-body p-4">
                    <div class="row g-3 align-items-end mb-3">
                        <div class="col-12 col-lg-5">
                            <label class="form-label fw-bold">بحث عام داخل الجدول</label>
                            <div class="input-group">
                                <span class="input-group-text"><i class="bi bi-search"></i></span>
                                <input id="admin-global-search" class="form-control" placeholder="ابحث بالاسم أو الرقم أو التاريخ..." value="${this.escapeHtml(AdminData.search)}">
                            </div>
                        </div>
                        <div class="col-12 col-lg-3">
                            <label class="form-label fw-bold">عدد السجلات في الصفحة</label>
                            <select id="admin-per-page" class="form-select">
                                ${[10,15,25,50,100].map(size => `<option value="${size}" ${Number(AdminData.perPage) === size ? 'selected' : ''}>${size}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-12 col-lg-4 d-flex gap-2 flex-wrap">
                            <button class="btn btn-primary rounded-pill px-4" onclick="Admin.applySearch()"><i class="bi bi-funnel ms-1"></i> تطبيق</button>
                            <button class="btn btn-outline-secondary rounded-pill px-4" onclick="Admin.resetFilters()"><i class="bi bi-eraser ms-1"></i> مسح</button>
                            <button class="btn btn-outline-success rounded-pill px-4" onclick="Admin.openForm('${tableMeta.table}')"><i class="bi bi-plus-circle ms-1"></i> إضافة</button>
                        </div>
                    </div>
                    <div class="border rounded-4 p-3 bg-light-subtle">
                        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                            <div>
                                <h6 class="fw-bold mb-1">فلترة متقدمة</h6>
                                <span class="text-muted small">يمكن إدخال قيمة مباشرة أو نطاق من/إلى للحقل الرقمي أو التاريخي.</span>
                            </div>
                        </div>
                        <div class="row g-3">${filterFields}</div>
                    </div>
                </div>
            </div>
            <div class="card border-0 shadow-sm rounded-4">
                <div class="card-body p-0">
                    <div class="table-responsive">
                        <table class="custom-table text-end mb-0">
                            <thead>
                                <tr>
                                    ${visibleColumns.map(column => this.renderSortableHeader(column)).join('')}
                                    <th style="width:140px">الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>${rowsHtml}</tbody>
                        </table>
                    </div>
                </div>
            </div>
            ${this.renderPagination(meta)}
        `;
    },

    renderSortableHeader: function(column) {
        const isActive = AdminData.sortBy === column.name;
        const icon = !isActive ? 'bi-arrow-down-up' : (AdminData.sortDir === 'ASC' ? 'bi-sort-down' : 'bi-sort-up');
        return `
            <th>
                <button class="btn btn-sm border-0 p-0 fw-bold text-muted" onclick="Admin.sortBy('${column.name}')">
                    ${column.label}
                    <i class="bi ${icon} ms-1"></i>
                </button>
            </th>
        `;
    },

    renderFilterField: function(column) {
        if (column.is_numeric || column.is_date_like) {
            return `
                <div class="col-12 col-md-6 col-xl-4">
                    <label class="form-label small fw-bold">${column.label}</label>
                    <div class="input-group input-group-sm mb-2">
                        <span class="input-group-text">من</span>
                        <input class="form-control" id="filter-${column.name}-from" value="${this.escapeHtml(AdminData.filters?.[column.name]?.from || '')}" ${column.is_date_like ? 'type="date"' : 'type="number" step="any"'}>
                    </div>
                    <div class="input-group input-group-sm">
                        <span class="input-group-text">إلى</span>
                        <input class="form-control" id="filter-${column.name}-to" value="${this.escapeHtml(AdminData.filters?.[column.name]?.to || '')}" ${column.is_date_like ? 'type="date"' : 'type="number" step="any"'}>
                    </div>
                </div>
            `;
        }

        if (column.is_boolean) {
            return `
                <div class="col-12 col-md-6 col-xl-3">
                    <label class="form-label small fw-bold">${column.label}</label>
                    <select id="filter-${column.name}" class="form-select form-select-sm">
                        <option value="">الكل</option>
                        <option value="true" ${AdminData.filters?.[column.name] === 'true' ? 'selected' : ''}>نعم</option>
                        <option value="false" ${AdminData.filters?.[column.name] === 'false' ? 'selected' : ''}>لا</option>
                    </select>
                </div>
            `;
        }

        return `
            <div class="col-12 col-md-6 col-xl-3">
                <label class="form-label small fw-bold">${column.label}</label>
                <input id="filter-${column.name}" class="form-control form-control-sm" value="${this.escapeHtml(AdminData.filters?.[column.name] || '')}" placeholder="اكتب قيمة للفلترة">
            </div>
        `;
    },

    renderRow: function(tableMeta, columns, row) {
        const pk = tableMeta.primary_key;
        const cells = columns.map(column => `<td>${this.renderCellValue(column, row[column.name])}</td>`).join('');
        return `
            <tr>
                ${cells}
                <td>
                    <div class="d-flex gap-2 justify-content-start">
                        <button class="btn-action btn-view" title="عرض / تعديل" onclick="Admin.openForm('${tableMeta.table}', ${Number(row[pk])})"><i class="bi bi-pencil-square"></i></button>
                        <button class="btn-action btn-delete" title="حذف" onclick="Admin.deleteRecord('${tableMeta.table}', ${Number(row[pk])})"><i class="bi bi-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    },

    renderCellValue: function(column, value) {
        if (value === null || value === '') {
            return '<span class="text-muted">—</span>';
        }
        if (column.name === 'password_hash') {
            return '<span class="badge bg-secondary">مخفي</span>';
        }
        if (column.is_boolean) {
            return value === true || value === 't' || value === 'true'
                ? '<span class="badge bg-success-subtle text-success">نعم</span>'
                : '<span class="badge bg-secondary-subtle text-secondary">لا</span>';
        }
        const text = String(value);
        return text.length > 80 ? `<span title="${this.escapeHtml(text)}">${this.escapeHtml(text.slice(0, 80))}...</span>` : this.escapeHtml(text);
    },

    renderPagination: function(meta) {
        if (!meta || meta.pages <= 1) return '';
        const pages = [];
        const start = Math.max(1, meta.page - 2);
        const end = Math.min(meta.pages, meta.page + 2);
        for (let i = start; i <= end; i++) {
            pages.push(`
                <li class="page-item ${i === meta.page ? 'active' : ''}">
                    <button class="page-link" onclick="Admin.goToPage(${i})">${i}</button>
                </li>
            `);
        }
        return `
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-3 mt-4">
                <div class="text-muted small">إجمالي النتائج: ${meta.total}</div>
                <nav>
                    <ul class="pagination mb-0">
                        <li class="page-item ${meta.page <= 1 ? 'disabled' : ''}"><button class="page-link" onclick="Admin.goToPage(${meta.page - 1})">السابق</button></li>
                        ${pages.join('')}
                        <li class="page-item ${meta.page >= meta.pages ? 'disabled' : ''}"><button class="page-link" onclick="Admin.goToPage(${meta.page + 1})">التالي</button></li>
                    </ul>
                </nav>
            </div>
        `;
    },

    collectFilters: function() {
        const tableMeta = AdminData.schemaMap[AdminData.currentTable];
        const filters = {};
        Object.values(tableMeta.columns).forEach(column => {
            if (column.is_numeric || column.is_date_like) {
                const from = document.getElementById(`filter-${column.name}-from`)?.value || '';
                const to = document.getElementById(`filter-${column.name}-to`)?.value || '';
                if (from || to) filters[column.name] = { from, to };
                return;
            }
            const value = document.getElementById(`filter-${column.name}`)?.value || '';
            if (value !== '') filters[column.name] = value;
        });
        return filters;
    },

    applySearch: async function() {
        AdminData.search = document.getElementById('admin-global-search')?.value?.trim() || '';
        AdminData.perPage = Number(document.getElementById('admin-per-page')?.value || 15);
        AdminData.filters = this.collectFilters();
        AdminData.page = 1;
        await this.loadTableData();
    },

    resetFilters: async function() {
        AdminData.search = '';
        AdminData.filters = {};
        AdminData.page = 1;
        await this.loadTableData();
    },

    sortBy: async function(columnName) {
        if (AdminData.sortBy === columnName) {
            AdminData.sortDir = AdminData.sortDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            AdminData.sortBy = columnName;
            AdminData.sortDir = 'ASC';
        }
        await this.loadTableData();
    },

    goToPage: async function(page) {
        if (page < 1) return;
        AdminData.page = page;
        await this.loadTableData();
    },

    openForm: async function(tableName, id = null) {
        const tableMeta = AdminData.schemaMap[tableName];
        if (!tableMeta) return;
        let record = {};
        if (id) {
            const response = await Core.apiCall('admin/record', 'POST', { table: tableName, id });
            if (!response || !response.success) {
                Core.showAlert(response?.message || 'تعذر جلب بيانات السجل.', 'error');
                return;
            }
            record = response.data.record || {};
        }

        const fieldsHtml = Object.values(tableMeta.columns)
            .filter(column => !column.auto_increment && column.editable !== false)
            .map(column => this.renderFormField(tableMeta, column, record[column.name]))
            .join('');

        const modalId = 'adminCrudModal';
        document.getElementById(modalId)?.remove();
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="${modalId}" tabindex="-1">
                <div class="modal-dialog modal-xl modal-dialog-scrollable">
                    <div class="modal-content rounded-4 border-0 shadow-lg">
                        <div class="modal-header bg-dark text-white">
                            <h5 class="modal-title fw-bold"><i class="bi bi-database-gear ms-2"></i>${id ? 'تعديل سجل' : 'إضافة سجل جديد'} — ${tableMeta.label}</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body bg-light">
                            <div class="row g-3">${fieldsHtml}</div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-secondary rounded-pill px-4" data-bs-dismiss="modal">إلغاء</button>
                            <button class="btn btn-primary rounded-pill px-4" onclick="Admin.saveRecord('${tableName}', ${id || 'null'})">حفظ</button>
                        </div>
                    </div>
                </div>
            </div>
        `);
        new bootstrap.Modal(document.getElementById(modalId)).show();
    },

    renderFormField: function(tableMeta, column, value) {
        const id = `field-${column.name}`;
        const currentValue = value ?? '';
        const required = !column.nullable && !column.has_default && !column.auto_increment;
        const label = `${column.label}${required ? ' <span class="text-danger">*</span>' : ''}`;

        if (column.name === tableMeta.primary_key && column.auto_increment) {
            return '';
        }

        if (column.name === 'password_hash') {
            return `
                <div class="col-12 col-md-6">
                    <label class="form-label fw-bold">${label}</label>
                    <input id="${id}" type="password" class="form-control" placeholder="${value ? 'اتركه فارغاً إذا لم تُرد التغيير' : 'أدخل كلمة المرور'}">
                </div>
            `;
        }

        if (column.foreign && column.foreign_options?.length) {
            return `
                <div class="col-12 col-md-6">
                    <label class="form-label fw-bold">${label}</label>
                    <select id="${id}" class="form-select">
                        <option value="">${column.nullable ? 'اختياري' : 'اختر قيمة'}</option>
                        ${column.foreign_options.map(option => `<option value="${option.value}" ${String(currentValue) === String(option.value) ? 'selected' : ''}>${this.escapeHtml(String(option.label))}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        if (column.enum_values?.length) {
            return `
                <div class="col-12 col-md-6">
                    <label class="form-label fw-bold">${label}</label>
                    <select id="${id}" class="form-select">
                        <option value="">${column.nullable ? 'اختياري' : 'اختر قيمة'}</option>
                        ${column.enum_values.map(option => `<option value="${this.escapeHtml(String(option))}" ${String(currentValue) === String(option) ? 'selected' : ''}>${this.escapeHtml(String(option))}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        if (column.is_boolean) {
            return `
                <div class="col-12 col-md-4">
                    <label class="form-label fw-bold">${label}</label>
                    <select id="${id}" class="form-select">
                        <option value="true" ${currentValue === true || currentValue === 'true' || currentValue === 't' ? 'selected' : ''}>نعم</option>
                        <option value="false" ${currentValue === false || currentValue === 'false' || currentValue === 'f' ? 'selected' : ''}>لا</option>
                    </select>
                </div>
            `;
        }

        const inputType = column.is_numeric ? 'number' : (column.is_date_like ? (column.data_type.includes('timestamp') ? 'datetime-local' : 'date') : 'text');
        if (column.data_type === 'text' || ['notes', 'body', 'result_text', 'diagnosis'].includes(column.name)) {
            return `
                <div class="col-12">
                    <label class="form-label fw-bold">${label}</label>
                    <textarea id="${id}" class="form-control" rows="3" placeholder="أدخل ${column.label}">${this.escapeHtml(String(currentValue || ''))}</textarea>
                </div>
            `;
        }

        return `
            <div class="col-12 col-md-6">
                <label class="form-label fw-bold">${label}</label>
                <input id="${id}" type="${inputType}" ${column.is_numeric ? 'step="any"' : ''} class="form-control" value="${this.escapeHtml(this.formatInputValue(currentValue, column))}" placeholder="أدخل ${column.label}">
            </div>
        `;
    },

    formatInputValue: function(value, column) {
        if (value === null || value === undefined) return '';
        if (!column.is_date_like) return String(value);
        const raw = String(value);
        if (column.data_type.includes('timestamp')) {
            return raw.replace(' ', 'T').slice(0, 16);
        }
        return raw.slice(0, 10);
    },

    saveRecord: async function(tableName, id = null) {
        const tableMeta = AdminData.schemaMap[tableName];
        const record = {};
        Object.values(tableMeta.columns).forEach(column => {
            if (column.auto_increment) return;
            const el = document.getElementById(`field-${column.name}`);
            if (!el) return;
            record[column.name] = el.value;
        });

        const response = await Core.apiCall('admin/save', 'POST', {
            table: tableName,
            id,
            record,
        });

        if (!response || !response.success) {
            Core.showAlert(response?.message || 'تعذر حفظ السجل.', 'error');
            return;
        }

        Core.showAlert(response.message || 'تم الحفظ بنجاح.', 'success');
        bootstrap.Modal.getInstance(document.getElementById('adminCrudModal'))?.hide();
        if (AdminData.currentTable === tableName) {
            await this.loadTableData();
        } else {
            await this.openTable(tableName);
        }
    },

    deleteRecord: async function(tableName, id) {
        if (!confirm('هل أنت متأكد من حذف هذا السجل؟')) return;
        const response = await Core.apiCall('admin/delete', 'POST', { table: tableName, id });
        if (!response || !response.success) {
            Core.showAlert(response?.message || 'تعذر حذف السجل.', 'error');
            return;
        }
        Core.showAlert(response.message || 'تم الحذف بنجاح.', 'success');
        await this.loadTableData();
    },

    renderLoadingState: function(label) {
        return `
            ${Core.renderHeaderWithTools(label, 'جاري تحميل البيانات...')}
            <div class="card border-0 shadow-sm rounded-4">
                <div class="card-body text-center py-5">
                    <div class="spinner-border text-primary mb-3"></div>
                    <p class="mb-0 text-muted">يتم الآن جلب بيانات الجدول وتحضير أدوات الإدارة.</p>
                </div>
            </div>
        `;
    },

    renderErrorState: function(message) {
        return `
            <div class="card border-0 shadow-sm rounded-4">
                <div class="card-body text-center py-5">
                    <i class="bi bi-exclamation-octagon fs-1 text-danger mb-3"></i>
                    <h4 class="fw-bold text-dark">تعذر إكمال العملية</h4>
                    <p class="text-muted mb-3">${this.escapeHtml(message)}</p>
                    <button class="btn btn-primary rounded-pill px-4" onclick="Admin.viewDashboard()">العودة للرئيسية</button>
                </div>
            </div>
        `;
    },

    formatCurrency: function(value) {
        const amount = Number(value || 0);
        return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(amount);
    },

    escapeHtml: function(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },
};

Admin.init();
