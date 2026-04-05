<?php
declare(strict_types=1);

class DoctorController extends BaseController
{
    private PDO $conn;
    private DoctorModel $model;
    private int $doctor_id;

    public function __construct(int $doctor_id)
    {
        $database = new Database();
        $this->conn = $database->getConnection();
        $this->model = new DoctorModel($this->conn, $database->getDriver());
        $this->doctor_id = $doctor_id;
    }

    public function newPatient($data): void
    {
        try {
            $this->requireFields($data, ['name', 'age', 'type_case']);

            $name = $this->sanitizeText($this->getField($data, 'name'), 'name', 150);
            $age = $this->sanitizeInteger($this->getField($data, 'age'), 'age', 0);
            if ($age > 120) {
                throw new InvalidArgumentException('العمر المدخل غير منطقي.');
            }

            $typeCase = $this->sanitizeText($this->getField($data, 'type_case'), 'type_case', 100);
            $gender = $this->normalizeGender($this->getField($data, 'gender', 'ذكر'));
            $place1 = $this->sanitizeText($this->getField($data, 'place1', ''), 'place1', 150, true);
            $place2 = $this->sanitizeText($this->getField($data, 'place2', ''), 'place2', 150, true);
            $diagnosis = $this->sanitizeText($this->getField($data, 'diagnosis', ''), 'diagnosis', 255, true);
            $note = $this->sanitizeText($this->getField($data, 'note', ''), 'note', 500, true);
            $birthDate = date('Y-m-d', strtotime('-' . $age . ' years'));
            $caseTypeId = $this->model->getCaseTypeId($typeCase) ?? 1;

            $this->conn->beginTransaction();
            $patientId = $this->model->createPatient($name, $gender, $birthDate, $place1, $place2);
            $this->model->createVisit($patientId, $this->doctor_id, $caseTypeId, $diagnosis, $note, $typeCase);
            $this->conn->commit();

            $this->success(null, 'تم تسجيل المريض وفتح الزيارة بنجاح');
        } catch (InvalidArgumentException $exception) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            $this->error($this->mapDoctorError($exception), 400);
        }
    }

    public function existingPatientVisit($data): void
    {
        try {
            $this->requireFields($data, ['id_pat', 'type_case']);

            $patientId = $this->extractId($this->getField($data, 'id_pat'), 'id_pat');
            if (!$this->model->patientExists($patientId)) {
                throw new InvalidArgumentException('المريض المطلوب غير موجود.');
            }

            $typeCase = $this->sanitizeText($this->getField($data, 'type_case'), 'type_case', 100);
            $diagnosis = $this->sanitizeText($this->getField($data, 'diagnosis', ''), 'diagnosis', 255, true);
            $note = $this->sanitizeText($this->getField($data, 'note', ''), 'note', 500, true);
            $caseTypeId = $this->model->getCaseTypeId($typeCase) ?? 1;

            $this->model->createVisit($patientId, $this->doctor_id, $caseTypeId, $diagnosis, $note, $typeCase);
            $this->success(null, 'تم فتح الزيارة بنجاح');
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error($this->mapDoctorError($exception), 400);
        }
    }

    public function getWaitingList(): void
    {
        try {
            $list = $this->model->getWaitingList($this->doctor_id);
            foreach ($list as &$item) {
                $item['visit'] = 'VIS-' . $item['visit'];
            }

            $this->success($list);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب قائمة الانتظار حالياً.', 500);
        }
    }

    public function finalDiagnosis($data): void
    {
        try {
            $this->requireFields($data, ['id_vis', 'diagnosis']);

            $visitId = $this->extractId($this->getField($data, 'id_vis'), 'id_vis');
            if (!$this->model->visitExists($visitId)) {
                throw new InvalidArgumentException('الزيارة المطلوبة غير موجودة.');
            }

            $diagnosis = $this->sanitizeText($this->getField($data, 'diagnosis'), 'diagnosis', 255);
            $this->model->updateFinalDiagnosis($visitId, $diagnosis);

            $this->success(null, 'تم حفظ التشخيص وإغلاق الزيارة');
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error('تعذر حفظ التشخيص النهائي حالياً.', 500);
        }
    }

    public function searchPatient($data): void
    {
        try {
            $query = $this->sanitizeText($this->getField($data, 'query', ''), 'query', 100, true);
            if (mb_strlen($query) < 2) {
                $this->success([]);
                return;
            }

            $results = $this->model->searchPatient($query);
            $this->success($results);
        } catch (Throwable $exception) {
            $this->error('تعذر تنفيذ البحث حالياً.', 500);
        }
    }

    public function getSentOrders(): void
    {
        try {
            $visits = $this->model->getSentOrders($this->doctor_id);
            $result = [];

            foreach ($visits as $visit) {
                $result[] = [
                    'visit' => 'VIS-' . $visit['visit_id'],
                    'name' => $visit['name'],
                    'type_case' => $visit['type_case'],
                    'order_count' => $visit['order_count'],
                    'details' => $this->model->getOrderDetails((int) $visit['visit_id']),
                ];
            }

            $this->success($result);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب الطلبات المرسلة حالياً.', 500);
        }
    }

    public function getServicesList(): void
    {
        try {
            $services = $this->model->getAvailableServices();
            $grouped = ['lab' => [], 'ray' => [], 'sur' => []];

            foreach ($services as $service) {
                $item = [
                    'id' => $service['service_id'],
                    'name' => $service['service_name'],
                ];

                $department = mb_strtolower((string) $service['department']);
                if (str_contains($department, 'laboratory') || str_contains($department, 'مختبر')) {
                    $grouped['lab'][] = $item;
                } elseif (str_contains($department, 'radiology') || str_contains($department, 'أشعة')) {
                    $grouped['ray'][] = $item;
                } elseif (str_contains($department, 'nursing') || str_contains($department, 'تمريض')) {
                    $grouped['sur'][] = $item;
                }
            }

            $this->success($grouped);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب قائمة الخدمات حالياً.', 500);
        }
    }

    public function sendOrders($data): void
    {
        try {
            $this->requireFields($data, ['id_vis', 'order']);

            $visitId = $this->extractId($this->getField($data, 'id_vis'), 'id_vis');
            if (!$this->model->visitExists($visitId)) {
                throw new InvalidArgumentException('الزيارة المطلوبة غير موجودة.');
            }

            $orderPayload = $this->getField($data, 'order');
            $labOrders = (is_object($orderPayload) && isset($orderPayload->lab) && is_array($orderPayload->lab)) ? $orderPayload->lab : [];
            $rayOrders = (is_object($orderPayload) && isset($orderPayload->ray) && is_array($orderPayload->ray)) ? $orderPayload->ray : [];
            $surOrders = (is_object($orderPayload) && isset($orderPayload->sur) && is_array($orderPayload->sur)) ? $orderPayload->sur : [];

            $allOrderIds = array_values(array_unique(array_map(
                'intval',
                array_filter(array_merge($labOrders, $rayOrders, $surOrders), static fn ($value) => is_numeric($value) && (int) $value > 0)
            )));

            if (empty($allOrderIds)) {
                throw new InvalidArgumentException('يجب اختيار خدمة واحدة على الأقل قبل إرسال الطلبات.');
            }

            $this->conn->beginTransaction();
            $invoiceId = $this->model->createPendingInvoice($visitId);
            $totalInvoicePrice = 0.0;

            foreach ($allOrderIds as $serviceId) {
                $service = $this->model->getServiceDetailsById($serviceId);
                if (!$service) {
                    throw new InvalidArgumentException('تم إرسال خدمة غير موجودة في قائمة الخدمات.');
                }

                $price = round((float) $service['total_price'], 2);
                $this->model->addInvoiceDetail($invoiceId, (int) $service['service_id'], $price);
                $totalInvoicePrice += $price;
            }

            if ($totalInvoicePrice <= 0) {
                throw new InvalidArgumentException('تعذر تكوين فاتورة صحيحة للطلبات المرسلة.');
            }

            $this->model->updateInvoiceTotal($invoiceId, $totalInvoicePrice);
            $this->conn->commit();

            $this->success(null, 'تم إرسال الطلبات وحفظها بنجاح');
        } catch (InvalidArgumentException $exception) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            $this->error('تعذر إرسال الطلبات حالياً.', 500);
        }
    }

    public function getMedicalArchive(): void
    {
        try {
            $patients = $this->model->getMedicalArchive();
            $result = [];

            foreach ($patients as $patient) {
                $medicalFile = $this->model->getPatientMedicalFile((int) $patient['patient_id']);
                foreach ($medicalFile as &$file) {
                    $file['procedures'] = $file['procedures'] ?: 'لا يوجد إجراءات';
                }

                $result[] = [
                    'id_pat' => $patient['patient_id'],
                    'name' => $patient['name'],
                    'visit_num' => $patient['visit_num'],
                    'last_visit_date' => $patient['last_visit_date'],
                    'medical_file' => $medicalFile,
                ];
            }

            $this->success($result);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب السجل الطبي حالياً.', 500);
        }
    }

    private function normalizeGender($value): string
    {
        $normalized = trim((string) $value);
        return $normalized === 'ذكر' ? 'Male' : 'Female';
    }

    private function mapDoctorError(Throwable $exception): string
    {
        $message = $exception->getMessage();

        if (str_contains($message, 'زيارة سابقة لا تزال نشطة')) {
            return 'لا يمكن فتح زيارة جديدة؛ المريض لديه زيارة نشطة حالياً.';
        }

        if (str_contains($message, 'unique_patient_identity')) {
            return 'هذا المريض مسجل مسبقاً بنفس الاسم والعنوان.';
        }

        return 'حدث خطأ أثناء معالجة طلب الطبيب.';
    }
}
