<?php
declare(strict_types=1);
require_once __DIR__ . '/BaseController.php';
require_once __DIR__ . '/../Utils/AuditService.php';

class AdminController extends BaseController
{
    private PDO $conn;
    private AdminModel $model;
    private AuditService $audit;
    private string $userId;
    private string $username;

    public function __construct(string $userId)
    {
        $database = new Database();
        $this->conn = $database->getConnection();
        $this->model = new AdminModel($this->conn, $database->getDriver());
        $this->audit = new AuditService($this->conn);
        $this->userId = $userId;
        $this->username = $_SESSION['name'] ?? ('user_' . $userId);
    }

    // -------------------- Schema --------------------
    public function getSchema(): void
    {
        try {
            $this->success([
                'tables' => $this->model->getSchema(),
            ]);
        } catch (Throwable $e) {
            error_log('admin/schema: ' . $e->getMessage());
            $this->error('تعذر جلب مخطط قاعدة البيانات.', 500);
        }
    }

    // -------------------- Dashboard --------------------
    public function getDashboard(): void
    {
        try {
            $this->success($this->model->getDashboardStats());
        } catch (Throwable $e) {
            error_log('admin/dashboard: ' . $e->getMessage());
            $this->error('تعذر جلب لوحة المؤشرات الرئيسية.', 500);
        }
    }

    public function getDashboardCharts(): void
    {
        try {
            $this->success($this->model->getDashboardCharts());
        } catch (Throwable $e) {
            error_log('admin/dashboard_charts: ' . $e->getMessage());
            $this->error('تعذر جلب بيانات الرسوم البيانية.', 500);
        }
    }

    public function getSystemSettings(): void
    {
        try {
            $this->success($this->model->getSystemSettingsCatalog());
        } catch (Throwable $e) {
            error_log('admin/settings: ' . $e->getMessage());
            $this->error('تعذر جلب إعدادات النظام.', 500);
        }
    }

    public function saveSystemSettings($data): void
    {
        try {
            $settings = $this->toArray($this->getField($data, 'settings', []));
            if (empty($settings)) {
                throw new InvalidArgumentException('لا توجد إعدادات مطلوبة للحفظ.');
            }

            $oldValues = $this->model->getSystemSettingsSnapshot(array_keys($settings));
            $result = $this->model->saveSystemSettings($settings, $this->userId);
            $newValues = $this->model->getSystemSettingsSnapshot(array_keys($settings));

            $this->audit->log(
                $this->userId,
                $this->username,
                'UPDATE',
                'system_settings',
                null,
                $oldValues,
                $newValues
            );

            $this->success($result, 'تم حفظ إعدادات النظام بنجاح.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/save_settings: ' . $e->getMessage());
            $this->error('تعذر حفظ إعدادات النظام.', 500);
        }
    }

    public function getShiftBoundaries(): void
    {
        try {
            $shiftDate = $this->sanitizeText($_GET['date'] ?? '', 'date', 10);
            $this->success($this->model->getShiftDayDefinition($shiftDate));
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/get_shift_boundaries: ' . $e->getMessage());
            $this->error('تعذر جلب حدود الفترات لليوم المطلوب.', 500);
        }
    }

    public function saveShiftBoundaries($data): void
    {
        try {
            $shiftDate = $this->sanitizeText($this->getField($data, 'shift_date'), 'shift_date', 10);
            $splitTime = $this->sanitizeText($this->getField($data, 'split_time'), 'split_time', 5);
            $dayMode = $this->sanitizeText($this->getField($data, 'day_mode'), 'day_mode', 20);

            $before = $this->model->getShiftDayDefinition($shiftDate);
            $result = $this->model->saveShiftBoundaries($shiftDate, $splitTime, $dayMode, (int) $this->userId);

            $this->audit->log(
                $this->userId,
                $this->username,
                'UPDATE',
                'shifts',
                $shiftDate,
                $before,
                $result
            );

            $this->success($result, 'تم حفظ حدود الفترات لليوم المحدد بنجاح.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (RuntimeException $e) {
            $this->error($e->getMessage(), 409);
        } catch (Throwable $e) {
            error_log('admin/save_shift_boundaries: ' . $e->getMessage());
            $this->error('تعذر حفظ حدود الفترات.', 500);
        }
    }

    public function getReferenceOptions($data): void
    {
        try {
            $table = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $column = $this->sanitizeText($this->getField($data, 'column'), 'column', 120);
            $this->success([
                'options' => $this->model->getReferenceOptionsForField($table, $column),
            ]);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/reference_options: ' . $e->getMessage());
            $this->error('تعذر جلب القيم المرجعية الحية.', 500);
        }
    }

    // -------------------- CRUD --------------------
    public function listRecords($data): void
    {
        try {
            $table   = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $page    = $this->sanitizeInteger($this->getField($data, 'page', 1), 'page', 1);
            $perPage = $this->sanitizeInteger($this->getField($data, 'per_page', 15), 'per_page', 1);
            $search  = $this->sanitizeText($this->getField($data, 'search', ''), 'search', 255, true);
            $sortBy  = $this->getField($data, 'sort_by');
            $sortDir = $this->sanitizeText($this->getField($data, 'sort_dir', 'DESC'), 'sort_dir', 8, true);
            $filters = $this->toArray($this->getField($data, 'filters', []));

            $result = $this->model->getTableRows(
                $table, $page, $perPage, $search, $filters,
                is_string($sortBy) ? $sortBy : null, $sortDir
            );
            // ✨ إثراء الصفوف بأسماء الـ FKs (role_name بدل role_id … إلخ)
            $result['rows'] = $this->model->enrichRowsWithForeignLabels($table, $result['rows']);
            $this->success($result);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/list: ' . $e->getMessage());
            $this->error('تعذر جلب بيانات الجدول المطلوب.', 500);
        }
    }

    public function getRecord($data): void
    {
        try {
            $table = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $id = $this->sanitizeIdentifier($this->getField($data, 'id'), 'id');
            $this->success([
                'record' => $this->model->getRecord($table, $id),
            ]);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/record: ' . $e->getMessage());
            $this->error('تعذر جلب السجل المطلوب.', 500);
        }
    }

    public function saveRecord($data): void
    {
        try {
            $table = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $idRaw = $this->getField($data, 'id');
            $id = ($idRaw === null || $idRaw === '') ? null : $this->sanitizeIdentifier($idRaw, 'id');
            $record = $this->toArray($this->getField($data, 'record', []));

            // إذا كان المدير يعدل حسابه الحالي فلا يسمح له بسحب صلاحية المدير من نفسه.
            if ($table === 'users' && $id !== null && (string) $id === (string) $this->userId) {
                $roleId = isset($record['role_id']) ? (string) $record['role_id'] : null;
                if ($roleId !== null && $roleId !== '' && !$this->isAdminRole($roleId)) {
                    throw new InvalidArgumentException('لا يمكن سحب صلاحية المدير من الحساب الحالي أثناء الجلسة.');
                }
            }

            // التقط القيم القديمة قبل الحفظ (للـ Audit)
            $oldValues = null;
            if ($id !== null) {
                try { $oldValues = $this->model->getRecord($table, $id); } catch (Throwable $e) { $oldValues = null; }
            }

            $saved = $this->model->saveRecord($table, $record, $id);

            // ✅ Audit
            $savedPk = $saved[$this->primaryKeyOf($table)] ?? null;
            $this->audit->log(
                $this->userId, $this->username,
                $id === null ? 'CREATE' : 'UPDATE',
                $table,
                $savedPk !== null ? (string) $savedPk : null,
                $oldValues, $saved
            );

            $this->success([
                'record' => $saved,
            ], $id === null ? 'تم إنشاء السجل بنجاح.' : 'تم تحديث السجل بنجاح.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (PDOException $e) {
            error_log('admin/save PDO: ' . $e->getMessage());
            $this->error('تعذر حفظ السجل بسبب قيد في قاعدة البيانات.', 409);
        } catch (Throwable $e) {
            error_log('admin/save: ' . $e->getMessage());
            $this->error('تعذر حفظ السجل المطلوب.', 500);
        }
    }

    public function deleteRecord($data): void
    {
        try {
            $table = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $id = $this->sanitizeIdentifier($this->getField($data, 'id'), 'id');

            if ($table === 'users' && (string) $id === (string) $this->userId) {
                throw new InvalidArgumentException('لا يمكن حذف الحساب الحالي المستخدم في الجلسة.');
            }

            $oldValues = null;
            try { $oldValues = $this->model->getRecord($table, $id); } catch (Throwable $e) { $oldValues = null; }

            $this->model->deleteRecord($table, $id);

            $this->audit->log($this->userId, $this->username, 'DELETE', $table, (string) $id, $oldValues, null);

            $this->success(null, 'تم حذف السجل بنجاح.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (PDOException $e) {
            $this->error('تعذر حذف السجل لوجود بيانات مرتبطة به.', 409);
        } catch (Throwable $e) {
            error_log('admin/delete: ' . $e->getMessage());
            $this->error('تعذر حذف السجل المطلوب.', 500);
        }
    }

    // -------------------- Export --------------------
    public function exportRecords($data): void
    {
        try {
            $table   = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $search  = $this->sanitizeText($this->getField($data, 'search', ''), 'search', 255, true);
            $filters = $this->toArray($this->getField($data, 'filters', []));
            $format  = strtolower($this->sanitizeText($this->getField($data, 'format', 'csv'), 'format', 10, true));

            $export = $this->model->getTableRowsForExport($table, $search, $filters);
            $this->audit->log($this->userId, $this->username, 'EXPORT', $table, null, null, ['rows' => count($export['rows']), 'format' => $format]);

            // سنبقى ضمن JSON (يحوّل الواجهة إلى CSV/Excel محلياً)
            $this->success([
                'rows'    => $export['rows'],
                'columns' => array_values($export['columns']),
                'label'   => $export['label'],
                'format'  => $format,
            ]);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/export: ' . $e->getMessage());
            $this->error('تعذر تجهيز ملف التصدير.', 500);
        }
    }

    // -------------------- User-specific actions --------------------
    public function changeUserPassword($data): void
    {
        try {
            $targetId = $this->sanitizeIdentifier($this->getField($data, 'user_id'), 'user_id');
            $newPass  = (string) $this->getField($data, 'new_password', '');
            $this->model->changeUserPassword($targetId, $newPass);
            $this->audit->log($this->userId, $this->username, 'UPDATE', 'users', (string) $targetId, null, ['action' => 'password_changed']);
            $this->success(null, 'تم تغيير كلمة المرور بنجاح.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/change_password: ' . $e->getMessage());
            $this->error('تعذر تغيير كلمة المرور.', 500);
        }
    }

    public function toggleUser($data): void
    {
        try {
            $targetId = $this->sanitizeIdentifier($this->getField($data, 'user_id'), 'user_id');
            if ((string) $targetId === (string) $this->userId) {
                throw new InvalidArgumentException('لا يمكن تعطيل الحساب الحالي.');
            }
            $active = filter_var($this->getField($data, 'active', true), FILTER_VALIDATE_BOOLEAN);
            $this->model->toggleUserActive($targetId, $active);
            $this->audit->log($this->userId, $this->username, 'UPDATE', 'users', (string) $targetId, null, ['is_active' => $active]);
            $this->success(null, $active ? 'تم تفعيل المستخدم.' : 'تم تعطيل المستخدم.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/toggle_user: ' . $e->getMessage());
            $this->error('تعذر تعديل حالة المستخدم.', 500);
        }
    }

    // -------------------- Operations (Cancel) --------------------
    public function cancelInvoice($data): void
    {
        try {
            $invoiceId = $this->sanitizeIdentifier($this->getField($data, 'invoice_id'), 'invoice_id');
            $reason    = $this->sanitizeText($this->getField($data, 'reason', 'بدون سبب محدد'), 'reason', 255, true);
            $row = $this->model->cancelInvoice($invoiceId, $this->userId, $reason);
            $this->audit->log($this->userId, $this->username, 'CANCEL', 'invoices', (string) $invoiceId, null, ['reason' => $reason]);
            $this->success(['invoice' => $row], 'تم إلغاء الفاتورة بنجاح.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/cancel_invoice: ' . $e->getMessage());
            $this->error('تعذر إلغاء الفاتورة.', 500);
        }
    }

    public function cancelVisit($data): void
    {
        try {
            $visitId = $this->sanitizeIdentifier($this->getField($data, 'visit_id'), 'visit_id');
            $reason  = $this->sanitizeText($this->getField($data, 'reason', 'بدون سبب محدد'), 'reason', 255, true);
            $row = $this->model->cancelVisit($visitId, $this->userId, $reason);
            $this->audit->log($this->userId, $this->username, 'CANCEL', 'visits', (string) $visitId, null, ['reason' => $reason]);
            $this->success(['visit' => $row], 'تم إلغاء الزيارة بنجاح.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/cancel_visit: ' . $e->getMessage());
            $this->error('تعذر إلغاء الزيارة.', 500);
        }
    }

    /**
     * 🆕 POST /api/admin/reopen_shift
     * body: { closure_id: int }
     *
     * إعادة فتح الفترة المالية الأخيرة (فقط):
     *   • يحذف سند التحصيل الإجمالي (مع تحديث تسلسل السندات)
     *   • يفصل التذاكر عن الإقفال
     *   • يحذف سجل الإقفال
     */
    public function reopenShift($data): void
    {
        try {
            $closureId = $this->sanitizeIdentifier($this->getField($data, 'closure_id'), 'closure_id');
            $result = $this->model->reopenLatestShift((int) $closureId, (int) $this->userId);
            $this->audit->log(
                $this->userId,
                $this->username,
                'REOPEN',
                'shifts_closures',
                (string) $closureId,
                null,
                $result
            );
            $this->success($result, 'تمت إعادة فتح الفترة بنجاح وحذف سند التحصيل المرتبط.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (PDOException $e) {
            error_log('admin/reopen_shift PDO: ' . $e->getMessage());
            $this->error('تعذر إعادة فتح الفترة بسبب قيد في قاعدة البيانات.', 409);
        } catch (Throwable $e) {
            error_log('admin/reopen_shift: ' . $e->getMessage());
            $this->error('تعذر إعادة فتح الفترة حالياً.', 500);
        }
    }

    // -------------------- Broadcast --------------------
    public function broadcastNotification($data): void
    {
        try {
            $role  = $this->sanitizeText($this->getField($data, 'target_role'), 'target_role', 50);
            $title = $this->sanitizeText($this->getField($data, 'title'), 'title', 150);
            $body  = $this->sanitizeText($this->getField($data, 'body', ''), 'body', 500, true);
            $row = $this->model->broadcastNotification($role, $title, $body);
            $notifId = $row['notification_id'] ?? null;
            $this->audit->log($this->userId, $this->username, 'CREATE', 'notifications', $notifId !== null ? (string) $notifId : null, null, ['target_role' => $role, 'title' => $title]);
            $this->success(['notification' => $row], 'تم بث الإشعار إلى ' . $role);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/broadcast: ' . $e->getMessage());
            $this->error('تعذر بث الإشعار.', 500);
        }
    }

    // -------------------- Audit Log viewer --------------------
    public function getAuditLog($data): void
    {
        try {
            $page    = $this->sanitizeInteger($this->getField($data, 'page', 1), 'page', 1);
            $perPage = $this->sanitizeInteger($this->getField($data, 'per_page', 25), 'per_page', 1);
            $filters = [
                'action'   => $this->getField($data, 'action'),
                'table'    => $this->getField($data, 'table'),
                'username' => $this->getField($data, 'username'),
                'from'     => $this->getField($data, 'from'),
                'to'       => $this->getField($data, 'to'),
            ];
            $this->success($this->model->getAuditLogs($page, $perPage, array_filter($filters)));
        } catch (Throwable $e) {
            error_log('admin/audit: ' . $e->getMessage());
            $this->error('تعذر جلب سجل التدقيق.', 500);
        }
    }

    // -------------------- Reports --------------------
    public function reportRevenue($data): void
    {
        try {
            $from = $this->getField($data, 'from');
            $to   = $this->getField($data, 'to');
            $this->success([
                'rows' => $this->model->reportRevenueByService(
                    $from ? (string) $from : null,
                    $to   ? (string) $to   : null
                ),
            ]);
        } catch (Throwable $e) {
            error_log('admin/report_revenue: ' . $e->getMessage());
            $this->error('تعذر جلب تقرير الإيرادات.', 500);
        }
    }

    public function reportDoctors($data): void
    {
        try {
            $from = $this->getField($data, 'from');
            $to   = $this->getField($data, 'to');
            $this->success([
                'rows' => $this->model->reportDoctorPerformance(
                    $from ? (string) $from : null,
                    $to   ? (string) $to   : null
                ),
            ]);
        } catch (Throwable $e) {
            error_log('admin/report_doctors: ' . $e->getMessage());
            $this->error('تعذر جلب تقرير أداء الأطباء.', 500);
        }
    }

    // -------------------- Helpers --------------------
    private function primaryKeyOf(string $table): string
    {
        foreach ($this->model->getSchema() as $meta) {
            if ($meta['table'] === $table) return $meta['primary_key'];
        }
        return 'id';
    }

    /**
     * يتحقق ممّا إذا كان الدور المحدد هو دور المدير (role_code = 5).
     * بعد الترحيل 003: role_id أصبح INT ويتطابق مع role_code.
     */
    private function isAdminRole(string $roleId): bool
    {
        if ($roleId === '' || !preg_match('/^\d+$/', $roleId)) return false;
        try {
            $stmt = $this->conn->prepare('SELECT role_code FROM Roles WHERE role_id = :id LIMIT 1');
            $stmt->execute([':id' => $roleId]);
            $code = $stmt->fetchColumn();
            return $code !== false && (int) $code === 5;
        } catch (Throwable $e) {
            return false;
        }
    }

    private function toArray(mixed $value): array
    {
        if (is_array($value)) return $value;
        if (is_object($value)) return json_decode(json_encode($value, JSON_UNESCAPED_UNICODE), true) ?: [];
        return [];
    }

    public function payInvoiceOverride($data): void
    {
        try {
            $this->requireFields($data, ['Invoice_id', 'net_amount', 'exemption_value', 'doc_type', 'reason']);

            $invoiceId = $this->extractId($this->getField($data, 'Invoice_id'), 'Invoice_id');
            $netAmount = $this->sanitizeAmount($this->getField($data, 'net_amount'), 'net_amount');
            $exemptionValue = $this->sanitizeAmount($this->getField($data, 'exemption_value'), 'exemption_value');
            $docType = $this->ensureAllowedValue($this->getField($data, 'doc_type'), ['A', 'B', 'C'], 'doc_type');
            $reason = $this->sanitizeText($this->getField($data, 'reason'), 'reason', 500, false);

            $settings = new SettingsService($this->conn);
            if (!$settings->allowsAdminPaymentOverride()) {
                $this->error('تجاوز قيد الفترات معطّل في الإعدادات.', 403);
                return;
            }

            $database = new Database();
            $accounting = new AccountingModel($this->conn, $database->getDriver());

            $pendingInvoice = $accounting->getPendingInvoiceById($invoiceId);
            if (!$pendingInvoice) {
                throw new InvalidArgumentException('الفاتورة المطلوبة غير موجودة أو تم تحصيلها مسبقاً.');
            }
            $total = round((float) $pendingInvoice['total'], 2);
            if ($docType === 'A') {
                if ($netAmount !== $total || $exemptionValue !== 0.0) {
                    throw new InvalidArgumentException('بيانات السداد غير صحيحة لحالة الدفع الكامل.');
                }
            } elseif ($docType === 'B') {
                if ($netAmount <= 0 || $netAmount >= $total || round($netAmount + $exemptionValue, 2) !== $total) {
                    throw new InvalidArgumentException('بيانات السداد غير صحيحة لحالة الإعفاء الجزئي.');
                }
            } elseif ($docType === 'C') {
                if ($netAmount !== 0.0 || $exemptionValue !== $total) {
                    throw new InvalidArgumentException('بيانات السداد غير صحيحة لحالة الإعفاء الكلي.');
                }
            }

            $blocker = $accounting->findBlockingPreviousShift($invoiceId);

            $result = $accounting->processPayment(
                $invoiceId,
                $netAmount,
                $exemptionValue,
                $docType,
                (int) $this->userId,
                true
            );

            $this->audit->log(
                $this->userId,
                $this->username,
                'PAYMENT_OVERRIDE',
                'invoices',
                $invoiceId,
                null,
                [
                    'reason' => $reason,
                    'doc_type' => $docType,
                    'net_amount' => $netAmount,
                    'exemption_value' => $exemptionValue,
                    'blocking_shift' => $blocker,
                    'result' => $result,
                ]
            );

            $this->success($result, 'تم تنفيذ التسديد بتجاوز إداري مع تسجيل العملية.');
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage(), 422);
        } catch (Throwable $e) {
            error_log('admin/pay_invoice_override: ' . $e->getMessage());
            $this->error('تعذر تنفيذ التجاوز الإداري حالياً.', 500);
        }
    }
}
