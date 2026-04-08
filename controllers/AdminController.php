<?php
declare(strict_types=1);
require_once __DIR__ . '/BaseController.php';

class AdminController extends BaseController
{
    private PDO $conn;
    private AdminModel $model;
    private int $userId;

    public function __construct(int $userId)
    {
        $database = new Database();
        $this->conn = $database->getConnection();
        $this->model = new AdminModel($this->conn, $database->getDriver());
        $this->userId = $userId;
    }

    public function getSchema(): void
    {
        try {
            $this->success([
                'tables' => $this->model->getSchema(),
            ]);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب مخطط قاعدة البيانات.', 500);
        }
    }

    public function getDashboard(): void
    {
        try {
            $this->success($this->model->getDashboardStats());
        } catch (Throwable $exception) {
            $this->error('تعذر جلب لوحة المؤشرات الرئيسية.', 500);
        }
    }

    public function listRecords($data): void
    {
        try {
            $table = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $page = $this->sanitizeInteger($this->getField($data, 'page', 1), 'page', 1);
            $perPage = $this->sanitizeInteger($this->getField($data, 'per_page', 15), 'per_page', 1);
            $search = $this->sanitizeText($this->getField($data, 'search', ''), 'search', 255, true);
            $sortBy = $this->getField($data, 'sort_by');
            $sortDir = $this->sanitizeText($this->getField($data, 'sort_dir', 'DESC'), 'sort_dir', 8, true);
            $filters = $this->toArray($this->getField($data, 'filters', []));

            $result = $this->model->getTableRows($table, $page, $perPage, $search, $filters, is_string($sortBy) ? $sortBy : null, $sortDir);
            $this->success($result);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب بيانات الجدول المطلوب.', 500);
        }
    }

    public function getRecord($data): void
    {
        try {
            $table = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $id = $this->sanitizeInteger($this->getField($data, 'id'), 'id', 1);
            $this->success([
                'record' => $this->model->getRecord($table, $id),
            ]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب السجل المطلوب.', 500);
        }
    }

    public function saveRecord($data): void
    {
        try {
            $table = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $idRaw = $this->getField($data, 'id');
            $id = ($idRaw === null || $idRaw === '') ? null : $this->sanitizeInteger($idRaw, 'id', 1);
            $record = $this->toArray($this->getField($data, 'record', []));

            if ($table === 'users' && $id !== null && $id === $this->userId) {
                $roleId = $record['role_id'] ?? null;
                if ($roleId !== null && (int) $roleId !== 5) {
                    throw new InvalidArgumentException('لا يمكن سحب صلاحية المدير من الحساب الحالي أثناء الجلسة.');
                }
            }

            $saved = $this->model->saveRecord($table, $record, $id);
            $this->success([
                'record' => $saved,
            ], $id === null ? 'تم إنشاء السجل بنجاح.' : 'تم تحديث السجل بنجاح.');
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (PDOException $exception) {
            $this->error('تعذر حفظ السجل بسبب قيد في قاعدة البيانات.', 409);
        } catch (Throwable $exception) {
            $this->error('تعذر حفظ السجل المطلوب.', 500);
        }
    }

    public function deleteRecord($data): void
    {
        try {
            $table = $this->sanitizeText($this->getField($data, 'table'), 'table', 120);
            $id = $this->sanitizeInteger($this->getField($data, 'id'), 'id', 1);

            if ($table === 'users' && $id === $this->userId) {
                throw new InvalidArgumentException('لا يمكن حذف الحساب الحالي المستخدم في الجلسة.');
            }

            $this->model->deleteRecord($table, $id);
            $this->success(null, 'تم حذف السجل بنجاح.');
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (PDOException $exception) {
            $this->error('تعذر حذف السجل لوجود بيانات مرتبطة به.', 409);
        } catch (Throwable $exception) {
            $this->error('تعذر حذف السجل المطلوب.', 500);
        }
    }

    private function toArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (is_object($value)) {
            return json_decode(json_encode($value, JSON_UNESCAPED_UNICODE), true) ?: [];
        }
        return [];
    }
}
