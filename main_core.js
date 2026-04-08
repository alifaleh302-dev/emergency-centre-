/**
 * main_core.js
 * النواة المركزية لنظام إدارة مركز الطوارئ - النسخة التجريبية (MVP)
 * مخصص لإدارة: الهوية، التنقل الداخلي، بناء الجداول المتجاوبة، وزر الأدوات، والاتصال المركزي بالخادم (API).
 */

// حقن ستايل بسيط لزر الأدوات ليعمل بالـ Hover على شاشات الكمبيوتر
const style = document.createElement('style');
style.innerHTML = `
    @media (min-width: 992px) {
        .hover-dropdown:hover .dropdown-menu { display: block; margin-top: 0; }
    }
    .tools-btn { border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
    .tools-btn:hover { background-color: #e9ecef; }
`;
document.head.appendChild(style);

const Core = {
    getApiBase: function() {
        const configuredBase = window.APP_CONFIG && window.APP_CONFIG.apiBase
            ? String(window.APP_CONFIG.apiBase).replace(/\/+$/, '')
            : '';

        if (configuredBase) {
            return configuredBase;
        }

        return 'api';
    },

    buildApiUrl: function(path) {
        const normalizedPath = String(path || '').replace(/^\/+/, '');
        return this.getApiBase() + '/' + normalizedPath;
    },

    // --- 1. إدارة الهوية (Profile) ---
    renderProfile: function(user) {
        const desktopContainer = document.getElementById('desktop-profile-container');
        const mobileContainer = document.getElementById('mobile-profile-container');

        if (!desktopContainer || !mobileContainer) return;

        // توليد أحرف أولية من الاسم
        const nameParts = user.name.split(' ');
        const initials = nameParts[0].charAt(0) + (nameParts[1] ? ' ' + nameParts[1].charAt(0) : '');
        const avatarHTML = `<div class="local-avatar text-uppercase shadow-sm">${initials}</div>`;

        // استخدام user.job بناءً على هيكل الـ JSON المعتمد
        const profileHTML = `
            ${avatarHTML}
            <div class="nav-profile-info">
                <div class="nav-profile-name">${user.name}</div>
                <div class="nav-profile-role">${user.job}</div>
            </div>
        `;

        desktopContainer.innerHTML = profileHTML;
        mobileContainer.innerHTML = `
            ${avatarHTML.replace('local-avatar', 'local-avatar mb-2 mx-auto')}
            <h5 class="text-white mt-2 mb-2 fw-bold">${user.name}</h5>
            <span class="sidebar-user-role">${user.job}</span>
        `;
    },

    // --- 2. إدارة التنقل والروابط (Navigation) ---
    renderSidebar: function(links) {
        const sidebarNav = document.getElementById('sidebar-nav-list');
        if (!sidebarNav) return;

        let linksHTML = '';
        links.forEach(link => {
            const activeClass = link.active ? 'active' : '';
            linksHTML += `
                <li>
                    <a href="${link.url || 'javascript:void(0)'}"
                       class="${activeClass}"
                       onclick="${link.action || ''}">
                        <i class="bi ${link.icon}"></i>
                        ${link.title}
                    </a>
                </li>
            `;
        });
        sidebarNav.innerHTML = linksHTML;
    },

    navigateTo: function(viewName, renderCallback) {
        const allLinks = document.querySelectorAll('.sidebar-nav a');
        allLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('onclick') && link.getAttribute('onclick').includes(viewName)) {
                link.classList.add('active');
            }
        });

        this.closeSidebarOnMobile();

        const mainContent = document.getElementById('mainContent');
        mainContent.style.opacity = '0';

        setTimeout(() => {
            if (typeof renderCallback === 'function') {
                renderCallback();
            }
            mainContent.style.transition = 'opacity 0.3s ease';
            mainContent.style.opacity = '1';
            window.scrollTo(0, 0);
        }, 150);
    },

    closeSidebarOnMobile: function() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && window.innerWidth <= 768) {
            sidebar.classList.remove('active');
            document.getElementById('sidebarOverlay')?.classList.remove('active');
            document.getElementById('sidebarToggle')?.classList.remove('active');
        }
    },

    // --- 3. بناء واجهة الرأس وزر الأدوات الديناميكي (Tools Menu) ---
    renderHeaderWithTools: function(title, subtitle, toolsActions = []) {
        let toolsHTML = '';

        if (toolsActions && toolsActions.length > 0) {
            const listItems = toolsActions.map(item => `
                <li><a class="dropdown-item fw-bold small text-dark d-flex align-items-center gap-2 py-2" href="javascript:void(0)" onclick="${item.action}">
                    <i class="bi ${item.icon} text-primary fs-6"></i> ${item.label}
                </a></li>
            `).join('');

            toolsHTML = `
                <div class="dropdown hover-dropdown ms-auto">
                    <button class="btn btn-light tools-btn shadow-sm border" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                        <i class="bi bi-three-dots-vertical fs-5 text-dark"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end shadow border-0 mt-1" style="min-width: 200px; border-radius: 12px;">
                        ${listItems}
                    </ul>
                </div>
            `;
        } else {
            toolsHTML = `<div style="width:40px; height:40px;"></div>`;
        }

        return `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h3 class="fw-bold text-dark mb-1">${title}</h3>
                    <p class="text-muted small mb-0">${subtitle}</p>
                </div>
                ${toolsHTML}
            </div>
        `;
    },

    // --- 4. دالة بناء الجداول المتجاوبة (Responsive Table Builder) ---
    renderTable: function(containerId, headers, rows, actionBuilder) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // استخدام table-responsive و text-nowrap لضمان التجاوب مع الهواتف
        let tableHTML = `
            <div class="table-responsive">
                <table class="custom-table text-end mb-0 text-nowrap" >
                    <thead class="bg-light">
                        <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${rows.map((row, index) => `
                            <tr>
                                ${row.map((cell, cellIndex) => `<td>${this.formatCell(cell, cellIndex)}</td>`).join('')}
                                ${actionBuilder ? `<td>${actionBuilder(row, index)}</td>` : ''}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = tableHTML;
    },

    formatCell: function(content, index) {
        // تنسيق تلقائي لأول عمود (مثل رقم الملف/السند)
        if (index === 0 && String(content).startsWith('#')) {
            return `<span class="text-muted fw-bold">${content}</span>`;
        }
        return content;
    },

       apiCall: async function(path, method = 'GET', data = null) {
        try {
            const token = localStorage.getItem('jwt_token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;

            const options = { method: method, headers: headers };
            if (data && (method === 'POST' || method === 'PUT')) {
                options.body = JSON.stringify(data);
            }

            const response = await fetch(this.buildApiUrl(path), options);

            if (response.status === 401) {
                // إذا كنا في صفحة تسجيل الدخول، نُرجع الرد كما هو بدون إعادة توجيه
                const isLoginPage = window.location.pathname.includes('login');
                if (!isLoginPage) {
                    Core.showAlert("انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.", "warning");
                    localStorage.removeItem('jwt_token');
                    window.location.href = 'login.html';
                    return null;
                }
            }

            const rawText = await response.text();

            // محاولة تحويل الرد إلى JSON دائماً (حتى لو كان خطأ)
            let jsonData = null;
            try {
                jsonData = JSON.parse(rawText);
            } catch (parseError) {
                if (!response.ok) {
                    console.error("[API Error Raw]:", rawText);
                    Core.showAlert("حدث خطأ في السيرفر", "error");
                    return null;
                }
                console.error("[API JSON Parse Error]:", rawText);
                Core.showAlert("السيرفر أرجع بيانات غير صالحة", "error");
                return null;
            }

            // إذا كان الرد خطأ HTTP لكن JSON صالح، نُرجعه للمستدعي لعرض رسالة الخطأ الحقيقية
            if (!response.ok) {
                console.warn("[API Error]:", response.status, jsonData);
                return jsonData; // {success: false, message: "..."
            }

            return jsonData;

        } catch(e) {
            Core.showAlert("فشل الاتصال بالخادم، تحقق من اتصالك.", "error");
            console.error("API Call Exception:", e);
            return null;
        }
    },

    // --- 6. الإشعارات (Alerts) ---
    showAlert: function(message, type = 'success') {
        const types = {
            'success': { class: 'bg-success', icon: 'bi-check-circle-fill' },
            'error':   { class: 'bg-danger',  icon: 'bi-x-circle-fill' },
            'warning': { class: 'bg-warning text-dark', icon: 'bi-exclamation-triangle-fill' },
            'info':    { class: 'bg-info',    icon: 'bi-info-circle-fill' }
        };

        const config = types[type] || types['info'];

        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'toast-container position-fixed bottom-0 start-0 p-3';
            toastContainer.style.zIndex = '1060';
            document.body.appendChild(toastContainer);
        }

        const toastId = 'toast-' + Date.now();
        const toastHTML = `
            <div id="${toastId}" class="toast align-items-center text-white ${config.class} border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="d-flex p-2">
                    <div class="toast-body d-flex align-items-center">
                        <i class="bi ${config.icon} fs-5 ms-2"></i>
                        <span class="fw-bold">${message}</span>
                    </div>
                    <button type="button" class="btn-close btn-close-white me-auto m-2" data-bs-dismiss="toast"></button>
                </div>
            </div>
        `;

        toastContainer.insertAdjacentHTML('beforeend', toastHTML);
        const toastElement = document.getElementById(toastId);
        const bsToast = new bootstrap.Toast(toastElement, { delay: 4000 });
        bsToast.show();

        toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
    },

    // --- 7. نظام الإشعارات الذكي (Smart Notifications) ---
    _notifInterval: null,
    _lastNotifCount: 0,

    initNotifications: function() {
        // إنشاء زر الجرس في الشريط العلوي
        const exitBtn = document.querySelector('.btn-exit');
        if (!exitBtn || document.getElementById('notif-bell')) return;

        const bellHTML = `
            <div class="dropdown hover-dropdown" id="notif-bell" style="margin-left:12px;">
                <button class="btn position-relative p-0" type="button" data-bs-toggle="dropdown" 
                        style="background:none;border:none;color:white;font-size:1.4rem;" onclick="Core.loadNotifications()">
                    <i class="bi bi-bell-fill"></i>
                    <span id="notif-badge" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" style="font-size:0.6rem;display:none;">0</span>
                </button>
                <div class="dropdown-menu dropdown-menu-start shadow border-0 p-0" style="min-width:320px;max-height:400px;overflow-y:auto;border-radius:12px;" id="notif-dropdown">
                    <div class="p-3 text-center text-muted small">جاري التحميل...</div>
                </div>
            </div>`;
        exitBtn.insertAdjacentHTML('beforebegin', bellHTML);

        // فحص دوري كل 8 ثواني
        this.checkNotifCount();
        this._notifInterval = setInterval(() => this.checkNotifCount(), 8000);
    },

    checkNotifCount: async function() {
        const res = await this.apiCall('notifications/unread', 'GET');
        if (!res || !res.success) return;
        const badge = document.getElementById('notif-badge');
        if (!badge) return;

        if (res.count > 0) {
            badge.textContent = res.count;
            badge.style.display = '';
            // تشغيل صوت إشعار عند ورود إشعار جديد
            if (res.count > this._lastNotifCount && this._lastNotifCount >= 0) {
                this.showAlert(res.data[0].title, 'info');
            }
        } else {
            badge.style.display = 'none';
        }
        this._lastNotifCount = res.count;
    },

    loadNotifications: async function() {
        const dropdown = document.getElementById('notif-dropdown');
        if (!dropdown) return;
        dropdown.innerHTML = '<div class="p-3 text-center"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

        const res = await this.apiCall('notifications/unread', 'GET');
        if (!res || !res.success) {
            dropdown.innerHTML = '<div class="p-3 text-center text-danger small">خطأ في جلب الإشعارات</div>';
            return;
        }

        if (res.data.length === 0) {
            dropdown.innerHTML = '<div class="p-4 text-center text-muted"><i class="bi bi-bell-slash fs-3 d-block mb-2"></i>لا توجد إشعارات جديدة</div>';
            return;
        }

        const icons = { 'new_invoice': 'bi-receipt text-primary', 'invoice_paid': 'bi-cash-coin text-success', 'new_visit': 'bi-person-plus text-info' };
        let html = res.data.map(n => `
            <div class="d-flex align-items-start gap-2 p-3 border-bottom" style="cursor:pointer;">
                <i class="bi ${icons[n.event_type] || 'bi-bell text-secondary'} fs-5 mt-1"></i>
                <div class="flex-grow-1">
                    <div class="fw-bold small text-dark">${n.title}</div>
                    <div class="text-muted" style="font-size:0.8rem;">${n.body || ''}</div>
                    <div class="text-muted" style="font-size:0.7rem;"><i class="bi bi-clock ms-1"></i>${n.time}</div>
                </div>
            </div>`).join('');

        html += `<div class="p-2 text-center border-top">
                    <button class="btn btn-sm btn-outline-secondary w-100 fw-bold" onclick="Core.markAllRead()">
                        <i class="bi bi-check2-all ms-1"></i> تعيين الكل كمقروء
                    </button>
                 </div>`;
        dropdown.innerHTML = html;
    },

    markAllRead: async function() {
        await this.apiCall('notifications/read', 'POST');
        const badge = document.getElementById('notif-badge');
        if (badge) badge.style.display = 'none';
        this._lastNotifCount = 0;
        const dropdown = document.getElementById('notif-dropdown');
        if (dropdown) dropdown.innerHTML = '<div class="p-4 text-center text-muted"><i class="bi bi-check2-all fs-3 d-block mb-2 text-success"></i>تم تعيين الكل كمقروء</div>';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    console.log("تم تهيئة النواة المركزية للنسخة التجريبية (MVP)...");
});


