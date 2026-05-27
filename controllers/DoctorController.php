<?php
declare(strict_types=1);
require_once __DIR__ . '/BaseController.php';
class DoctorController extends BaseController
{
    private PDO $conn;
    private DoctorModel $model;
    private int $doctor_id;
    private string $driver;

    public function __construct(string $doctor_id)
    {
        $database = new Database();
        $this->conn = $database->getConnection();
        $this->driver = $database->getDriver();
        $this->model = new DoctorModel($this->conn, $this->driver);
        // doctor_id يصلنا كنص من الـ JWT لذا نحوّله إلى int ليطابق توقيعات الـ DoctorModel
        // (الذي يتوقع int مع تفعيل strict_types، وإلا سيُرفع TypeError ويظهر للمستخدم
        // الرسالة العامة "حدث خطأ أثناء معالجة طلب الطبيب").
        $normalized = (int) preg_replace('/\D+/', '', $doctor_id);
        if ($normalized <= 0) {
            throw new InvalidArgumentException('معرّف الطبيب غير صالح.');
        }
        $this->doctor_id = $normalized;
    }

    /**
     * يجلب الاسم الكامل للطبيب الحالي من جدول users لاستخدامه في إغلاق
     * الزيارة (حفظ تاريخي) + في نموذج الطباعة.
     */
    private function fetchDoctorFullName(): string
    {
        $stmt = $this->conn->prepare('SELECT full_name FROM users WHERE user_id = :uid LIMIT 1');
        $stmt->execute([':uid' => $this->doctor_id]);
        $name = $stmt->fetchColumn();
        return $name ? (string) $name : '';
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
            $visitId   = $this->model->createVisit($patientId, $this->doctor_id, $caseTypeId, $diagnosis, $note, $typeCase);

            // إصدار تلقائي لتذكرة معاينة (صباحية/مسائية + تسعير افتراضي من system_settings)
            $ticketModel = new ExaminationTicketModel($this->conn, $this->driver);
            $ticket = $ticketModel->autoIssue($visitId, $note);
            $this->conn->commit();

            $this->success([
                'visit_id'      => $visitId,
                'patient_id'    => $patientId,
                'ticket'        => $ticket,
            ], 'تم تسجيل المريض وفتح الزيارة وإصدار تذكرة T-' . $ticket['serial_number']);
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

            // تحقق مسبق من وجود زيارة نشطة لإظهار رسالة عربية واضحة
            // قبل الاصطدام بقيد uq_visits_one_active_per_patient.
            if ($this->model->hasActiveVisit($patientId)) {
                throw new InvalidArgumentException('لا يمكن فتح زيارة جديدة؛ يوجد لدى المريض زيارة مفتوحة حالياً. يرجى إغلاق الزيارة السابقة أولاً.');
            }

            $typeCase = $this->sanitizeText($this->getField($data, 'type_case'), 'type_case', 100);
            $diagnosis = $this->sanitizeText($this->getField($data, 'diagnosis', ''), 'diagnosis', 255, true);
            $note = $this->sanitizeText($this->getField($data, 'note', ''), 'note', 500, true);
            $caseTypeId = $this->model->getCaseTypeId($typeCase) ?? 1;

            $this->conn->beginTransaction();
            $visitId = $this->model->createVisit($patientId, $this->doctor_id, $caseTypeId, $diagnosis, $note, $typeCase);

            // إصدار تلقائي لتذكرة المعاينة
            $ticketModel = new ExaminationTicketModel($this->conn, $this->driver);
            $ticket = $ticketModel->autoIssue($visitId, $note);
            $this->conn->commit();

            $this->success([
                'visit_id' => $visitId,
                'ticket'   => $ticket,
            ], 'تم فتح الزيارة وإصدار تذكرة T-' . $ticket['serial_number']);
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

    /**
     * إغلاق الزيارة (النسخة الجديدة المتوافقة مع نموذج "تذكرة معاينة"):
     *   - diagnosis  (إجباري) التشخيص النهائي
     *   - final_notes (إجباري) ملاحظات الطبيب
     *   - clinic     (اختياري) اسم العيادة
     */
    public function finalDiagnosis($data): void
    {
        try {
            $this->requireFields($data, ['id_vis', 'diagnosis', 'final_notes']);

            $visitId = $this->extractId($this->getField($data, 'id_vis'), 'id_vis');
            if (!$this->model->visitExists($visitId)) {
                throw new InvalidArgumentException('الزيارة المطلوبة غير موجودة.');
            }
            if (!$this->model->visitBelongsToDoctor($visitId, $this->doctor_id)) {
                throw new InvalidArgumentException('لا يمكنك تعديل زيارة لا تتبع حساب الطبيب الحالي.');
            }

            $diagnosis  = $this->sanitizeText($this->getField($data, 'diagnosis'),   'diagnosis',   255);
            $finalNotes = $this->sanitizeText($this->getField($data, 'final_notes'), 'final_notes', 1500);
            $clinic     = $this->sanitizeText($this->getField($data, 'clinic', ''),  'clinic',      150, true);
            $doctorName = $this->fetchDoctorFullName();

            $this->model->closeVisit(
                $visitId,
                $diagnosis,
                $finalNotes,
                $clinic !== '' ? $clinic : null,
                $this->doctor_id,
                $doctorName
            );

            $this->success(null, 'تم حفظ التشخيص وإغلاق الزيارة بنجاح');
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error('تعذر حفظ التشخيص النهائي حالياً.', 500);
        }
    }

    /**
     * Endpoint جديد: يرجع بيانات نموذج إغلاق الزيارة
     * (بيانات المريض + اسم الطبيب الحالي + إعدادات الترويسة).
     */
    public function getVisitCloseData($data): void
    {
        try {
            $this->requireFields($data, ['id_vis']);
            $visitId = $this->extractId($this->getField($data, 'id_vis'), 'id_vis');

            if (!$this->model->visitBelongsToDoctor($visitId, $this->doctor_id)) {
                throw new InvalidArgumentException('لا يمكنك فتح زيارة لا تتبع حسابك.');
            }

            $payload = $this->model->getVisitCloseData($visitId);
            if (!$payload) {
                throw new InvalidArgumentException('الزيارة غير موجودة.');
            }

            // ✅ Self-healing: إن لم تكن للزيارة تذكرة (زيارات قديمة قبل التحديث،
            // أو حالات شذوذ سابقة)، نُصدر تذكرة تلقائياً الآن لضمان ظهور رقم التذكرة
            // في النموذج وفي السجل الطبي لاحقاً. القيد UNIQUE على visit_id
            // يمنع التكرار في حالات السباق.
            if (empty($payload['ticket_serial'])) {
                try {
                    $ticketModel = new ExaminationTicketModel($this->conn, $this->driver);
                    if (!$ticketModel->hasTicket($visitId)) {
                        $initialNotes = (string) ($payload['initial_notes'] ?? '');
                        $issued = $ticketModel->autoIssue($visitId, $initialNotes);
                        $payload['ticket_serial'] = $issued['serial_number'];
                        $payload['ticket_type']   = $issued['ticket_type'];
                        $payload['ticket_amount'] = $issued['amount'];
                    } else {
                        // وُجدت تذكرة بعد إعادة التحقق - أعد التحميل
                        $existing = $ticketModel->getByVisitId($visitId);
                        if ($existing) {
                            $payload['ticket_serial'] = $existing['serial_number'];
                            $payload['ticket_type']   = $existing['ticket_type'];
                            $payload['ticket_amount'] = $existing['amount'];
                        }
                    }
                } catch (Throwable $issueExc) {
                    // لا نُفشل النموذج كاملاً بسبب فشل إصدار التذكرة - نكتفي بترك الحقول فارغة
                    error_log('[getVisitCloseData] auto-issue ticket failed for visit ' . $visitId . ': ' . $issueExc->getMessage());
                }
            }

            // إضافة اسم الطبيب المعالج + إعدادات الترويسة لتغني العميل عن طلب إضافي
            $payload['attending_doctor'] = $this->fetchDoctorFullName();
            $payload['gender_ar']        = ($payload['gender'] === 'Male') ? 'ذكر' : 'أنثى';
            $payload['address']          = trim(((string) ($payload['place1'] ?? '')) . ' / ' . ((string) ($payload['place2'] ?? '')), ' /');
            $payload['header']           = (new SettingsService($this->conn))->getHeader();

            $this->success($payload);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب بيانات إغلاق الزيارة.', 500);
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
            $departments = [];

            foreach ($services as $service) {
                $departmentId = isset($service['department_id']) ? (int) $service['department_id'] : 0;
                if ($departmentId <= 0) {
                    continue;
                }

                if (!isset($departments[$departmentId])) {
                    $departments[$departmentId] = [
                        'id' => $departmentId,
                        'name' => $service['department_name'] ?? 'قسم غير محدد',
                        'code' => $service['department_code'] ?? ('dept_' . $departmentId),
                        'services' => [],
                    ];
                }

                if (!empty($service['service_id'])) {
                    $departments[$departmentId]['services'][] = [
                        'id' => (int) $service['service_id'],
                        'name' => $service['service_name'],
                    ];
                }
            }

            $this->success(array_values($departments));
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
            if (!$this->model->visitBelongsToDoctor($visitId, $this->doctor_id)) {
                throw new InvalidArgumentException('لا يمكنك إرسال طلبات لزيارة لا تتبع حساب الطبيب الحالي.');
            }

            $orderPayload = $this->getField($data, 'order');
            $orderGroups = [];
            if (is_object($orderPayload)) {
                foreach (get_object_vars($orderPayload) as $groupItems) {
                    if (is_array($groupItems)) {
                        $orderGroups[] = $groupItems;
                    }
                }
            } elseif (is_array($orderPayload)) {
                foreach ($orderPayload as $groupItems) {
                    if (is_array($groupItems)) {
                        $orderGroups[] = $groupItems;
                    }
                }
            }

            $flattenedOrders = [];
            foreach ($orderGroups as $groupItems) {
                $flattenedOrders = array_merge($flattenedOrders, $groupItems);
            }

            $allOrderIds = array_values(array_unique(array_map(
                'intval',
                array_filter($flattenedOrders, static fn ($value) => is_numeric($value) && (int) $value > 0)
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

            // إشعار للمحاسب بوجود فاتورة جديدة
            try {
                $notif = new NotificationModel($this->conn);
                $notif->create('أمين صندوق', 'فاتورة جديدة بانتظار التحصيل', 'إجمالي: ' . $totalInvoicePrice . ' ريال', 'new_invoice', $invoiceId);
            } catch (Throwable $e) {} // لا نوقف العملية بسبب الإشعار

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

    /**
     * ملحوظة: بعد إعادة الهيكلة الجديدة لنظام التذاكر، لم تعد هنالك حاجة
     * لإنشاء تذكرة يدوياً. التذكرة تُصدر آلياً عند فتح الزيارة.
     * تُترك هذه الدالة كتوأمة أمان لتلفّ أيّ عميل قديم ثم تُعجّل بخطأ واضح.
     */
    public function createTicket($data): void
    {
        $this->error('تم استبدال إصدار التذاكر اليدوي، وأصبح تلقائياً عند فتح الزيارة.', 410);
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

        // PostgreSQL: انتهاك قيد uq_visits_one_active_per_patient
        if (
            str_contains($message, 'uq_visits_one_active_per_patient') ||
            str_contains($message, 'زيارة سابقة لا تزال نشطة')
        ) {
            return 'لا يمكن فتح زيارة جديدة؛ يوجد لدى المريض زيارة مفتوحة حالياً. يرجى إغلاق الزيارة السابقة أولاً.';
        }

        if (str_contains($message, 'unique_patient_identity')) {
            return 'هذا المريض مسجل مسبقاً بنفس الاسم والعنوان.';
        }

        return 'حدث خطأ أثناء معالجة طلب الطبيب.';
    }
}
