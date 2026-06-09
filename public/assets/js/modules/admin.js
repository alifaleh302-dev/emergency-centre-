/**
 * admin_module.js — لوحة إدارة مركز الطوارئ
 * ====================================================================
 * يتضمن:
 *  - Dashboard مع KPIs + Chart.js (إيرادات 30 يوم، حالات، خدمات، أطباء)
 *  - CRUD ديناميكي لكل جداول DB مع FK resolution
 *  - بحث عام + فلاتر متقدمة (نصي/رقمي/تاريخ/boolean/dropdown)
 *  - شاشات عمليات متخصصة (زيارات/فواتير/طلبات) مع إلغاء + تغيير حالة
 *  - Audit Log viewer
 *  - Reports (إيرادات حسب الخدمة، أداء الأطباء)
 *  - Broadcast Notification
 *  - Export CSV للبيانات المفلترة
 *  - إجراءات مستخدمين (تفعيل/تعطيل، تغيير كلمة سر)
 * ====================================================================
 */

const AdminData = {
    currentUser: {},
    schema: [],
    schemaMap: {},
    dashboard: null,
    charts: null,
    currentTable: null,
    currentRows: [],
    currentMeta: null,
    filters: {},
    search: '',
    sortBy: null,
    sortDir: 'DESC',
    page: 1,
    perPage: 15,
    chartInstances: {}, // لمنع تراكم Chart.js
    settingsCatalog: null,
    settingsDraft: {},
    settingsDirty: false,
    settingsActiveGroup: 'shifts',
    shiftEditor: {
        selectedDate: '',
        loading: false,
        saving: false,
        error: '',
        defaults: null,
        currentConfig: null,
        rows: [],
    },
    currentView: 'dashboard', // dashboard | table | audit | reports | broadcast | settings
};

const ADMIN_ENUM_LABELS = {
    'shifts.status': { open: 'مفتوحة', closed: 'مغلقة' },
    'shifts.shift_type': { morning: 'صباحية', evening: 'مسائية' },
    'shifts.day_mode': {
        both: 'صباحي + مسائي',
        morning_only: 'اليوم كله صباحي',
        evening_only: 'اليوم كله مسائي',
    },
    'shifts_closures.status': { open: 'مفتوحة', locked: 'مقفلة' },
    'audit_logs.action': {
        CREATE: 'إنشاء',
        UPDATE: 'تحديث',
        DELETE: 'حذف',
        LOGIN: 'دخول',
        LOGOUT: 'خروج',
        CANCEL: 'إلغاء',
        EXPORT: 'تصدير',
        IMPORT: 'استيراد',
        VIEW: 'عرض',
        REOPEN: 'إعادة فتح',
        AUTO_CLOSE: 'إقفال تلقائي',
        OTHER: 'أخرى',
    },
};

const Admin = {
    // =================================================================
    //   Init
    // =================================================================
    init: async function() {
        try {
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
            AdminData.schemaMap = Object.fromEntries(AdminData.schema.map(t => [t.table, t]));

            // تحميل Chart.js
            await Core.loadExternalScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js', 'chartjs');

            this.renderSidebar();
            if (typeof Core.initRealtime === 'function') {
                await Core.initRealtime(AdminData.currentUser);
            }
            await this.viewDashboard();
        } catch (err) {
            console.error('Admin.init error:', err);
            Core.showAlert('حدث خطأ أثناء تهيئة لوحة التحكم.', 'error');
        }
    },

    // =================================================================
    //   🏦 Finance Hub (M6 integration)
    // =================================================================
    openFinanceHub: async function() {
        try {
            AdminData.currentView = 'finance_hub';
            AdminData.currentTable = null;
            this.renderSidebar();
            this.destroyCharts();

            // تحميل موديول Finance Hub ديناميكياً (أول مرة فقط)
            if (typeof window.Finance === 'undefined' || typeof Finance.viewHub !== 'function') {
                await Core.loadExternalScript('assets/js/modules/finance.js', 'finance-hub-module');
            }
            if (typeof window.Finance === 'undefined' || typeof Finance.viewHub !== 'function') {
                Core.showAlert('تعذر تحميل وحدة المركز المالي.', 'error');
                return;
            }
            Finance.viewHub();
        } catch (err) {
            console.error('openFinanceHub error:', err);
            Core.showAlert('حدث خطأ أثناء فتح المركز المالي.', 'error');
        }
    },

    // =================================================================
    //   Sidebar
    // =================================================================
    renderSidebar: function() {
        const sectionBreak = (title) => ({ _section: true, title });

        const tableLinks = AdminData.schema.map(table => ({
            title: table.label,
            icon: this.getTableIcon(table.table),
            url: 'javascript:void(0)',
            action: `Admin.openTable('${table.table}')`,
            active: AdminData.currentView === 'table' && AdminData.currentTable === table.table,
        }));

        const links = [
            { title: 'الرئيسية التحليلية', icon: 'bi-speedometer2', url: 'javascript:void(0)',
              action: 'Admin.viewDashboard()', active: AdminData.currentView === 'dashboard' },
            // قسم: العمليات
            { title: 'الزيارات والطلبات', icon: 'bi-clipboard2-pulse', url: 'javascript:void(0)',
              action: `Admin.openTable('visits')`, active: AdminData.currentView === 'table' && AdminData.currentTable === 'visits' },
            { title: 'الفواتير ومتابعتها', icon: 'bi-receipt', url: 'javascript:void(0)',
              action: `Admin.openTable('invoices')`, active: AdminData.currentView === 'table' && AdminData.currentTable === 'invoices' },
            // قسم: البيانات الرئيسية
            { title: 'المستخدمون', icon: 'bi-people', url: 'javascript:void(0)',
              action: `Admin.openTable('users')`, active: AdminData.currentView === 'table' && AdminData.currentTable === 'users' },
            { title: 'المرضى', icon: 'bi-person-vcard', url: 'javascript:void(0)',
              action: `Admin.openTable('patients')`, active: AdminData.currentView === 'table' && AdminData.currentTable === 'patients' },
            { title: 'الخدمات', icon: 'bi-bandaid', url: 'javascript:void(0)',
              action: `Admin.openTable('services_master')`, active: AdminData.currentView === 'table' && AdminData.currentTable === 'services_master' },
            // قسم: أدوات الإدارة
            { title: 'المركز المالي والسندي', icon: 'bi-bank2', url: 'javascript:void(0)',
              action: 'Admin.openFinanceHub()', active: AdminData.currentView === 'finance_hub' },
            { title: 'إعدادات النظام', icon: 'bi-sliders2-vertical', url: 'javascript:void(0)',
              action: 'Admin.viewSettings()', active: AdminData.currentView === 'settings' },
            { title: 'التقارير المتقدمة', icon: 'bi-graph-up-arrow', url: 'javascript:void(0)',
              action: 'Admin.viewReports()', active: AdminData.currentView === 'reports' },
            { title: 'بث إشعار', icon: 'bi-megaphone', url: 'javascript:void(0)',
              action: 'Admin.viewBroadcast()', active: AdminData.currentView === 'broadcast' },
            { title: 'سجل التدقيق', icon: 'bi-shield-check', url: 'javascript:void(0)',
              action: 'Admin.viewAuditLog()', active: AdminData.currentView === 'audit' },
            // قسم: كل الجداول (ديناميكي)
            { title: 'إدارة كل الجداول', icon: 'bi-database', url: 'javascript:void(0)',
              action: 'Admin.viewAllTables()', active: AdminData.currentView === 'tables_list' },
        ];
        Core.renderSidebar(links);
    },

    getTableIcon: function(tableName) {
        const map = {
            users: 'bi-people', roles: 'bi-shield-lock',
            patients: 'bi-person-vcard', visits: 'bi-clipboard2-pulse',
            invoices: 'bi-receipt', invoice_details: 'bi-list-check',
            document_types: 'bi-file-earmark-text', services_master: 'bi-bandaid',
            service_categories: 'bi-diagram-3', departments: 'bi-building', emergency_case_types: 'bi-heart-pulse',
            medical_results: 'bi-clipboard2-data', notifications: 'bi-bell',
            examination_tickets: 'bi-ticket-perforated', audit_logs: 'bi-shield-check', system_settings: 'bi-sliders2-vertical',
        };
        return map[tableName] || 'bi-table';
    },

    // =================================================================
    //   ⚙️ System Settings
    // =================================================================
    viewSettings: async function(activeGroup = null) {
        AdminData.currentView = 'settings';
        AdminData.currentTable = null;
        this.renderSidebar();
        this.destroyCharts();

        Core.navigateTo('Admin.viewSettings', async () => {
            document.getElementById('mainContent').innerHTML = this.renderLoadingState('إعدادات النظام');
            const response = await Core.apiCall('admin/settings', 'GET');
            if (!response?.success) {
                document.getElementById('mainContent').innerHTML = this.renderErrorState(response?.message || 'تعذر تحميل إعدادات النظام.');
                return;
            }

            AdminData.settingsCatalog = response.data || { groups: [], settings: [], stats: {} };
            AdminData.settingsDraft = Object.fromEntries((AdminData.settingsCatalog.settings || []).map(setting => [
                setting.key,
                setting.raw_value ?? setting.value ?? ''
            ]));
            AdminData.settingsDirty = false;

            const groupsWithItems = (AdminData.settingsCatalog.groups || []).filter(group => Number(group.count || 0) > 0);
            AdminData.settingsActiveGroup = activeGroup || groupsWithItems[0]?.key || 'general';
            AdminData.shiftEditor.selectedDate = AdminData.shiftEditor.selectedDate || this.getTodayDate();
            this.renderSettingsScreen(AdminData.settingsCatalog);
            if (groupsWithItems.some(group => group.key === 'shifts')) {
                await this.loadShiftBoundaryEditor(AdminData.shiftEditor.selectedDate, false);
            }
        });
    },

    renderSettingsScreen: function(catalog) {
        const groups = (catalog.groups || []).filter(group => Number(group.count || 0) > 0);
        const settings = catalog.settings || [];
        const stats = catalog.stats || {};
        const groupedSettings = groups.map(group => ({
            ...group,
            items: settings.filter(setting => setting.group === group.key),
        }));

        const statusTone = AdminData.settingsDirty ? 'warning' : 'success';
        const statusIcon = AdminData.settingsDirty ? 'bi-exclamation-circle' : 'bi-check-circle';
        const statusText = AdminData.settingsDirty ? 'هناك تعديلات غير محفوظة.' : 'جميع التغييرات محفوظة ومزامنة.';

        const quickCards = [
            { label: 'إجمالي الإعدادات', value: stats.total_settings || settings.length || 0, icon: 'bi-sliders2', tone: 'primary' },
            { label: 'التصنيفات النشطة', value: stats.groups_count || groups.length || 0, icon: 'bi-collection', tone: 'success' },
            { label: 'آخر تحديث', value: stats.last_updated_at ? this.formatDateTime(stats.last_updated_at) : '—', icon: 'bi-clock-history', tone: 'warning' },
        ];

        const quickCardsHtml = quickCards.map(card => `
            <div class="col-12 col-md-4">
                <div class="card border-0 shadow-sm rounded-4 h-100">
                    <div class="card-body p-4 d-flex align-items-center gap-3">
                        <div class="rounded-circle d-flex align-items-center justify-content-center bg-${card.tone}-subtle text-${card.tone}" style="width:56px;height:56px;font-size:1.3rem;">
                            <i class="bi ${card.icon}"></i>
                        </div>
                        <div>
                            <div class="text-muted small mb-1">${card.label}</div>
                            <div class="fw-bold fs-5 text-dark">${this.escapeHtml(String(card.value))}</div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

        const navigationHtml = groups.map(group => {
            const active = AdminData.settingsActiveGroup === group.key;
            return `
                <button class="btn ${active ? 'btn-primary' : 'btn-outline-secondary'} rounded-pill px-3 py-2" onclick="Admin.jumpToSettingsGroup('${group.key}')">
                    <i class="bi ${group.icon} ms-1"></i>${this.escapeHtml(group.label)}
                    <span class="badge bg-light text-dark ms-2">${group.count}</span>
                </button>
            `;
        }).join('');

        const sectionsHtml = groupedSettings.map(group => this.renderSettingsGroupSection(group)).join('');

        document.getElementById('mainContent').innerHTML = `
            ${Core.renderHeaderWithTools('إعدادات النظام', 'لوحة حديثة لإدارة الفترات، التذاكر، المالية، والترويسة.', [
                { label: 'تحديث البيانات', icon: 'bi-arrow-clockwise', action: 'Admin.viewSettings(AdminData.settingsActiveGroup)' },
                { label: 'إعادة تحميل بدون حفظ', icon: 'bi-bootstrap-reboot', action: 'Admin.resetSystemSettingsDraft()' },
            ])}

            <div class="card border-0 shadow-sm rounded-4 overflow-hidden mb-4" style="background:linear-gradient(135deg,#0d6efd 0%,#6f42c1 100%);">
                <div class="card-body p-4 p-lg-5 text-white">
                    <div class="row g-4 align-items-center">
                        <div class="col-lg-8">
                            <div class="d-inline-flex align-items-center gap-2 px-3 py-2 rounded-pill bg-white bg-opacity-10 mb-3 small fw-semibold">
                                <i class="bi bi-stars"></i>
                                تجربة إعدادات حديثة وسريعة
                            </div>
                            <h2 class="fw-bold mb-2">تحكم مركزي في إعدادات النظام</h2>
                            <p class="mb-0 text-white text-opacity-75">يمكنك تعديل القيم الأساسية من مكان واحد مع تصنيف واضح، وصف لكل إعداد، وحفظ فوري مع سجل تدقيق.</p>
                        </div>
                        <div class="col-lg-4">
                            <div class="card border-0 rounded-4 bg-white bg-opacity-10 text-white">
                                <div class="card-body p-4">
                                    <div class="d-flex align-items-center gap-2 mb-2 fw-bold"><i class="bi ${statusIcon}"></i> حالة النموذج</div>
                                    <div id="settings-save-indicator" class="badge rounded-pill bg-${statusTone}-subtle text-${statusTone} border border-${statusTone}-subtle mb-3">${statusText}</div>
                                    <div class="small text-white text-opacity-75">الحفظ يتم لكل الإعدادات المعدلة فقط، ويتم تسجيل العملية في سجل التدقيق.</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row g-3 mb-4">${quickCardsHtml}</div>

            <div class="card border-0 shadow-sm rounded-4 mb-4">
                <div class="card-body p-3 p-lg-4 d-flex flex-wrap gap-2 align-items-center justify-content-between">
                    <div>
                        <div class="fw-bold text-dark mb-1">تنقل سريع بين التصنيفات</div>
                        <div class="text-muted small">اختر القسم المطلوب للوصول السريع، ثم احفظ التعديلات مرة واحدة.</div>
                    </div>
                    <div class="d-flex flex-wrap gap-2">${navigationHtml}</div>
                </div>
            </div>

            <div class="d-flex flex-column gap-4">${sectionsHtml}</div>

            <div class="card border-0 shadow-sm rounded-4 mt-4 position-sticky" style="bottom:16px; z-index:20;">
                <div class="card-body p-3 p-lg-4 d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
                    <div>
                        <div class="fw-bold text-dark">جاهز للحفظ</div>
                        <div class="text-muted small">بعد الحفظ ستُحدَّث القيم مباشرة في قاعدة البيانات مع توثيق العملية.</div>
                    </div>
                    <div class="d-flex gap-2 w-100 w-lg-auto">
                        <button class="btn btn-outline-secondary rounded-pill px-4 flex-fill flex-lg-grow-0" onclick="Admin.resetSystemSettingsDraft()">
                            <i class="bi bi-arrow-counterclockwise ms-1"></i>تراجع عن التغييرات
                        </button>
                        <button id="settings-save-button" class="btn btn-primary rounded-pill px-4 flex-fill flex-lg-grow-0" onclick="return Admin.saveSystemSettings(event)">
                            <i class="bi bi-floppy ms-1"></i>حفظ الإعدادات
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.refreshSettingsSaveState();
    },

    renderSettingsGroupSection: function(group) {
        const settingsHtml = (group.items || []).map(setting => this.renderSystemSettingField(setting)).join('');
        const extraTopContent = group.key === 'shifts' ? this.renderShiftBoundaryPlannerShell() : '';
        return `
            <section id="settings-group-${group.key}" class="card border-0 shadow-sm rounded-4 overflow-hidden">
                <div class="card-header border-0 bg-${group.accent}-subtle p-4">
                    <div class="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
                        <div>
                            <div class="d-inline-flex align-items-center gap-2 rounded-pill px-3 py-2 bg-white shadow-sm small fw-semibold text-${group.accent}">
                                <i class="bi ${group.icon}"></i>
                                ${this.escapeHtml(group.label)}
                            </div>
                            <h4 class="fw-bold text-dark mt-3 mb-2">${this.escapeHtml(group.label)}</h4>
                            <p class="text-muted mb-0">${this.escapeHtml(group.description || '')}</p>
                        </div>
                        <div class="text-start text-lg-end">
                            <div class="badge rounded-pill bg-white text-dark border px-3 py-2">${group.count} إعداد</div>
                        </div>
                    </div>
                </div>
                <div class="card-body p-4">
                    ${extraTopContent}
                    <div class="row g-3">${settingsHtml}</div>
                </div>
            </section>
        `;
    },

    renderShiftBoundaryPlannerShell: function() {
        return `<div id="shift-boundary-editor-root" class="mb-4">${this.renderShiftBoundaryPlannerCard()}</div>`;
    },

    refreshShiftBoundaryPlanner: function() {
        const root = document.getElementById('shift-boundary-editor-root');
        if (!root) return;
        root.innerHTML = this.renderShiftBoundaryPlannerCard();
        this.bindShiftDial();
    },

    getTodayDate: function() {
        const now = new Date();
        const pad = value => String(value).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    },

    loadShiftBoundaryEditor: async function(date, showLoading = true) {
        const targetDate = date || AdminData.shiftEditor.selectedDate || this.getTodayDate();
        AdminData.shiftEditor.selectedDate = targetDate;
        if (showLoading) {
            AdminData.shiftEditor.loading = true;
            AdminData.shiftEditor.error = '';
            this.refreshShiftBoundaryPlanner();
        }

        const response = await Core.apiCall(`admin/shifts/day?date=${encodeURIComponent(targetDate)}`, 'GET');
        AdminData.shiftEditor.loading = false;
        if (!response?.success) {
            AdminData.shiftEditor.error = response?.message || 'تعذر تحميل حدود الفترات لليوم المحدد.';
            this.refreshShiftBoundaryPlanner();
            return;
        }

        const payload = response.data || {};
        AdminData.shiftEditor.defaults = payload.defaults || null;
        AdminData.shiftEditor.rows = payload.rows || [];
        AdminData.shiftEditor.currentConfig = {
            shift_date: payload.config?.shift_date || targetDate,
            split_time: payload.config?.split_time || payload.defaults?.split_time || '12:00',
            day_mode: payload.config?.day_mode || payload.defaults?.day_mode || 'both',
            status: payload.config?.status || (payload.has_closed_shift ? 'closed' : 'open'),
        };
        AdminData.shiftEditor.error = '';
        this.refreshShiftBoundaryPlanner();
    },

    getShiftEditorConfig: function() {
        const config = AdminData.shiftEditor.currentConfig || {};
        const defaults = AdminData.shiftEditor.defaults || {};
        return {
            shift_date: config.shift_date || AdminData.shiftEditor.selectedDate || this.getTodayDate(),
            split_time: this.normalizeShiftTimeValue(config.split_time || defaults.split_time || '12:00'),
            day_mode: config.day_mode || defaults.day_mode || 'both',
            status: config.status || 'open',
        };
    },

    normalizeShiftTimeValue: function(value) {
        const raw = String(value || '').trim();
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(raw)) return '12:00';
        const [hours, minutes] = raw.split(':');
        return `${String(hours).padStart(2, '0')}:${minutes}`;
    },

    setShiftDayMode: function(dayMode) {
        if (!['both', 'morning_only', 'evening_only'].includes(dayMode)) return;
        const config = this.getShiftEditorConfig();
        AdminData.shiftEditor.currentConfig = { ...config, day_mode: dayMode };
        this.refreshShiftBoundaryPlanner();
    },

    handleShiftDateChange: async function(date) {
        await this.loadShiftBoundaryEditor(date || this.getTodayDate());
    },

    onShiftSplitInput: function(value) {
        const normalized = this.normalizeShiftTimeValue(value);
        const config = this.getShiftEditorConfig();
        AdminData.shiftEditor.currentConfig = { ...config, split_time: normalized, day_mode: config.day_mode || 'both' };
        this.refreshShiftBoundaryPlanner();
    },

    saveShiftBoundaries: async function() {
        const config = this.getShiftEditorConfig();
        if (config.status === 'closed') {
            Core.showAlert('لا يمكن تعديل حدود يوم تحوي فيه فترة مغلقة.', 'warning');
            return;
        }

        AdminData.shiftEditor.saving = true;
        this.refreshShiftBoundaryPlanner();
        const response = await Core.apiCall('admin/shifts/save_boundaries', 'POST', {
            shift_date: config.shift_date,
            split_time: config.split_time,
            day_mode: config.day_mode,
        });
        AdminData.shiftEditor.saving = false;

        if (!response?.success) {
            Core.showAlert(response?.message || 'تعذر حفظ حدود الفترات.', 'error');
            this.refreshShiftBoundaryPlanner();
            return;
        }

        Core.showAlert(response.message || 'تم حفظ حدود الفترات بنجاح.', 'success');
        await this.loadShiftBoundaryEditor(config.shift_date, false);
    },

    renderShiftBoundaryPlannerCard: function() {
        const editor = AdminData.shiftEditor || {};
        const config = this.getShiftEditorConfig();
        const isClosed = config.status === 'closed';
        const isBusy = !!editor.loading || !!editor.saving;
        const splitLabel = config.day_mode === 'both'
            ? `${config.split_time}`
            : (config.day_mode === 'morning_only' ? 'يوم كامل صباحي' : 'يوم كامل مسائي');
        const morningLabel = config.day_mode === 'evening_only' ? '—' : `00:00 → ${config.day_mode === 'both' ? config.split_time : '24:00'}`;
        const eveningLabel = config.day_mode === 'morning_only' ? '—' : `${config.day_mode === 'both' ? config.split_time : '00:00'} → 24:00`;
        const modeButtons = [
            { value: 'both', label: 'صباحي + مسائي', icon: 'bi-pie-chart' },
            { value: 'morning_only', label: 'اليوم كله صباحي', icon: 'bi-sunrise' },
            { value: 'evening_only', label: 'اليوم كله مسائي', icon: 'bi-moon-stars' },
        ].map(mode => `
            <button type="button" class="btn ${config.day_mode === mode.value ? 'btn-primary' : 'btn-outline-secondary'} rounded-pill" onclick="Admin.setShiftDayMode('${mode.value}')">
                <i class="bi ${mode.icon} ms-1"></i>${mode.label}
            </button>
        `).join('');

        const rowsSummary = (editor.rows || []).map(row => `
            <div class="d-flex justify-content-between align-items-center py-2 border-bottom small">
                <span class="fw-semibold">${this.getEnumDisplayLabel('shifts', 'shift_type', row.shift_type)}</span>
                <span>${String(row.start_time || '').slice(0, 5)} → ${String(row.end_time || '').slice(0, 5)}</span>
                <span class="badge ${this.getEnumBadgeClass('shifts', 'status', row.status)}">${this.getEnumDisplayLabel('shifts', 'status', row.status)}</span>
            </div>
        `).join('');

        if (editor.loading) {
            return `
                <div class="card border border-primary-subtle rounded-4 mb-4">
                    <div class="card-body p-4 text-center text-muted">
                        <div class="spinner-border text-primary mb-3" role="status"></div>
                        <div class="fw-semibold">جاري تحميل حدود الفترات لليوم المحدد...</div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="card border border-primary-subtle rounded-4 mb-4 overflow-hidden">
                <div class="card-header bg-primary-subtle border-0 p-4 d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
                    <div>
                        <div class="d-inline-flex align-items-center gap-2 rounded-pill px-3 py-2 bg-white shadow-sm small fw-semibold text-primary mb-2">
                            <i class="bi bi-clock-history"></i>
                            محرر حدود الفترات اليومية
                        </div>
                        <h5 class="fw-bold text-dark mb-1">تخصيص حدود يوم واحد وحفظها داخل جدول <code>shifts</code></h5>
                        <div class="text-muted small">يمكنك تعديل وقت التقسيم أو تحويل اليوم إلى صباحي كامل أو مسائي كامل. إذا كانت إحدى الفترات مغلقة فسيُمنع الحفظ.</div>
                    </div>
                    <div class="d-flex flex-column align-items-lg-end gap-2">
                        <label class="form-label fw-bold mb-0">التاريخ</label>
                        <input id="shift-editor-date" type="date" class="form-control rounded-3" value="${this.escapeHtml(config.shift_date)}" onchange="Admin.handleShiftDateChange(this.value)">
                    </div>
                </div>
                <div class="card-body p-4">
                    ${editor.error ? `<div class="alert alert-danger rounded-4 mb-4">${this.escapeHtml(editor.error)}</div>` : ''}
                    <div class="row g-4 align-items-stretch">
                        <div class="col-12 col-xl-7">
                            <div class="border rounded-4 p-4 h-100 bg-light-subtle">
                                <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
                                    <div>
                                        <div class="fw-bold text-dark">قرص 24 ساعة</div>
                                        <div class="text-muted small">أعلى القرص = 12:00، وكل ساعة = 15°. السحب يغيّر وقت التقسيم عندما يكون اليوم مقسماً لفترتين.</div>
                                    </div>
                                    <span class="badge ${this.shiftEditorModeBadge(config.day_mode)}">${this.getEnumDisplayLabel('shifts', 'day_mode', config.day_mode)}</span>
                                </div>
                                ${this.renderShiftDialSvg(config)}
                            </div>
                        </div>
                        <div class="col-12 col-xl-5">
                            <div class="d-flex flex-column gap-3 h-100">
                                <div class="card border-0 shadow-sm rounded-4">
                                    <div class="card-body p-3 p-lg-4">
                                        <label class="form-label fw-bold">وضع اليوم</label>
                                        <div class="d-flex flex-wrap gap-2 mb-3">${modeButtons}</div>
                                        <label class="form-label fw-bold">وقت التقسيم</label>
                                        <div class="input-group mb-2">
                                            <span class="input-group-text"><i class="bi bi-alarm"></i></span>
                                            <input id="shift-split-input" type="time" class="form-control" value="${this.escapeHtml(config.split_time)}" ${config.day_mode !== 'both' ? 'disabled' : ''} onchange="Admin.onShiftSplitInput(this.value)">
                                        </div>
                                        <div class="text-muted small">القيمة الحالية: <strong>${this.escapeHtml(splitLabel)}</strong></div>
                                    </div>
                                </div>

                                <div class="card border-0 shadow-sm rounded-4">
                                    <div class="card-body p-3 p-lg-4">
                                        <div class="d-flex justify-content-between align-items-center mb-3">
                                            <div class="fw-bold text-dark">ملخص الحدود</div>
                                            <span class="badge ${isClosed ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success'}">${isClosed ? 'يوجد إقفال' : 'قابل للتعديل'}</span>
                                        </div>
                                        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                                            <span class="fw-semibold">الصباحية</span>
                                            <span>${this.escapeHtml(morningLabel)}</span>
                                        </div>
                                        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                                            <span class="fw-semibold">المسائية</span>
                                            <span>${this.escapeHtml(eveningLabel)}</span>
                                        </div>
                                        <div class="pt-3 small text-muted">السجلات الحالية في قاعدة البيانات لهذا اليوم:</div>
                                        <div class="pt-2">${rowsSummary || '<div class="text-muted small">سيتم إنشاء السجلات تلقائياً عند أول حفظ أو تحميل لليوم.</div>'}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="mt-4 d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
                        <div class="small text-muted">
                            <i class="bi bi-info-circle ms-1"></i>
                            ${isClosed ? 'هذا اليوم يحتوي فترة مغلقة، لذلك تم تعطيل الحفظ وفق الخطة.' : 'الحفظ سيحدّث تعريف الفترات في جدول shifts، ويعيد ربط زيارات اليوم تلقائياً إذا لزم الأمر.'}
                        </div>
                        <div class="d-flex gap-2">
                            <button class="btn btn-outline-secondary rounded-pill px-4" onclick="Admin.loadShiftBoundaryEditor('${this.escapeHtml(config.shift_date)}')">
                                <i class="bi bi-arrow-clockwise ms-1"></i>تحديث
                            </button>
                            <button class="btn btn-primary rounded-pill px-4" ${isClosed || isBusy ? 'disabled' : ''} onclick="Admin.saveShiftBoundaries()">
                                <i class="bi ${editor.saving ? 'bi-hourglass-split' : 'bi-floppy'} ms-1"></i>${editor.saving ? 'جاري الحفظ...' : 'حفظ حدود اليوم'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    renderShiftDialSvg: function(config) {
        const splitMinutes = this.timeToMinutes(config.split_time);
        const angle = ((splitMinutes - 720 + 1440) % 1440) / 1440 * 360;
        const knobAngle = config.day_mode === 'morning_only' || config.day_mode === 'evening_only' ? 0 : angle;
        const knobPoint = this.polarToCartesian(66, 66, 48, knobAngle);
        const morningColor = '#0d6efd';
        const eveningColor = '#6f42c1';
        let arcs = '';

        if (config.day_mode === 'both') {
            const safeAngle = Math.max(2, Math.min(358, angle));
            arcs = `
                <path d="${this.describeArc(66, 66, 48, 0, safeAngle)}" fill="none" stroke="${morningColor}" stroke-width="12" stroke-linecap="round"></path>
                <path d="${this.describeArc(66, 66, 48, safeAngle, 359.99)}" fill="none" stroke="${eveningColor}" stroke-width="12" stroke-linecap="round"></path>
            `;
        } else {
            arcs = `<circle cx="66" cy="66" r="48" fill="none" stroke="${config.day_mode === 'morning_only' ? morningColor : eveningColor}" stroke-width="12"></circle>`;
        }

        const ticks = Array.from({ length: 24 }, (_, index) => {
            const outer = this.polarToCartesian(66, 66, 58, index * 15);
            const inner = this.polarToCartesian(66, 66, index % 6 === 0 ? 48 : 52, index * 15);
            return `<line x1="${outer.x.toFixed(2)}" y1="${outer.y.toFixed(2)}" x2="${inner.x.toFixed(2)}" y2="${inner.y.toFixed(2)}" stroke="#94a3b8" stroke-width="${index % 6 === 0 ? 2 : 1}" opacity="0.7"></line>`;
        }).join('');

        return `
            <div class="text-center">
                <svg id="admin-shift-dial-svg" viewBox="0 0 132 132" width="100%" style="max-width:340px;cursor:${config.day_mode === 'both' ? 'grab' : 'default'};touch-action:none;">
                    <circle cx="66" cy="66" r="56" fill="#fff" stroke="#e2e8f0" stroke-width="2"></circle>
                    ${ticks}
                    ${arcs}
                    <circle cx="66" cy="66" r="36" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"></circle>
                    ${config.day_mode === 'both' ? `<line x1="66" y1="66" x2="${knobPoint.x.toFixed(2)}" y2="${knobPoint.y.toFixed(2)}" stroke="#1f2937" stroke-width="2.5" opacity="0.7"></line>` : ''}
                    <circle id="admin-shift-dial-knob" cx="${knobPoint.x.toFixed(2)}" cy="${knobPoint.y.toFixed(2)}" r="5.5" fill="#1f2937"></circle>
                    <text x="66" y="62" text-anchor="middle" font-size="10" fill="#64748b">وقت التقسيم</text>
                    <text x="66" y="77" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">${this.escapeHtml(config.day_mode === 'both' ? config.split_time : (config.day_mode === 'morning_only' ? 'Morning' : 'Evening'))}</text>
                    <text x="66" y="12" text-anchor="middle" font-size="9" fill="#475569">12:00</text>
                    <text x="120" y="69" text-anchor="middle" font-size="9" fill="#475569">18:00</text>
                    <text x="66" y="126" text-anchor="middle" font-size="9" fill="#475569">00:00</text>
                    <text x="12" y="69" text-anchor="middle" font-size="9" fill="#475569">06:00</text>
                </svg>
            </div>
        `;
    },

    bindShiftDial: function() {
        const svg = document.getElementById('admin-shift-dial-svg');
        const config = this.getShiftEditorConfig();
        if (!svg || config.day_mode !== 'both') return;

        const updateFromPointer = (clientX, clientY) => {
            const rect = svg.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const angle = (Math.atan2(clientY - centerY, clientX - centerX) * 180 / Math.PI + 90 + 360) % 360;
            const minutes = (720 + Math.round((angle / 360) * 1440)) % 1440;
            const nextConfig = this.getShiftEditorConfig();
            AdminData.shiftEditor.currentConfig = { ...nextConfig, split_time: this.minutesToTime(minutes) };
            this.refreshShiftBoundaryPlanner();
        };

        const onPointerMove = event => updateFromPointer(event.clientX, event.clientY);
        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };

        svg.addEventListener('pointerdown', event => {
            event.preventDefault();
            updateFromPointer(event.clientX, event.clientY);
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        }, { once: true });
    },

    shiftEditorModeBadge: function(dayMode) {
        if (dayMode === 'morning_only') return 'bg-info-subtle text-info';
        if (dayMode === 'evening_only') return 'bg-dark-subtle text-dark';
        return 'bg-primary-subtle text-primary';
    },

    timeToMinutes: function(timeValue) {
        const [hours, minutes] = this.normalizeShiftTimeValue(timeValue).split(':').map(Number);
        return (hours * 60) + minutes;
    },

    minutesToTime: function(totalMinutes) {
        const normalized = ((Number(totalMinutes) % 1440) + 1440) % 1440;
        const hours = Math.floor(normalized / 60);
        const minutes = normalized % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    },

    polarToCartesian: function(cx, cy, radius, angleInDegrees) {
        const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
        return {
            x: cx + (radius * Math.cos(angleInRadians)),
            y: cy + (radius * Math.sin(angleInRadians)),
        };
    },

    describeArc: function(cx, cy, radius, startAngle, endAngle) {
        const start = this.polarToCartesian(cx, cy, radius, endAngle);
        const end = this.polarToCartesian(cx, cy, radius, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
        return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
    },

    renderSystemSettingField: function(setting) {
        const value = AdminData.settingsDraft?.[setting.key] ?? setting.value ?? '';
        const escapedLabel = this.escapeHtml(setting.label || setting.key);
        const escapedHint = this.escapeHtml(setting.description || setting.hint || '');
        const escapedPlaceholder = this.escapeHtml(setting.placeholder || '');
        const escapedUnit = this.escapeHtml(setting.unit || '');
        const control = setting.control || 'text';
        const inputId = `setting-${setting.key}`;
        let fieldHtml = '';

        if (control === 'toggle') {
            const checked = String(value).toLowerCase() === 'true' ? 'checked' : '';
            fieldHtml = `
                <div class="form-check form-switch d-flex align-items-center justify-content-between gap-3 px-1 py-2">
                    <div>
                        <div class="fw-semibold text-dark">${checked ? 'مفعّل' : 'متوقف'}</div>
                        <div class="text-muted small">يمكن تعديل الحالة من المفتاح الجانبي.</div>
                    </div>
                    <input id="${inputId}" class="form-check-input" style="width:3rem;height:1.6rem;" type="checkbox" ${checked} onchange="Admin.updateSystemSetting('${setting.key}', 'toggle', this)">
                </div>
            `;
        } else if (control === 'select') {
            const optionsHtml = (setting.options || []).map(option => `
                <option value="${this.escapeHtml(String(option.value))}" ${String(value) === String(option.value) ? 'selected' : ''}>${this.escapeHtml(option.label || option.value)}</option>
            `).join('');
            fieldHtml = `
                <select id="${inputId}" class="form-select rounded-3" onchange="Admin.updateSystemSetting('${setting.key}', 'select', this)">
                    ${optionsHtml}
                </select>
            `;
        } else if (control === 'textarea') {
            fieldHtml = `
                <textarea id="${inputId}" class="form-control rounded-3" rows="3" placeholder="${escapedPlaceholder}" oninput="Admin.updateSystemSetting('${setting.key}', 'textarea', this)">${this.escapeHtml(String(value))}</textarea>
            `;
        } else {
            const inputType = control === 'number' ? 'number' : (control === 'time' ? 'time' : (control === 'url' ? 'url' : 'text'));
            const minAttr = setting.min !== null && setting.min !== undefined ? `min="${setting.min}"` : '';
            const maxAttr = setting.max !== null && setting.max !== undefined ? `max="${setting.max}"` : '';
            const stepAttr = setting.step !== null && setting.step !== undefined ? `step="${setting.step}"` : '';
            const inputHtml = `
                <input id="${inputId}" type="${inputType}" class="form-control rounded-3" value="${this.escapeHtml(String(value))}" placeholder="${escapedPlaceholder}" ${minAttr} ${maxAttr} ${stepAttr} ${control === 'number' ? 'onchange' : 'oninput'}="Admin.updateSystemSetting('${setting.key}', '${control}', this)">
            `;
            fieldHtml = escapedUnit
                ? `<div class="input-group">${inputHtml}<span class="input-group-text rounded-start-3">${escapedUnit}</span></div>`
                : inputHtml;
        }

        return `
            <div class="col-12 col-xl-6">
                <div class="card border h-100 rounded-4 shadow-sm-hover" style="border-color:rgba(13,110,253,.08)!important;">
                    <div class="card-body p-4">
                        <div class="d-flex align-items-start justify-content-between gap-3 mb-3">
                            <div>
                                <h6 class="fw-bold text-dark mb-1">${escapedLabel}</h6>
                                <div class="text-muted small">${escapedHint || '—'}</div>
                            </div>
                            <span class="badge rounded-pill bg-light text-secondary border">${this.escapeHtml(setting.key)}</span>
                        </div>
                        ${fieldHtml}
                    </div>
                </div>
            </div>
        `;
    },

    updateSystemSetting: function(key, control, element) {
        if (!element) return;
        let value = '';
        if (control === 'toggle') {
            value = element.checked ? 'true' : 'false';
        } else {
            value = element.value;
        }
        AdminData.settingsDraft[key] = value;
        AdminData.settingsDirty = true;
        this.refreshSettingsSaveState();
    },

    refreshSettingsSaveState: function() {
        const indicator = document.getElementById('settings-save-indicator');
        const button = document.getElementById('settings-save-button');
        const dirty = !!AdminData.settingsDirty;

        if (indicator) {
            indicator.className = `badge rounded-pill ${dirty ? 'bg-warning-subtle text-warning border border-warning-subtle' : 'bg-success-subtle text-success border border-success-subtle'} mb-3`;
            indicator.innerHTML = dirty
                ? '<i class="bi bi-exclamation-circle ms-1"></i>هناك تعديلات غير محفوظة.'
                : '<i class="bi bi-check-circle ms-1"></i>جميع التغييرات محفوظة ومزامنة.';
        }

        if (button) {
            button.disabled = !dirty;
        }
    },

    saveSystemSettings: async function(buttonOrEvent = null) {
        const runner = async () => {
            if (!AdminData.settingsDirty) {
                Core.showAlert('لا توجد تعديلات جديدة لحفظها.', 'info');
                return false;
            }
            const response = await Core.apiCall('admin/settings/save', 'POST', {
                settings: AdminData.settingsDraft,
            });
            if (!response?.success) {
                Core.showAlert(response?.message || 'تعذر حفظ الإعدادات.', 'error');
                return false;
            }
            Core.showAlert(response.message || 'تم حفظ إعدادات النظام.', 'success');
            await this.viewSettings(AdminData.settingsActiveGroup);
            return true;
        };

        if (buttonOrEvent) {
            return Core.guard(buttonOrEvent, runner);
        }
        return runner();
    },

    resetSystemSettingsDraft: function() {
        if (!AdminData.settingsDirty) {
            Core.showAlert('لا توجد تعديلات لإلغائها.', 'info');
            return;
        }
        this.viewSettings(AdminData.settingsActiveGroup);
    },

    jumpToSettingsGroup: function(groupKey) {
        AdminData.settingsActiveGroup = groupKey;
        if (AdminData.settingsCatalog) {
            this.renderSettingsScreen(AdminData.settingsCatalog);
            setTimeout(() => {
                document.getElementById(`settings-group-${groupKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 60);
        }
    },

    // =================================================================
    //   📊 Dashboard
    // =================================================================
    viewDashboard: async function() {
        AdminData.currentView = 'dashboard';
        AdminData.currentTable = null;
        this.renderSidebar();
        this.destroyCharts();

        Core.navigateTo('Admin.viewDashboard', async () => {
            document.getElementById('mainContent').innerHTML = this.renderLoadingState('لوحة المؤشرات الرئيسية');
            const [dashRes, chartsRes] = await Promise.all([
                Core.apiCall('admin/dashboard', 'GET'),
                Core.apiCall('admin/dashboard_charts', 'GET'),
            ]);

            if (!dashRes?.success) {
                document.getElementById('mainContent').innerHTML = this.renderErrorState(dashRes?.message || 'تعذر تحميل لوحة التحليلات.');
                return;
            }
            AdminData.dashboard = dashRes.data;
            AdminData.charts = chartsRes?.success ? chartsRes.data : null;

            const stats = dashRes.data.stats || {};
            const tables = dashRes.data.tables || [];
            const charts = AdminData.charts || {};

            const kpis = [
                { label: 'المستخدمون الفعّالون', value: stats.active_users_count || 0, icon: 'bi-people-fill', color: 'icon-blue', trend: '+' + (stats.users_count || 0) + ' مستخدم بالمجموع' },
                { label: 'زيارات اليوم', value: stats.visits_today || 0, icon: 'bi-calendar-event-fill', color: 'icon-green', trend: (stats.active_visits_count || 0) + ' نشطة' },
                { label: 'إيراد اليوم', value: this.formatCurrency(stats.revenue_today || 0), icon: 'bi-cash-coin', color: 'icon-orange', trend: 'الشهر: ' + this.formatCurrency(stats.revenue_month || 0) },
                { label: 'فواتير معلقة', value: stats.pending_invoices_count || 0, icon: 'bi-hourglass-split', color: 'icon-blue', trend: (stats.paid_invoices_today || 0) + ' مدفوعة اليوم' },
                { label: 'مرضى اليوم', value: stats.patients_today || 0, icon: 'bi-person-plus-fill', color: 'icon-green', trend: 'إجمالي: ' + (stats.patients_count || 0) },
                { label: 'تذاكر المعاينة اليوم', value: stats.tickets_today || 0, icon: 'bi-ticket-perforated-fill', color: 'icon-orange', trend: 'إشعارات: ' + (stats.notifications_today || 0) },
            ];

            const kpiHtml = kpis.map(k => `
                <div class="col-6 col-lg-4 col-xxl-2">
                    <div class="stat-card p-3 h-100">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <div class="stat-icon ${k.color}" style="width:48px;height:48px;font-size:1.3rem;"><i class="bi ${k.icon}"></i></div>
                        </div>
                        <div class="text-muted small mb-1">${k.label}</div>
                        <div class="fw-bold fs-4 text-dark">${k.value}</div>
                        <div class="text-muted" style="font-size:0.75rem;">${k.trend}</div>
                    </div>
                </div>
            `).join('');

            const recentInvoicesHtml = (charts.recent_invoices || []).map(r => `
                <tr>
                    <td class="fw-bold">#${r.serial_number}</td>
                    <td>${this.escapeHtml(r.patient_name || '—')}</td>
                    <td>${this.formatCurrency(r.net_amount)}</td>
                    <td>${this.formatDateTime(r.ts)}</td>
                    <td><span class="badge ${this.statusBadge(r.status)}">${r.status}</span></td>
                </tr>
            `).join('') || `<tr><td colspan="5" class="text-center text-muted py-3">لا توجد بيانات</td></tr>`;

            const recentVisitsHtml = (charts.recent_visits || []).map(r => `
                <tr>
                    <td class="fw-bold">#${r.visit_id}</td>
                    <td>${this.escapeHtml(r.patient_name || '—')}</td>
                    <td>${this.escapeHtml(r.doctor_name || '—')}</td>
                    <td>${this.escapeHtml(r.case_name || '—')}</td>
                    <td>${this.formatDateTime(r.visit_date)}</td>
                    <td><span class="badge ${this.visitStatusBadge(r.status)}">${this.translateVisitStatus(r.status)}</span></td>
                </tr>
            `).join('') || `<tr><td colspan="6" class="text-center text-muted py-3">لا توجد بيانات</td></tr>`;

            document.getElementById('mainContent').innerHTML = `
                ${Core.renderHeaderWithTools('لوحة إدارة النظام', 'مؤشرات شاملة لأداء مركز الطوارئ', [
                    { label: 'تحديث البيانات', icon: 'bi-arrow-repeat', action: 'Admin.viewDashboard()' },
                    { label: 'التقارير المتقدمة', icon: 'bi-graph-up-arrow', action: 'Admin.viewReports()' },
                    { label: 'إدارة كل الجداول', icon: 'bi-database', action: 'Admin.viewAllTables()' },
                ])}

                <div class="row g-3 mb-4">${kpiHtml}</div>

                <div class="row g-4 mb-4">
                    <div class="col-12 col-xl-8">
                        <div class="card border-0 shadow-sm rounded-4 h-100">
                            <div class="card-body p-4">
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <div>
                                        <h5 class="fw-bold mb-1 text-dark">إيرادات آخر 30 يوم</h5>
                                        <p class="text-muted small mb-0">المبالغ اليومية المحصّلة فعلياً (الفواتير المدفوعة غير الملغاة).</p>
                                    </div>
                                    <span class="badge bg-primary-subtle text-primary fs-6">إجمالي ٣٠ يوماً</span>
                                </div>
                                <div style="position:relative;height:280px;"><canvas id="chart-revenue"></canvas></div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12 col-xl-4">
                        <div class="card border-0 shadow-sm rounded-4 h-100">
                            <div class="card-body p-4">
                                <h5 class="fw-bold mb-1 text-dark">توزيع أنواع الحالات</h5>
                                <p class="text-muted small mb-3">تقسيم الزيارات حسب نوع الحالة الطارئة.</p>
                                <div style="position:relative;height:280px;"><canvas id="chart-cases"></canvas></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="row g-4 mb-4">
                    <div class="col-12 col-xl-6">
                        <div class="card border-0 shadow-sm rounded-4 h-100">
                            <div class="card-body p-4">
                                <h5 class="fw-bold mb-1 text-dark">أكثر الخدمات طلباً</h5>
                                <p class="text-muted small mb-3">الخدمات الأعلى تكراراً في الفواتير.</p>
                                <div style="position:relative;height:260px;"><canvas id="chart-services"></canvas></div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12 col-xl-6">
                        <div class="card border-0 shadow-sm rounded-4 h-100">
                            <div class="card-body p-4">
                                <h5 class="fw-bold mb-1 text-dark">نشاط الأطباء</h5>
                                <p class="text-muted small mb-3">عدد الزيارات لكل طبيب (إجمالي و مكتملة).</p>
                                <div style="position:relative;height:260px;"><canvas id="chart-doctors"></canvas></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="row g-4">
                    <div class="col-12 col-xl-7">
                        <div class="card border-0 shadow-sm rounded-4 h-100">
                            <div class="card-body p-4">
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <h5 class="fw-bold mb-0 text-dark">أحدث الزيارات</h5>
                                    <button class="btn btn-sm btn-outline-primary rounded-pill" onclick="Admin.openTable('visits')">عرض الكل <i class="bi bi-arrow-left"></i></button>
                                </div>
                                <div class="table-responsive">
                                    <table class="custom-table text-end mb-0">
                                        <thead><tr><th>#</th><th>المريض</th><th>الطبيب</th><th>الحالة</th><th>التاريخ</th><th>الحالة</th></tr></thead>
                                        <tbody>${recentVisitsHtml}</tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12 col-xl-5">
                        <div class="card border-0 shadow-sm rounded-4 h-100">
                            <div class="card-body p-4">
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <h5 class="fw-bold mb-0 text-dark">أحدث الفواتير</h5>
                                    <button class="btn btn-sm btn-outline-primary rounded-pill" onclick="Admin.openTable('invoices')">عرض الكل <i class="bi bi-arrow-left"></i></button>
                                </div>
                                <div class="table-responsive">
                                    <table class="custom-table text-end mb-0">
                                        <thead><tr><th>السند</th><th>المريض</th><th>المبلغ</th><th>التاريخ</th><th>الحالة</th></tr></thead>
                                        <tbody>${recentInvoicesHtml}</tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // رسم المخططات
            setTimeout(() => this.renderCharts(charts), 50);
        });
    },

    renderCharts: function(charts) {
        if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
        Chart.defaults.font.family = 'Cairo, sans-serif';

        // 1) Revenue line
        const rev = charts.revenue_daily || [];
        const revCanvas = document.getElementById('chart-revenue');
        if (revCanvas) {
            AdminData.chartInstances.revenue = new Chart(revCanvas, {
                type: 'line',
                data: {
                    labels: rev.map(r => r.day),
                    datasets: [{
                        label: 'الإيراد اليومي',
                        data: rev.map(r => Number(r.total) || 0),
                        fill: true,
                        borderColor: '#4160e0',
                        backgroundColor: 'rgba(65,96,224,0.15)',
                        tension: 0.35,
                        pointRadius: 3,
                        pointBackgroundColor: '#4160e0',
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true } }
                }
            });
        }

        // 2) Case types doughnut
        const cases = charts.case_types || [];
        const casesCanvas = document.getElementById('chart-cases');
        if (casesCanvas) {
            AdminData.chartInstances.cases = new Chart(casesCanvas, {
                type: 'doughnut',
                data: {
                    labels: cases.map(c => c.label),
                    datasets: [{
                        data: cases.map(c => Number(c.total) || 0),
                        backgroundColor: ['#4160e0','#2ecc71','#fd7e14','#e74c3c','#9b59b6','#1abc9c','#f39c12','#34495e'],
                        borderWidth: 0,
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
            });
        }

        // 3) Top services bar
        const svc = charts.top_services || [];
        const svcCanvas = document.getElementById('chart-services');
        if (svcCanvas) {
            AdminData.chartInstances.services = new Chart(svcCanvas, {
                type: 'bar',
                data: {
                    labels: svc.map(s => s.label),
                    datasets: [{
                        label: 'عدد الطلبات',
                        data: svc.map(s => Number(s.total) || 0),
                        backgroundColor: 'rgba(46,204,113,0.75)',
                        borderRadius: 8,
                    }]
                },
                options: {
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                }
            });
        }

        // 4) Doctors
        const docs = charts.doctors_activity || [];
        const docsCanvas = document.getElementById('chart-doctors');
        if (docsCanvas) {
            AdminData.chartInstances.doctors = new Chart(docsCanvas, {
                type: 'bar',
                data: {
                    labels: docs.map(d => d.label),
                    datasets: [
                        { label: 'إجمالي', data: docs.map(d => Number(d.total)||0), backgroundColor: 'rgba(65,96,224,0.7)', borderRadius: 8 },
                        { label: 'مكتملة', data: docs.map(d => Number(d.completed)||0), backgroundColor: 'rgba(46,204,113,0.7)', borderRadius: 8 },
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
            });
        }
    },

    destroyCharts: function() {
        Object.values(AdminData.chartInstances).forEach(ch => { try { ch.destroy(); } catch(e){} });
        AdminData.chartInstances = {};
    },

    // =================================================================
    //   📋 All Tables overview
    // =================================================================
    viewAllTables: function() {
        AdminData.currentView = 'tables_list';
        AdminData.currentTable = null;
        this.renderSidebar();
        this.destroyCharts();

        Core.navigateTo('Admin.viewAllTables', () => {
            const cards = AdminData.schema.map(table => `
                <div class="col-12 col-md-6 col-lg-4">
                    <div class="stat-card p-4 h-100" style="cursor:pointer;" onclick="Admin.openTable('${table.table}')">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <div class="stat-icon icon-blue"><i class="bi ${this.getTableIcon(table.table)}"></i></div>
                            <span class="badge bg-light text-dark">${table.table}</span>
                        </div>
                        <h5 class="fw-bold mb-1 text-dark">${table.label}</h5>
                        <p class="text-muted small mb-2">مفتاح: ${table.primary_key} — أعمدة: ${Object.keys(table.columns).length}</p>
                        <button class="btn btn-sm btn-primary rounded-pill px-3"><i class="bi bi-box-arrow-in-left ms-1"></i> فتح</button>
                    </div>
                </div>
            `).join('');

            document.getElementById('mainContent').innerHTML = `
                ${Core.renderHeaderWithTools('كل جداول قاعدة البيانات', 'إدارة كاملة وديناميكية لكل جدول')}
                <div class="row g-4">${cards}</div>
            `;
        });
    },

    // =================================================================
    //   🗃️ Dynamic Table CRUD
    // =================================================================
    openTable: async function(tableName) {
        AdminData.currentView = 'table';
        AdminData.currentTable = tableName;
        AdminData.page = 1;
        AdminData.search = '';
        AdminData.filters = {};
        AdminData.sortBy = null;
        AdminData.sortDir = 'DESC';
        this.renderSidebar();
        this.destroyCharts();
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

            if (!response?.success) {
                document.getElementById('mainContent').innerHTML = this.renderErrorState(response?.message || 'تعذر تحميل البيانات.');
                return;
            }

            AdminData.currentRows = response.data.rows || [];
            AdminData.currentMeta = response.data.meta || null;
            this.renderTableScreen(tableMeta, AdminData.currentRows, AdminData.currentMeta);
        });
    },

    renderTableScreen: function(tableMeta, rows, meta) {
        const visibleColumns = Object.values(tableMeta.columns).filter(c => c.visible_in_list !== false);
        const filterFields = Object.values(tableMeta.columns)
            .filter(c => c.name !== 'password_hash' && c.visible_in_list !== false)
            .map(c => this.renderFilterField(c)).join('');

        const rowsHtml = rows.length
            ? rows.map(row => this.renderRow(tableMeta, visibleColumns, row)).join('')
            : `<tr><td colspan="${visibleColumns.length + 1}" class="text-center text-muted py-5">لا توجد بيانات مطابقة.</td></tr>`;

        // إجراءات إضافية حسب الجدول
        const tools = [
            { label: 'إضافة سجل جديد', icon: 'bi-plus-circle', action: `Admin.openForm('${tableMeta.table}')` },
            { label: 'تصدير CSV', icon: 'bi-file-earmark-spreadsheet', action: `Admin.exportTable('${tableMeta.table}')` },
            { label: 'إعادة التحميل', icon: 'bi-arrow-repeat', action: 'Admin.loadTableData()' },
            { label: 'لوحة المؤشرات', icon: 'bi-speedometer2', action: 'Admin.viewDashboard()' },
        ];

        const summaryCards = `
            <div class="row g-3 mb-4">
                <div class="col-6 col-md-3"><div class="stat-card p-3"><div class="text-muted small">إجمالي السجلات</div><div class="fw-bold fs-3 text-dark">${meta.total}</div></div></div>
                <div class="col-6 col-md-3"><div class="stat-card p-3"><div class="text-muted small">الصفحة</div><div class="fw-bold fs-3 text-dark">${meta.page} / ${Math.max(meta.pages, 1)}</div></div></div>
                <div class="col-6 col-md-3"><div class="stat-card p-3"><div class="text-muted small">البحث</div><div class="fw-bold fs-5 text-dark">${AdminData.search ? 'مفعّل' : 'غير مفعّل'}</div></div></div>
                <div class="col-6 col-md-3"><div class="stat-card p-3"><div class="text-muted small">الفلاتر النشطة</div><div class="fw-bold fs-5 text-dark">${Object.keys(AdminData.filters).length}</div></div></div>
            </div>
        `;

        document.getElementById('mainContent').innerHTML = `
            ${Core.renderHeaderWithTools(tableMeta.label, `إدارة مباشرة لجدول ${tableMeta.table}`, tools)}
            ${summaryCards}

            <div class="card border-0 shadow-sm rounded-4 mb-4">
                <div class="card-body p-4">
                    <div class="row g-3 align-items-end mb-3">
                        <div class="col-12 col-lg-5">
                            <label class="form-label fw-bold">بحث عام</label>
                            <div class="input-group">
                                <span class="input-group-text"><i class="bi bi-search"></i></span>
                                <input id="admin-global-search" class="form-control" placeholder="ابحث في جميع الأعمدة..."
                                       value="${this.escapeHtml(AdminData.search)}"
                                       onkeydown="if(event.key==='Enter') Admin.applySearch()">
                            </div>
                        </div>
                        <div class="col-6 col-lg-3">
                            <label class="form-label fw-bold">سجلات / صفحة</label>
                            <select id="admin-per-page" class="form-select">
                                ${[10,15,25,50,100].map(n => `<option value="${n}" ${Number(AdminData.perPage)===n?'selected':''}>${n}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-6 col-lg-4 d-flex gap-2 flex-wrap">
                            <button class="btn btn-primary rounded-pill px-4" onclick="Admin.applySearch()"><i class="bi bi-funnel ms-1"></i> تطبيق</button>
                            <button class="btn btn-outline-secondary rounded-pill px-4" onclick="Admin.resetFilters()"><i class="bi bi-eraser ms-1"></i> مسح</button>
                            <button class="btn btn-success rounded-pill px-4" onclick="Admin.openForm('${tableMeta.table}')"><i class="bi bi-plus-circle ms-1"></i> إضافة</button>
                        </div>
                    </div>

                    <details class="border rounded-4 p-3 bg-light-subtle">
                        <summary class="fw-bold mb-0" style="cursor:pointer;"><i class="bi bi-sliders ms-1"></i> فلترة متقدمة حسب الأعمدة</summary>
                        <div class="row g-3 mt-2">${filterFields}</div>
                    </details>
                </div>
            </div>

            <div class="card border-0 shadow-sm rounded-4">
                <div class="card-body p-0">
                    <div class="table-responsive">
                        <table class="custom-table text-end mb-0">
                            <thead>
                                <tr>
                                    ${visibleColumns.map(c => this.renderSortableHeader(c)).join('')}
                                    <th style="width:160px">الإجراءات</th>
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
        const safeName = column.name.replace(/[^a-zA-Z0-9_]/g, '_');
        // Foreign key dropdown
        if (column.foreign && column.foreign_options?.length) {
            const current = AdminData.filters?.[column.name] || '';
            return `
                <div class="col-12 col-md-6 col-xl-3">
                    <label class="form-label small fw-bold">${column.label}</label>
                    <select id="filter-${safeName}" class="form-select form-select-sm">
                        <option value="">الكل</option>
                        ${column.foreign_options.map(o => `<option value="${o.value}" ${String(current)===String(o.value)?'selected':''}>${this.escapeHtml(String(o.label))}</option>`).join('')}
                    </select>
                </div>
            `;
        }
        if (column.enum_values?.length) {
            const current = AdminData.filters?.[column.name] || '';
            return `
                <div class="col-12 col-md-6 col-xl-3">
                    <label class="form-label small fw-bold">${column.label}</label>
                    <select id="filter-${safeName}" class="form-select form-select-sm">
                        <option value="">الكل</option>
                        ${column.enum_values.map(v => `<option value="${this.escapeHtml(String(v))}" ${current===v?'selected':''}>${this.escapeHtml(this.getEnumDisplayLabel(AdminData.currentTable, column.name, v))}</option>`).join('')}
                    </select>
                </div>
            `;
        }
        if (column.is_numeric || column.is_date_like) {
            const from = AdminData.filters?.[column.name]?.from || '';
            const to   = AdminData.filters?.[column.name]?.to   || '';
            return `
                <div class="col-12 col-md-6 col-xl-4">
                    <label class="form-label small fw-bold">${column.label}</label>
                    <div class="input-group input-group-sm mb-2">
                        <span class="input-group-text">من</span>
                        <input class="form-control" id="filter-${safeName}-from" value="${this.escapeHtml(from)}" ${column.is_date_like?'type="date"':'type="number" step="any"'}>
                    </div>
                    <div class="input-group input-group-sm">
                        <span class="input-group-text">إلى</span>
                        <input class="form-control" id="filter-${safeName}-to" value="${this.escapeHtml(to)}" ${column.is_date_like?'type="date"':'type="number" step="any"'}>
                    </div>
                </div>
            `;
        }
        if (column.is_boolean) {
            const current = AdminData.filters?.[column.name] || '';
            return `
                <div class="col-12 col-md-6 col-xl-3">
                    <label class="form-label small fw-bold">${column.label}</label>
                    <select id="filter-${safeName}" class="form-select form-select-sm">
                        <option value="">الكل</option>
                        <option value="true" ${current==='true'?'selected':''}>نعم</option>
                        <option value="false" ${current==='false'?'selected':''}>لا</option>
                    </select>
                </div>
            `;
        }
        return `
            <div class="col-12 col-md-6 col-xl-3">
                <label class="form-label small fw-bold">${column.label}</label>
                <input id="filter-${safeName}" class="form-control form-control-sm" value="${this.escapeHtml(AdminData.filters?.[column.name]||'')}" placeholder="قيمة فلترة">
            </div>
        `;
    },

    renderRow: function(tableMeta, columns, row) {
        const pk = tableMeta.primary_key;
        const cells = columns.map(col => `<td>${this.renderCellValue(tableMeta.table, col, row)}</td>`).join('');

        // أزرار إضافية حسب الجدول
        const extraActions = this.renderExtraActions(tableMeta.table, row);

        return `
            <tr>
                ${cells}
                <td>
                    <div class="d-flex gap-1 flex-wrap">
                        <button class="btn-action btn-view" title="تعديل" onclick="Admin.openForm('${tableMeta.table}', ${Number(row[pk])})"><i class="bi bi-pencil-square"></i></button>
                        <button class="btn-action btn-delete" title="حذف" onclick="Admin.deleteRecord('${tableMeta.table}', ${Number(row[pk])})"><i class="bi bi-trash"></i></button>
                        ${extraActions}
                    </div>
                </td>
            </tr>
        `;
    },

    renderExtraActions: function(tableName, row) {
        let html = '';
        if (tableName === 'users') {
            const isSelf = Number(row.user_id) === Number(AdminData.currentUser.id_user);
            html += `<button class="btn-action" style="background:#fef3c7;color:#b45309;" title="تغيير كلمة المرور" onclick="Admin.promptPasswordChange(${row.user_id})"><i class="bi bi-key"></i></button>`;
            if (!isSelf) {
                const isActive = row.is_active === true || row.is_active === 't' || row.is_active === 'true';
                html += `<button class="btn-action" style="background:${isActive?'#e0e7ff':'#d1fae5'};color:${isActive?'#3730a3':'#065f46'};" title="${isActive?'تعطيل':'تفعيل'}" onclick="Admin.toggleUser(${row.user_id}, ${!isActive})"><i class="bi ${isActive?'bi-toggle-on':'bi-toggle-off'}"></i></button>`;
            }
        }
        if (tableName === 'invoices') {
            const isCancelled = row.cancelled_at != null && row.cancelled_at !== '';
            if (!isCancelled) {
                html += `<button class="btn-action" style="background:#fee2e2;color:#991b1b;" title="إلغاء الفاتورة" onclick="Admin.promptCancelInvoice(${row.invoice_id})"><i class="bi bi-x-octagon"></i></button>`;
            }
        }
        if (tableName === 'visits') {
            const isCancelled = row.cancelled_at != null && row.cancelled_at !== '';
            if (!isCancelled) {
                html += `<button class="btn-action" style="background:#fee2e2;color:#991b1b;" title="إلغاء الزيارة" onclick="Admin.promptCancelVisit(${row.visit_id})"><i class="bi bi-x-octagon"></i></button>`;
            }
        }
        return html;
    },

    renderCellValue: function(tableName, column, row) {
        const value = row[column.name];
        // إذا كان FK ولدينا label من الـ enrichment
        if (column.is_foreign && row['_fk_' + column.name]) {
            return `<span class="badge bg-primary-subtle text-primary">${this.escapeHtml(row['_fk_' + column.name])}</span>
                    <small class="text-muted d-block">#${value}</small>`;
        }
        if (value === null || value === '' || value === undefined) {
            return '<span class="text-muted">—</span>';
        }
        if (column.name === 'password_hash') {
            return '<span class="badge bg-secondary">مخفي</span>';
        }
        if (column.is_boolean) {
            const truthy = value === true || value === 't' || value === 'true' || value === 1 || value === '1';
            return truthy
                ? '<span class="badge bg-success-subtle text-success">نعم</span>'
                : '<span class="badge bg-secondary-subtle text-secondary">لا</span>';
        }
        if (column.is_date_like) {
            return `<span>${this.formatDateTime(value)}</span>`;
        }
        if (column.is_numeric && (column.name.includes('amount') || column.name.includes('price') || column.name.includes('total') || column.name === 'net_amount' || column.name === 'exemption_value' || column.name === 'center_share' || column.name === 'ministry_share')) {
            return `<span class="fw-bold">${this.formatCurrency(value)}</span>`;
        }
        if (tableName === 'visits' && column.name === 'status') {
            return `<span class="badge ${this.visitStatusBadge(value)}">${this.translateVisitStatus(value)}</span>`;
        }
        if (column.enum_values?.length) {
            return `<span class="badge ${this.getEnumBadgeClass(tableName, column.name, value)}">${this.escapeHtml(this.getEnumDisplayLabel(tableName, column.name, value))}</span>`;
        }
        const text = String(value);
        return text.length > 80 ? `<span title="${this.escapeHtml(text)}">${this.escapeHtml(text.slice(0,80))}…</span>` : this.escapeHtml(text);
    },

    renderPagination: function(meta) {
        if (!meta || meta.pages <= 1) return '';
        const pages = [];
        const start = Math.max(1, meta.page - 2);
        const end = Math.min(meta.pages, meta.page + 2);
        for (let i = start; i <= end; i++) {
            pages.push(`<li class="page-item ${i===meta.page?'active':''}"><button class="page-link" onclick="Admin.goToPage(${i})">${i}</button></li>`);
        }
        return `
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-3 mt-4">
                <div class="text-muted small">إجمالي: ${meta.total} — الصفحة ${meta.page} من ${meta.pages}</div>
                <nav><ul class="pagination mb-0">
                    <li class="page-item ${meta.page<=1?'disabled':''}"><button class="page-link" onclick="Admin.goToPage(${meta.page-1})">السابق</button></li>
                    ${pages.join('')}
                    <li class="page-item ${meta.page>=meta.pages?'disabled':''}"><button class="page-link" onclick="Admin.goToPage(${meta.page+1})">التالي</button></li>
                </ul></nav>
            </div>
        `;
    },

    collectFilters: function() {
        const tableMeta = AdminData.schemaMap[AdminData.currentTable];
        const filters = {};
        Object.values(tableMeta.columns).forEach(col => {
            const safe = col.name.replace(/[^a-zA-Z0-9_]/g, '_');
            if (col.is_numeric || col.is_date_like) {
                const from = document.getElementById(`filter-${safe}-from`)?.value || '';
                const to = document.getElementById(`filter-${safe}-to`)?.value || '';
                if (from || to) filters[col.name] = { from, to };
                return;
            }
            const v = document.getElementById(`filter-${safe}`)?.value || '';
            if (v !== '') filters[col.name] = v;
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

    sortBy: async function(name) {
        if (AdminData.sortBy === name) {
            AdminData.sortDir = AdminData.sortDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            AdminData.sortBy = name; AdminData.sortDir = 'ASC';
        }
        await this.loadTableData();
    },

    goToPage: async function(p) {
        if (p < 1) return;
        AdminData.page = p;
        await this.loadTableData();
    },

    // =================================================================
    //   📝 Form (Modal) for Add/Edit
    // =================================================================
    openForm: async function(tableName, id = null) {
        const tableMeta = AdminData.schemaMap[tableName];
        if (!tableMeta) return;
        let record = {};
        if (id) {
            const r = await Core.apiCall('admin/record', 'POST', { table: tableName, id });
            if (!r?.success) { Core.showAlert(r?.message || 'تعذر جلب السجل.', 'error'); return; }
            record = r.data.record || {};
        }

        const fieldsHtml = Object.values(tableMeta.columns)
            .filter(c => !c.auto_increment && c.editable !== false)
            .map(c => this.renderFormField(tableMeta, c, record[c.name]))
            .join('');

        document.getElementById('adminCrudModal')?.remove();
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="adminCrudModal" tabindex="-1">
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
                            <button class="btn btn-primary rounded-pill px-4" onclick="Core.guard(this, () => Admin.saveRecord('${tableName}', ${id || 'null'}))">حفظ</button>
                        </div>
                    </div>
                </div>
            </div>
        `);
        const modalEl = document.getElementById('adminCrudModal');
        new bootstrap.Modal(modalEl).show();
        await this.refreshLiveForeignOptions(tableMeta, record);
    },

    renderFormField: function(tableMeta, column, value) {
        const id = `field-${column.name}`;
        const currentValue = value ?? '';
        const required = !column.nullable && !column.has_default && !column.auto_increment;
        const label = `${column.label}${required ? ' <span class="text-danger">*</span>' : ''}`;

        if (column.name === tableMeta.primary_key && column.auto_increment) return '';

        if (column.name === 'password_hash') {
            return `
                <div class="col-12 col-md-6">
                    <label class="form-label fw-bold">${label}</label>
                    <input id="${id}" type="password" class="form-control" placeholder="${value?'اتركه فارغاً للإبقاء':'أدخل كلمة المرور'}">
                </div>`;
        }

        if (column.foreign) {
            const initialOptions = column.foreign_options || [];
            return `
                <div class="col-12 col-md-6">
                    <label class="form-label fw-bold">${label}</label>
                    <select id="${id}" class="form-select" data-live-foreign="1" data-current-value="${this.escapeHtml(String(currentValue ?? ''))}" data-ref-table="${this.escapeHtml(String(column.foreign.table))}" data-ref-column="${this.escapeHtml(String(column.foreign.column))}">
                        <option value="">${column.nullable ? 'اختياري' : 'اختر قيمة'}</option>
                        ${initialOptions.map(o => `<option value="${o.value}" ${String(currentValue)===String(o.value)?'selected':''}>${this.escapeHtml(String(o.label))}</option>`).join('')}
                    </select>
                </div>`;
        }

        if (column.enum_values?.length) {
            return `
                <div class="col-12 col-md-6">
                    <label class="form-label fw-bold">${label}</label>
                    <select id="${id}" class="form-select">
                        <option value="">${column.nullable?'اختياري':'اختر قيمة'}</option>
                        ${column.enum_values.map(v => `<option value="${this.escapeHtml(String(v))}" ${String(currentValue)===String(v)?'selected':''}>${this.escapeHtml(this.getEnumDisplayLabel(tableMeta.table, column.name, v))}</option>`).join('')}
                    </select>
                </div>`;
        }

        if (column.is_boolean) {
            return `
                <div class="col-12 col-md-4">
                    <label class="form-label fw-bold">${label}</label>
                    <select id="${id}" class="form-select">
                        <option value="true" ${currentValue===true||currentValue==='true'||currentValue==='t'?'selected':''}>نعم</option>
                        <option value="false" ${currentValue===false||currentValue==='false'||currentValue==='f'?'selected':''}>لا</option>
                    </select>
                </div>`;
        }

        const inputType = column.is_numeric ? 'number' : (column.is_date_like ? (column.data_type.includes('timestamp')?'datetime-local':'date') : 'text');
        if (column.data_type === 'text' || ['notes','body','result_text','diagnosis','cancel_reason'].includes(column.name)) {
            return `
                <div class="col-12">
                    <label class="form-label fw-bold">${label}</label>
                    <textarea id="${id}" class="form-control" rows="3" placeholder="أدخل ${column.label}">${this.escapeHtml(String(currentValue||''))}</textarea>
                </div>`;
        }

        return `
            <div class="col-12 col-md-6">
                <label class="form-label fw-bold">${label}</label>
                <input id="${id}" type="${inputType}" ${column.is_numeric?'step="any"':''} class="form-control"
                       value="${this.escapeHtml(this.formatInputValue(currentValue, column))}"
                       placeholder="أدخل ${column.label}">
            </div>`;
    },

    formatInputValue: function(value, column) {
        if (value === null || value === undefined) return '';
        if (!column.is_date_like) return String(value);
        const raw = String(value);
        if (column.data_type.includes('timestamp')) return raw.replace(' ', 'T').slice(0,16);
        return raw.slice(0,10);
    },

    refreshLiveForeignOptions: async function(tableMeta, record = {}) {
        const foreignColumns = Object.values(tableMeta.columns).filter(c => c.foreign);
        if (!foreignColumns.length) return;

        await Promise.all(foreignColumns.map(async (column) => {
            const selectEl = document.getElementById(`field-${column.name}`);
            if (!selectEl) return;

            const response = await Core.apiCall('admin/reference_options', 'POST', {
                table: tableMeta.table,
                column: column.name,
            });

            if (!response?.success) return;
            const currentValue = record?.[column.name] ?? selectEl.dataset.currentValue ?? '';
            const placeholder = column.nullable ? 'اختياري' : 'اختر قيمة';
            const options = response.data?.options || [];
            selectEl.innerHTML = [`<option value="">${placeholder}</option>`]
                .concat(options.map(o => `<option value="${o.value}" ${String(currentValue)===String(o.value)?'selected':''}>${this.escapeHtml(String(o.label))}</option>`))
                .join('');
        }));
    },

    saveRecord: async function(tableName, id = null) {
        const tableMeta = AdminData.schemaMap[tableName];
        const record = {};
        Object.values(tableMeta.columns).forEach(col => {
            if (col.auto_increment) return;
            const el = document.getElementById(`field-${col.name}`);
            if (!el) return;
            record[col.name] = el.value;
        });

        const response = await Core.apiCall('admin/save', 'POST', { table: tableName, id, record });
        if (!response?.success) { Core.showAlert(response?.message || 'تعذر الحفظ.', 'error'); return; }
        Core.showAlert(response.message || 'تم الحفظ بنجاح.', 'success');
        bootstrap.Modal.getInstance(document.getElementById('adminCrudModal'))?.hide();
        if (AdminData.currentTable === tableName) await this.loadTableData();
    },

    deleteRecord: async function(tableName, id) {
        const tableLabels = {
            patients: 'المريض',
            visits: 'الزيارة',
            services_master: 'الخدمة',
            service_categories: 'التصنيف',
            departments: 'القسم',
            users: 'المستخدم',
            invoices: 'الفاتورة',
        };
        const softDeleteTables = ['patients', 'visits', 'services_master', 'service_categories', 'departments'];
        const isSoftDelete = softDeleteTables.includes(tableName);
        const label = tableLabels[tableName] || 'هذا السجل';
        const baseMsg = isSoftDelete
            ? `هل أنت متأكد من حذف ${label}؟

سيتم الحذف الذكي (Soft Delete) — سيبقى السجل في قاعدة البيانات للأغراض التاريخية لكنه لن يظهر في أي واجهة غير إدارية.`
            : `هل أنت متأكد من حذف ${label}؟`;
        if (!confirm(baseMsg)) return;

        let r = await Core.apiCall('admin/delete', 'POST', { table: tableName, id });
        if (!r?.success) { Core.showAlert(r?.message || 'تعذر الحذف.', 'error'); return; }

        if (r.data?.requires_confirmation) {
            const impactMsg = r.message || 'توجد بيانات مرتبطة، هل توافق على حذفها أيضاً؟';
            if (!confirm(`⚠️ ${impactMsg}\n\nسيتم استخدام الحذف الذكي لهذه العناصر أيضاً.`)) {
                Core.showAlert('تم إلغاء عملية الحذف.', 'info');
                return;
            }
            r = await Core.apiCall('admin/delete', 'POST', { table: tableName, id, confirm_cascade: true });
            if (!r?.success) { Core.showAlert(r?.message || 'تعذر الحذف.', 'error'); return; }
        }

        Core.showAlert(r.message || 'تم الحذف.', 'success');
        await this.loadTableData();
    },

    // =================================================================
    //   🔐 User-specific actions
    // =================================================================
    promptPasswordChange: function(userId) {
        const newPass = prompt('أدخل كلمة المرور الجديدة (٦ أحرف على الأقل):');
        if (!newPass) return;
        if (newPass.length < 6) { Core.showAlert('كلمة المرور قصيرة جداً.', 'warning'); return; }
        Core.apiCall('admin/change_password', 'POST', { user_id: userId, new_password: newPass })
            .then(r => {
                if (r?.success) Core.showAlert('تم تغيير كلمة المرور.', 'success');
                else Core.showAlert(r?.message || 'تعذر التغيير.', 'error');
            });
    },

    toggleUser: async function(userId, active) {
        const r = await Core.apiCall('admin/toggle_user', 'POST', { user_id: userId, active });
        if (r?.success) { Core.showAlert(r.message, 'success'); await this.loadTableData(); }
        else Core.showAlert(r?.message || 'تعذر التنفيذ.', 'error');
    },

    // =================================================================
    //   ❌ Cancel operations
    // =================================================================
    promptCancelInvoice: function(invoiceId) {
        const reason = prompt('سبب إلغاء الفاتورة:');
        if (reason === null) return;
        Core.apiCall('admin/cancel_invoice', 'POST', { invoice_id: invoiceId, reason: reason || 'بدون سبب محدد' })
            .then(r => {
                if (r?.success) { Core.showAlert(r.message, 'success'); this.loadTableData(); }
                else Core.showAlert(r?.message || 'تعذر الإلغاء.', 'error');
            });
    },

    promptCancelVisit: function(visitId) {
        const reason = prompt('سبب إلغاء الزيارة:');
        if (reason === null) return;
        Core.apiCall('admin/cancel_visit', 'POST', { visit_id: visitId, reason: reason || 'بدون سبب محدد' })
            .then(r => {
                if (r?.success) { Core.showAlert(r.message, 'success'); this.loadTableData(); }
                else Core.showAlert(r?.message || 'تعذر الإلغاء.', 'error');
            });
    },

    // =================================================================
    //   📤 Export CSV
    // =================================================================
    exportTable: async function(tableName) {
        Core.showAlert('جاري تجهيز ملف التصدير...', 'info');
        const r = await Core.apiCall('admin/export', 'POST', {
            table: tableName,
            search: AdminData.search,
            filters: AdminData.filters,
            format: 'csv',
        });
        if (!r?.success) { Core.showAlert(r?.message || 'تعذر التصدير.', 'error'); return; }
        const cols = (r.data.columns || []).filter(c => c.name !== 'password_hash');
        const header = cols.map(c => `"${c.label.replace(/"/g,'""')}"`).join(',');
        const csv = [header].concat((r.data.rows || []).map(row =>
            cols.map(c => {
                let v = row[c.name];
                if (c.is_foreign && row['_fk_' + c.name]) v = row['_fk_' + c.name];
                if (v === null || v === undefined) return '""';
                return `"${String(v).replace(/"/g,'""')}"`;
            }).join(',')
        )).join('\r\n');

        // UTF-8 BOM لفتح صحيح في Excel
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tableName}_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        Core.showAlert(`تم تصدير ${r.data.rows.length} سجل.`, 'success');
    },

    // =================================================================
    //   📣 Broadcast Notification
    // =================================================================
    viewBroadcast: function() {
        AdminData.currentView = 'broadcast';
        AdminData.currentTable = null;
        this.renderSidebar();
        this.destroyCharts();

        const roles = ['طبيب عام','أمين صندوق','استقبال','فني مختبر','مدير النظام'];

        Core.navigateTo('Admin.viewBroadcast', () => {
            document.getElementById('mainContent').innerHTML = `
                ${Core.renderHeaderWithTools('بث إشعار يدوي', 'أرسل إشعاراً مباشراً إلى جميع المستخدمين ضمن دور معيّن')}
                <div class="row g-4">
                    <div class="col-12 col-lg-8">
                        <div class="card border-0 shadow-sm rounded-4">
                            <div class="card-body p-4">
                                <div class="mb-3">
                                    <label class="form-label fw-bold">الدور المستهدف</label>
                                    <select id="bc-role" class="form-select">
                                        ${roles.map(r => `<option value="${r}">${r}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">عنوان الإشعار</label>
                                    <input id="bc-title" class="form-control" placeholder="مثلاً: اجتماع الساعة ١٠ صباحاً">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">المحتوى</label>
                                    <textarea id="bc-body" class="form-control" rows="4" placeholder="نص الإشعار..."></textarea>
                                </div>
                                <div class="d-flex gap-2">
                                    <button class="btn btn-primary rounded-pill px-4" onclick="Admin.sendBroadcast()"><i class="bi bi-megaphone ms-1"></i> بث الإشعار</button>
                                    <button class="btn btn-outline-secondary rounded-pill px-4" onclick="document.getElementById('bc-title').value=''; document.getElementById('bc-body').value='';">مسح</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12 col-lg-4">
                        <div class="card border-0 shadow-sm rounded-4 bg-light">
                            <div class="card-body p-4">
                                <h6 class="fw-bold mb-2"><i class="bi bi-info-circle text-primary ms-1"></i> ملاحظات</h6>
                                <ul class="text-muted small mb-0" style="padding-right:1.2rem;">
                                    <li>سيصل الإشعار لكل المستخدمين ضمن الدور المختار عند التحديث التالي.</li>
                                    <li>يُسجَّل الإشعار في جدول <code>notifications</code> وفي سجل التدقيق.</li>
                                    <li>نوع الحدث: <code>admin_broadcast</code>.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
    },

    sendBroadcast: async function() {
        const role = document.getElementById('bc-role').value;
        const title = document.getElementById('bc-title').value.trim();
        const body = document.getElementById('bc-body').value.trim();
        if (!title) { Core.showAlert('العنوان مطلوب.', 'warning'); return; }
        const r = await Core.apiCall('admin/broadcast', 'POST', { target_role: role, title, body });
        if (r?.success) {
            Core.showAlert(r.message, 'success');
            document.getElementById('bc-title').value = '';
            document.getElementById('bc-body').value = '';
        } else {
            Core.showAlert(r?.message || 'تعذر البث.', 'error');
        }
    },

    // =================================================================
    //   🔒 Audit Log viewer
    // =================================================================
    viewAuditLog: async function(page = 1) {
        AdminData.currentView = 'audit';
        AdminData.currentTable = null;
        this.renderSidebar();
        this.destroyCharts();

        Core.navigateTo('Admin.viewAuditLog', async () => {
            document.getElementById('mainContent').innerHTML = this.renderLoadingState('سجل التدقيق');
            const filters = AdminData._auditFilters || {};
            const r = await Core.apiCall('admin/audit_log', 'POST', { page, per_page: 25, ...filters });
            if (!r?.success) {
                document.getElementById('mainContent').innerHTML = this.renderErrorState(r?.message || 'تعذر تحميل السجل.');
                return;
            }
            const rows = r.data.rows || [];
            const meta = r.data.meta || { total: 0, pages: 1, page: 1 };

            const rowsHtml = rows.length ? rows.map(log => {
                // 🆕 المرحلة 7 (Audit Log): الـ badge يأخذ بعين الاعتبار كل الأفعال
                // المعتمدة في CHECK constraint بما فيها AUTO_CLOSE و REOPEN.
                const actionBadge = {
                    'CREATE'     : 'bg-success-subtle text-success',
                    'UPDATE'     : 'bg-primary-subtle text-primary',
                    'DELETE'     : 'bg-danger-subtle text-danger',
                    'CANCEL'     : 'bg-warning-subtle text-warning',
                    'LOGIN'      : 'bg-info-subtle text-info',
                    'LOGOUT'     : 'bg-info-subtle text-info',
                    'EXPORT'     : 'bg-secondary-subtle text-secondary',
                    'IMPORT'     : 'bg-secondary-subtle text-secondary',
                    'VIEW'       : 'bg-light text-dark',
                    'REOPEN'     : 'bg-warning-subtle text-warning',
                    'AUTO_CLOSE' : 'bg-warning-subtle text-warning',
                    'OTHER'      : 'bg-light text-dark',
                }[log.action] || 'bg-light text-dark';
                // الترجمة الموحَّدة من ADMIN_ENUM_LABELS لضمان عرض AUTO_CLOSE بشكل صحيح
                const actionLabel = (ADMIN_ENUM_LABELS['audit_logs.action'] || {})[log.action] || log.action;
                // علامة مميزة للإقفال التلقائي (System) لتمييزه بصرياً عن إقفال المستخدم.
                const isAutoClose = log.action === 'AUTO_CLOSE';
                return `
                    <tr>
                        <td class="fw-bold">#${log.log_id}</td>
                        <td><span class="badge ${actionBadge}">${isAutoClose ? '<i class="bi bi-robot ms-1"></i>' : ''}${actionLabel}</span></td>
                        <td>${this.escapeHtml(log.username || '—')}${isAutoClose ? ' <small class="badge bg-light text-muted border">نظام</small>' : ''}</td>
                        <td><code>${log.table_name || '—'}</code> ${log.record_id ? `<small class="text-muted">#${log.record_id}</small>` : ''}</td>
                        <td><code style="font-size:.75rem;">${log.ip_address || '—'}</code></td>
                        <td>${this.formatDateTime(log.created_at)}</td>
                        <td>
                            <button class="btn-action btn-view" title="تفاصيل" onclick='Admin.showAuditDetail(${JSON.stringify(JSON.stringify(log))})'><i class="bi bi-eye"></i></button>
                        </td>
                    </tr>`;
            }).join('') : `<tr><td colspan="7" class="text-center text-muted py-4">لا توجد سجلات.</td></tr>`;

            document.getElementById('mainContent').innerHTML = `
                ${Core.renderHeaderWithTools('سجل التدقيق (Audit Log)', 'تتبّع كامل لكل عمليات النظام الحساسة')}

                <div class="card border-0 shadow-sm rounded-4 mb-3">
                    <div class="card-body p-3">
                        <div class="row g-2 align-items-end">
                            <div class="col-md-3"><label class="form-label small fw-bold">نوع العملية</label>
                                <select id="audit-action" class="form-select form-select-sm">
                                    <option value="">الكل</option>
                                    ${Object.entries(ADMIN_ENUM_LABELS['audit_logs.action'] || {})
                                        .map(([val, lbl]) => `<option value="${val}" ${ (AdminData._auditFilters?.action===val)?'selected':'' }>${this.escapeHtml(lbl)}</option>`)
                                        .join('')}
                                </select>
                            </div>
                            <div class="col-md-3"><label class="form-label small fw-bold">الجدول</label>
                                <input id="audit-table" class="form-control form-control-sm" placeholder="اسم الجدول">
                            </div>
                            <div class="col-md-3"><label class="form-label small fw-bold">المستخدم</label>
                                <input id="audit-username" class="form-control form-control-sm" placeholder="اسم المستخدم">
                            </div>
                            <div class="col-md-3 d-flex gap-2">
                                <button class="btn btn-sm btn-primary rounded-pill flex-fill" onclick="Admin.applyAuditFilters()"><i class="bi bi-funnel ms-1"></i>تطبيق</button>
                                <button class="btn btn-sm btn-outline-secondary rounded-pill flex-fill" onclick="AdminData._auditFilters={}; Admin.viewAuditLog()">مسح</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card border-0 shadow-sm rounded-4">
                    <div class="card-body p-0">
                        <div class="table-responsive">
                            <table class="custom-table text-end mb-0">
                                <thead><tr><th>#</th><th>العملية</th><th>المستخدم</th><th>الجدول / السجل</th><th>IP</th><th>الوقت</th><th>تفاصيل</th></tr></thead>
                                <tbody>${rowsHtml}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
                ${this.renderPagination(meta).replace(/Admin\.goToPage/g, 'Admin.viewAuditLog')}
            `;
        });
    },

    applyAuditFilters: function() {
        AdminData._auditFilters = {
            action: document.getElementById('audit-action')?.value || '',
            table: document.getElementById('audit-table')?.value || '',
            username: document.getElementById('audit-username')?.value || '',
        };
        this.viewAuditLog(1);
    },

    showAuditDetail: function(logJson) {
        const log = JSON.parse(logJson);
        const pretty = (v) => {
            if (!v) return '<em class="text-muted">—</em>';
            try { return '<pre class="bg-light p-2 rounded small text-start" dir="ltr">' + this.escapeHtml(JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v, null, 2)) + '</pre>'; }
            catch(e) { return '<code>' + this.escapeHtml(String(v)) + '</code>'; }
        };
        document.getElementById('auditDetailModal')?.remove();
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="auditDetailModal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-scrollable">
                    <div class="modal-content rounded-4 border-0 shadow-lg">
                        <div class="modal-header bg-dark text-white">
                            <h5 class="modal-title fw-bold"><i class="bi bi-shield-check ms-2"></i>تفاصيل السجل #${log.log_id}</h5>
                            <button class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row g-2 mb-3">
                                <div class="col-6"><strong>العملية:</strong> ${log.action}</div>
                                <div class="col-6"><strong>المستخدم:</strong> ${this.escapeHtml(log.username||'')}</div>
                                <div class="col-6"><strong>الجدول:</strong> <code>${log.table_name||'—'}</code></div>
                                <div class="col-6"><strong>السجل:</strong> #${log.record_id||'—'}</div>
                                <div class="col-6"><strong>IP:</strong> <code>${log.ip_address||'—'}</code></div>
                                <div class="col-6"><strong>الوقت:</strong> ${this.formatDateTime(log.created_at)}</div>
                            </div>
                            <h6 class="fw-bold">القيم القديمة:</h6>
                            ${pretty(log.old_values)}
                            <h6 class="fw-bold mt-3">القيم الجديدة:</h6>
                            ${pretty(log.new_values)}
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-secondary rounded-pill px-4" data-bs-dismiss="modal">إغلاق</button>
                        </div>
                    </div>
                </div>
            </div>
        `);
        new bootstrap.Modal(document.getElementById('auditDetailModal')).show();
    },

    // =================================================================
    //   📈 Reports
    // =================================================================
    viewReports: async function() {
        AdminData.currentView = 'reports';
        AdminData.currentTable = null;
        this.renderSidebar();
        this.destroyCharts();

        Core.navigateTo('Admin.viewReports', () => {
            document.getElementById('mainContent').innerHTML = `
                ${Core.renderHeaderWithTools('التقارير المتقدمة', 'تحليلات مفصّلة للإيرادات وأداء الأطباء')}

                <div class="card border-0 shadow-sm rounded-4 mb-4">
                    <div class="card-body p-4">
                        <div class="row g-3 align-items-end">
                            <div class="col-md-4">
                                <label class="form-label fw-bold">من تاريخ</label>
                                <input type="date" id="rep-from" class="form-control">
                            </div>
                            <div class="col-md-4">
                                <label class="form-label fw-bold">إلى تاريخ</label>
                                <input type="date" id="rep-to" class="form-control">
                            </div>
                            <div class="col-md-4 d-flex gap-2">
                                <button class="btn btn-primary rounded-pill px-4 flex-fill" onclick="Admin.loadReports()"><i class="bi bi-search ms-1"></i> عرض التقارير</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="reports-content">
                    <div class="text-center py-5 text-muted">اضغط "عرض التقارير" لتحميل البيانات.</div>
                </div>
            `;
            // حمّل تلقائياً لأول مرة بلا فلاتر
            this.loadReports();
        });
    },

    loadReports: async function() {
        const from = document.getElementById('rep-from')?.value || null;
        const to   = document.getElementById('rep-to')?.value || null;
        const container = document.getElementById('reports-content');
        if (container) container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';

        const [rev, docs] = await Promise.all([
            Core.apiCall('admin/reports/revenue', 'POST', { from, to }),
            Core.apiCall('admin/reports/doctors', 'POST', { from, to }),
        ]);

        const revRows = rev?.success ? (rev.data.rows || []) : [];
        const docsRows = docs?.success ? (docs.data.rows || []) : [];

        const totalRev = revRows.reduce((s, r) => s + Number(r.revenue || 0), 0);
        const totalVisits = docsRows.reduce((s, r) => s + Number(r.visits || 0), 0);

        const revHtml = revRows.length ? revRows.map(r => `
            <tr>
                <td>${this.escapeHtml(r.category || '—')}</td>
                <td class="fw-bold">${this.escapeHtml(r.service || '—')}</td>
                <td>${r.count}</td>
                <td class="fw-bold text-success">${this.formatCurrency(r.revenue)}</td>
            </tr>`).join('') : `<tr><td colspan="4" class="text-center text-muted py-3">لا توجد بيانات.</td></tr>`;

        const docsHtml = docsRows.length ? docsRows.map(r => `
            <tr>
                <td class="fw-bold">${this.escapeHtml(r.doctor || '—')}</td>
                <td>${r.visits}</td>
                <td><span class="badge bg-success-subtle text-success">${r.completed}</span></td>
                <td><span class="badge bg-warning-subtle text-warning">${r.active}</span></td>
                <td>${r.unique_patients}</td>
            </tr>`).join('') : `<tr><td colspan="5" class="text-center text-muted py-3">لا توجد بيانات.</td></tr>`;

        document.getElementById('reports-content').innerHTML = `
            <div class="row g-3 mb-3">
                <div class="col-md-6"><div class="stat-card p-3"><div class="text-muted small">إجمالي الإيرادات المفلترة</div><div class="fw-bold fs-3 text-success">${this.formatCurrency(totalRev)}</div></div></div>
                <div class="col-md-6"><div class="stat-card p-3"><div class="text-muted small">إجمالي الزيارات المفلترة</div><div class="fw-bold fs-3 text-primary">${totalVisits}</div></div></div>
            </div>

            <div class="row g-4">
                <div class="col-12 col-xl-7">
                    <div class="card border-0 shadow-sm rounded-4">
                        <div class="card-body p-4">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <h5 class="fw-bold mb-0">الإيرادات حسب الخدمة</h5>
                                <button class="btn btn-sm btn-outline-success rounded-pill" onclick="Admin.exportReport('revenue')"><i class="bi bi-download ms-1"></i> CSV</button>
                            </div>
                            <div class="table-responsive">
                                <table class="custom-table text-end mb-0">
                                    <thead><tr><th>التصنيف</th><th>الخدمة</th><th>عدد الطلبات</th><th>الإيراد</th></tr></thead>
                                    <tbody>${revHtml}</tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-12 col-xl-5">
                    <div class="card border-0 shadow-sm rounded-4">
                        <div class="card-body p-4">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <h5 class="fw-bold mb-0">أداء الأطباء</h5>
                                <button class="btn btn-sm btn-outline-success rounded-pill" onclick="Admin.exportReport('doctors')"><i class="bi bi-download ms-1"></i> CSV</button>
                            </div>
                            <div class="table-responsive">
                                <table class="custom-table text-end mb-0">
                                    <thead><tr><th>الطبيب</th><th>زيارات</th><th>مكتملة</th><th>نشطة</th><th>مرضى فريدون</th></tr></thead>
                                    <tbody>${docsHtml}</tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // احفظ للتصدير
        AdminData._lastReport = { revenue: revRows, doctors: docsRows };
    },

    exportReport: function(type) {
        const rows = AdminData._lastReport?.[type];
        if (!rows || !rows.length) { Core.showAlert('لا توجد بيانات للتصدير.', 'warning'); return; }

        let header, mapRow;
        if (type === 'revenue') {
            header = ['التصنيف','الخدمة','عدد الطلبات','الإيراد'];
            mapRow = r => [r.category||'', r.service||'', r.count, r.revenue];
        } else {
            header = ['الطبيب','زيارات','مكتملة','نشطة','مرضى فريدون'];
            mapRow = r => [r.doctor||'', r.visits, r.completed, r.active, r.unique_patients];
        }
        const csv = [header.map(h=>`"${h}"`).join(',')]
            .concat(rows.map(r => mapRow(r).map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',')))
            .join('\r\n');
        const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `report_${type}_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    },

    // =================================================================
    //   🔧 Helpers
    // =================================================================
    renderLoadingState: function(label) {
        return `
            ${Core.renderHeaderWithTools(label, 'جاري التحميل...')}
            <div class="card border-0 shadow-sm rounded-4">
                <div class="card-body text-center py-5">
                    <div class="spinner-border text-primary mb-3"></div>
                    <p class="mb-0 text-muted">جاري جلب البيانات...</p>
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
                    <p class="text-muted mb-3">${this.escapeHtml(message || '')}</p>
                    <button class="btn btn-primary rounded-pill px-4" onclick="Admin.viewDashboard()">العودة للرئيسية</button>
                </div>
            </div>
        `;
    },

    getEnumDisplayLabel: function(tableName, columnName, value) {
        const key = `${tableName}.${columnName}`;
        return ADMIN_ENUM_LABELS[key]?.[value] || value || '—';
    },

    getEnumBadgeClass: function(tableName, columnName, value) {
        const key = `${tableName}.${columnName}`;
        if (key === 'shifts.status') {
            return value === 'closed' ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success';
        }
        if (key === 'shifts_closures.status') {
            return value === 'locked' ? 'bg-dark-subtle text-dark' : 'bg-warning-subtle text-warning';
        }
        if (key === 'shifts.day_mode') {
            if (value === 'morning_only') return 'bg-info-subtle text-info';
            if (value === 'evening_only') return 'bg-dark-subtle text-dark';
            return 'bg-primary-subtle text-primary';
        }
        if (key === 'audit_logs.action') {
            return value === 'AUTO_CLOSE' ? 'bg-warning-subtle text-warning' : 'bg-secondary-subtle text-secondary';
        }
        return 'bg-secondary-subtle text-secondary';
    },

    statusBadge: function(status) {
        const map = {
            'مدفوعة':'bg-success-subtle text-success',
            'معلقة':'bg-warning-subtle text-warning',
            'ملغاة':'bg-danger-subtle text-danger',
        };
        return map[status] || 'bg-secondary-subtle text-secondary';
    },

    visitStatusBadge: function(status) {
        const s = String(status||'').toLowerCase();
        if (s === 'active') return 'bg-warning-subtle text-warning';
        if (s === 'completed') return 'bg-success-subtle text-success';
        if (s === 'cancelled') return 'bg-danger-subtle text-danger';
        return 'bg-secondary-subtle text-secondary';
    },

    translateVisitStatus: function(status) {
        const map = { 'Active':'نشطة', 'Completed':'مكتملة', 'Cancelled':'ملغاة' };
        return map[status] || status || '—';
    },

    formatCurrency: function(value) {
        const n = Number(value||0);
        return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(n);
    },

    formatDateTime: function(val) {
        if (!val) return '—';
        const d = new Date(String(val).replace(' ', 'T'));
        if (isNaN(d)) return String(val).slice(0,19);
        const pad = n => String(n).padStart(2,'0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    escapeHtml: function(value) {
        return String(value ?? '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    },
};

Admin.init();
