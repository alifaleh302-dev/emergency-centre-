<?php
declare(strict_types=1);
require_once __DIR__ . '/BaseController.php';


class AccountingController extends BaseController
{
    private PDO $conn;
    private AccountingModel $model;
    private int $cashier_id;

    public function __construct(int|string $cashier_id)
    {
        $database = new Database();
        $this->conn = $database->getConnection();
        $this->model = new AccountingModel($this->conn, $database->getDriver());
        $this->cashier_id = (int) $cashier_id;
    }

    public function getPendingInvoices(): void
    {
        try {
            $invoices = $this->model->getPendingInvoices();
            $result = [];

            foreach ($invoices as $invoice) {
                $result[] = [
                    'Invoice_id' => 'INV-' . $invoice['invoice_id'],
                    'name' => $invoice['name'],
                    'sum' => $invoice['sum'],
                    'time' => $invoice['time'],
                    'order' => $this->model->getInvoiceDetails((int) $invoice['invoice_id']),
                ];
            }

            $this->success($result);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب الفواتير المستحقة حالياً.', 500);
        }
    }

    public function getNextSerials(): void
    {
        try {
            $serials = $this->model->getNextSerials();
            $data = [];
            foreach ($serials as $serial) {
                $data[$serial['doc_name']] = $serial['next_serial'];
            }

            $this->success($data);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب الأرقام التسلسلية حالياً.', 500);
        }
    }

    public function payInvoice($data): void
    {
        try {
            $this->requireFields($data, ['Invoice_id', 'net_amount', 'exemption_value', 'doc_type']);

            $invoiceId = $this->extractId($this->getField($data, 'Invoice_id'), 'Invoice_id');
            $netAmount = $this->sanitizeAmount($this->getField($data, 'net_amount'), 'net_amount');
            $exemptionValue = $this->sanitizeAmount($this->getField($data, 'exemption_value'), 'exemption_value');
            $docType = $this->ensureAllowedValue($this->getField($data, 'doc_type'), ['A', 'B', 'C'], 'doc_type');

            $pendingInvoice = $this->model->getPendingInvoiceById($invoiceId);
            if (!$pendingInvoice) {
                throw new InvalidArgumentException('الفاتورة المطلوبة غير موجودة أو تم تحصيلها مسبقاً.');
            }

            $total = round((float) $pendingInvoice['total'], 2);
            $this->validatePaymentBreakdown($docType, $total, $netAmount, $exemptionValue);

            $result = $this->model->processPayment(
                $invoiceId,
                $netAmount,
                $exemptionValue,
                $docType,
                $this->cashier_id,
                false
            );

            // إشعار للطبيب بأن الفاتورة تم تحصيلها
            try {
                $notif = new NotificationModel($this->conn);
                $typeName = match($docType) { 'A' => 'كاش', 'B' => 'إعفاء جزئي', 'C' => 'إعفاء كلي', default => $docType };
                if ($docType === 'B' && isset($result['A'], $result['B'])) {
                    $msg = 'سند كاش رقم: ' . $result['A'] . ' + سند إعفاء رقم: ' . $result['B'];
                } else {
                    $singleSerial = $result[$docType] ?? array_values($result)[0] ?? null;
                    $msg = 'سند رقم: ' . $singleSerial;
                }
                $notif->create('طبيب عام', 'تم تحصيل فاتورة (' . $typeName . ')', $msg, 'invoice_paid', $invoiceId);
            } catch (Throwable $e) {}

            // توليد استجابة متوافقة مع الواجهة الأمامية:
            //   - serial_number يبقى لتوافق العملاء القدامى (للدفع الكامل/الإعفاء الكلي)
            //   - serials مصفوفة توضح جميع السندات المولدة (واحد أو اثنان في حالة الجزئي)
            $response = [
                'success' => true,
                'message' => 'تم السداد بنجاح',
                'serials' => array_intersect_key($result, array_flip(['A', 'B', 'C'])),
            ];
            if ($docType === 'B' && isset($result['A'], $result['B'])) {
                $response['serial_number'] = $result['A']; // رقم سند الكاش للعرض الرئيسي
                $response['cash_serial']      = $result['A'];
                $response['exempt_serial']    = $result['B'];
                $response['invoice_id_A']     = $result['invoice_id_A'] ?? null;
                $response['invoice_id_B']     = $result['invoice_id_B'] ?? null;
                $response['message']          = 'تم السداد بنجاح — توليد سندين: كاش (A) + إعفاء (B) مترابطين';
            } else {
                $response['serial_number'] = $result[$docType] ?? array_values($result)[0] ?? null;
            }
            $this->respond($response);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (ShiftOrderViolationException $exception) {
            $this->error($exception->getMessage(), 409, [
                'code' => 'shift_order_violation',
                'blocking' => $exception->getDetails(),
            ]);
        } catch (Throwable $exception) {
            error_log('accounting/pay_invoice: ' . $exception->getMessage());
            $this->error('تعذر تنفيذ عملية السداد حالياً.', 500);
        }
    }

    public function checkPreviousShift(): void
    {
        try {
            $invoiceId = isset($_GET['invoice_id']) ? $this->extractId($_GET['invoice_id'], 'invoice_id') : 0;
            if ($invoiceId <= 0) {
                throw new InvalidArgumentException('رقم الفاتورة غير صالح.');
            }

            $blocker = $this->model->findBlockingPreviousShift($invoiceId);
            $this->success([
                'blocked' => $blocker !== null,
                'blocking' => $blocker,
            ]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            error_log('accounting/check_previous_shift: ' . $exception->getMessage());
            $this->error('تعذر التحقق من الفترة السابقة حالياً.', 500);
        }
    }

    public function getDailyTreasury(): void
    {
        try {
            $receipts = $this->model->getDailyReceipts();
            $stats = [
                'total_full_exemption' => 0.0,
                'count_full_exemption' => 0,
                'total_partial_exemption' => 0.0,
                'count_partial_exemption' => 0,
                'total_cash' => 0.0,
                'count_cash' => 0,
                'total_payments' => 0.0,
            ];

            $formattedReceipts = [];
            foreach ($receipts as $receipt) {
                $typeName = '';
                $docName = $receipt['doc_name'];
                $hasRelated = !empty($receipt['related_invoice_id']);
                $netAmount = (float) $receipt['net_amount'];
                $exemptVal = (float) $receipt['exemption_value'];

                if ($docName === 'A' && !$hasRelated) {
                    // سند كاش مستقل (دفع كامل)
                    $typeName = 'كاش';
                    $stats['total_cash'] += $netAmount;
                    $stats['count_cash']++;
                    $stats['total_payments'] += $netAmount;
                } elseif ($docName === 'A' && $hasRelated) {
                    // سند كاش مرتبط بإعفاء جزئي (الشق النقدي)
                    $typeName = 'كاش (إعفاء جزئي)';
                    $stats['total_partial_exemption'] += 0.0; // مبلغ الإعفاء يعدّ مع سند B
                    // لا نعدّه في count_partial_exemption حتى لا يكرر مع B
                    $stats['total_cash'] += $netAmount;
                    $stats['count_cash']++;
                    $stats['total_payments'] += $netAmount;
                } elseif ($docName === 'B' && $hasRelated) {
                    // سند إعفاء مرتبط بسند كاش (الشق المعفى) - النموذج الجديد
                    $typeName = 'إعفاء جزئي';
                    $stats['total_partial_exemption'] += $exemptVal;
                    $stats['count_partial_exemption']++;
                } elseif ($docName === 'C' || $netAmount === 0.0) {
                    // إعفاء كلي
                    $typeName = 'إعفاء كلي';
                    $stats['total_full_exemption'] += $exemptVal;
                    $stats['count_full_exemption']++;
                } elseif ($docName === 'B') {
                    // إعفاء جزئي بالنموذج القديم (سند واحد B فيه net + exemption) - للتوافق
                    $typeName = 'إعفاء جزئي (قديم)';
                    $stats['total_partial_exemption'] += $exemptVal;
                    $stats['count_partial_exemption']++;
                    $stats['total_cash'] += $netAmount;
                    $stats['total_payments'] += $netAmount;
                }

                $formattedReceipts[] = [
                    'Invoice_id' => $receipt['invoice_id'],
                    'name' => $receipt['name'],
                    'amount' => $docName === 'B' && $hasRelated ? $exemptVal : $netAmount,
                    'time' => $receipt['time'],
                    'cashier' => $receipt['cashier'],
                    'type' => $typeName,
                    'doc_name' => $docName,
                    'serial_number' => $receipt['serial_number'] ?? null,
                    'related_invoice_id' => $receipt['related_invoice_id'] ?? null,
                ];
            }

            $this->success([
                'receipts' => $formattedReceipts,
                'stats' => $stats,
            ]);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب بيانات الخزينة اليومية حالياً.', 500);
        }
    }

    public function getRevenuesDrilldown($data): void
    {
        try {
            $level = $this->sanitizeText($this->getField($data, 'level', 'years'), 'level', 20, true) ?: 'years';
            $filterValue = $this->sanitizeText($this->getField($data, 'filterValue', ''), 'filterValue', 20, true);
            $searchQuery = $this->sanitizeText($this->getField($data, 'query', ''), 'query', 100, true);

            if ($searchQuery !== '') {
                $invoices = $this->model->searchOrGetDailyDetails(null, $searchQuery);
                foreach ($invoices as &$invoice) {
                    $invoice['services'] = $this->model->getInvoiceDetails((int) $invoice['invoice_id']);
                }

                $this->respond([
                    'success' => true,
                    'level' => 'search',
                    'data' => $invoices,
                ]);
                return;
            }

            $result = match ($level) {
                'years' => $this->model->getRevenuesByYears(),
                'months' => $this->model->getRevenuesByMonths($filterValue),
                'days' => $this->resolveDailyRevenueData($filterValue),
                'details' => $this->attachInvoiceServices($this->model->searchOrGetDailyDetails($filterValue, null)),
                default => throw new InvalidArgumentException('مستوى التدرج المطلوب غير مدعوم.'),
            };

            $this->respond([
                'success' => true,
                'level' => $level,
                'data' => $result,
            ]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب التقرير المالي المطلوب حالياً.', 500);
        }
    }

    private function validatePaymentBreakdown(string $docType, float $total, float $netAmount, float $exemptionValue): void
    {
        $epsilon = 0.01;

        if (abs(round($netAmount + $exemptionValue, 2) - $total) > $epsilon) {
            throw new InvalidArgumentException('مجموع المدفوع والإعفاء يجب أن يساوي إجمالي الفاتورة.');
        }

        if ($docType === 'A' && (abs($exemptionValue) > $epsilon || abs($netAmount - $total) > $epsilon)) {
            throw new InvalidArgumentException('سند الكاش يجب أن يحتوي على دفع كامل بدون إعفاء.');
        }

        if ($docType === 'B' && ($netAmount <= 0.0 || $exemptionValue <= 0.0)) {
            throw new InvalidArgumentException('الإعفاء الجزئي يتطلب مبلغاً مدفوعاً ومبلغ إعفاء أكبر من صفر.');
        }

        if ($docType === 'C' && (abs($netAmount) > $epsilon || abs($exemptionValue - $total) > $epsilon)) {
            throw new InvalidArgumentException('الإعفاء الكلي يجب أن يغطي كامل إجمالي الفاتورة.');
        }
    }

    private function resolveDailyRevenueData(string $filterValue): array
    {
        if (!preg_match('/^\d{4}-\d{2}$/', $filterValue)) {
            throw new InvalidArgumentException('صيغة filterValue لمستوى الأيام يجب أن تكون YYYY-MM.');
        }

        [$year, $month] = explode('-', $filterValue);
        return $this->model->getRevenuesByDays($year, $month);
    }

    private function attachInvoiceServices(array $invoices): array
    {
        foreach ($invoices as &$invoice) {
            $invoice['services'] = $this->model->getInvoiceDetails((int) $invoice['invoice_id']);
        }

        return $invoices;
    }

    // =====================================================================
    // 🆕 واجهة "اليومية" + إقفال الفترة (Daily Journal + Shift Closure)
    // =====================================================================

    /**
     * GET /api/accounting/daily_journal?date=YYYY-MM-DD&department_id=N
     *
     * يجلب بيانات جدول اليومية:
     *   - سندات A أولاً (مجموعة مدفوعة)
     *   - فاصل بصري (يتم إضافته في الواجهة بين المجموعتين)
     *   - سندات B/C ثانياً (إعفاءات)
     *   - صفوف إجماليات التذاكر للفترتين (صباحي/مسائي) مع زر إقفال
     */
    public function getDailyJournal(): void
    {
        try {
            $date = isset($_GET['date']) ? trim((string) $_GET['date']) : '';
            $deptId = isset($_GET['department_id']) ? (int) $_GET['department_id'] : 0;

            // تحقق بسيط من صيغة التاريخ
            if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                throw new InvalidArgumentException('صيغة التاريخ غير صالحة (استخدم YYYY-MM-DD).');
            }

            $rows = $this->model->getDailyJournal($date ?: null, $deptId > 0 ? $deptId : null);

            // بناء صفوف الجدول
            $invoiceRows = [];
            foreach ($rows as $row) {
                $docName = (string) $row['doc_name'];
                $hasRelated = !empty($row['related_invoice_id']);

                // تحديد نوع السند عربياً
                if ($docName === 'A' && !$hasRelated) {
                    $typeLabel = 'دفع كامل (A)';
                    $amount = (float) $row['net_amount'];
                } elseif ($docName === 'A' && $hasRelated) {
                    $typeLabel = 'دفع جزئي (A)';
                    $amount = (float) $row['net_amount'];
                } elseif ($docName === 'B' && $hasRelated) {
                    $typeLabel = 'إعفاء جزئي (B)';
                    $amount = (float) $row['exemption_value'];
                } elseif ($docName === 'C') {
                    $typeLabel = 'إعفاء كلي (C)';
                    $amount = (float) $row['exemption_value'];
                } else {
                    $typeLabel = $docName;
                    $amount = (float) $row['net_amount'];
                }

                $invoiceRows[] = [
                    'invoice_id'      => (int) $row['invoice_id'],
                    'serial_number'   => (int) $row['serial_number'],
                    'doc_name'        => $docName,
                    'type_label'      => $typeLabel,
                    'group_order'     => (int) $row['group_order'], // 0 = A, 1 = B/C
                    'patient_name'    => (string) $row['patient_name'],
                    'department_id'   => $row['department_id'] !== null ? (int) $row['department_id'] : null,
                    'department_name' => (string) $row['department_name'],
                    'department_code' => (string) $row['department_code'],
                    'amount'          => $amount,
                    'total'           => (float) $row['total'],
                    'exemption_value' => (float) $row['exemption_value'],
                    'net_amount'      => (float) $row['net_amount'],
                    'cashier'         => (string) $row['cashier'],
                    'time'            => (string) $row['time'],
                ];
            }

            // جلب إجماليات التذاكر للفترتين (فقط غير المُقفلة)
            $morning = $this->model->getShiftTicketsSummary('morning', $date ?: null);
            $evening = $this->model->getShiftTicketsSummary('evening', $date ?: null);
            $settings = $this->model->getTicketShareSettings();

            $buildShiftRow = function (?array $summary, string $type) use ($settings): ?array {
                if ($summary === null) return null;
                $count = (int) $summary['tickets_count'];
                $totalAmount = (float) $summary['total_amount'];
                $ministryPerTicket = $type === 'morning'
                    ? (float) ($settings['ticket_ministry_share_morning'] ?? 0.0)
                    : (float) ($settings['ticket_ministry_share_evening'] ?? 0.0);
                $ministryShare = round($ministryPerTicket * $count, 2);
                $centerShare = max(0.0, $totalAmount - $ministryShare);
                return [
                    'shift_type'     => $type,
                    'shift_label'    => $type === 'morning' ? 'صباحي' : 'مسائي',
                    'start_no'       => (int) $summary['start_no'],
                    'end_no'         => (int) $summary['end_no'],
                    'tickets_count'  => $count,
                    'total_amount'   => $totalAmount,
                    'center_share'   => $centerShare,
                    'ministry_share' => $ministryShare,
                ];
            };

            $shiftRows = array_values(array_filter([
                $buildShiftRow($morning, 'morning'),
                $buildShiftRow($evening, 'evening'),
            ]));

            // جلب إقفالات اليوم (لعرضها كـ السجلات المئوية المُنجزة)
            $closures = $this->model->getShiftClosuresForDate($date ?: null);

            $this->success([
                'date'         => $date ?: date('Y-m-d'),
                'invoices'     => $invoiceRows,
                'shift_totals' => $shiftRows,    // فترات مفتوحة تحتاج إقفال
                'closures'     => $closures,     // إقفالات سابقة في نفس اليوم
            ]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب بيانات اليومية حالياً.', 500);
        }
    }

    /**
     * GET /api/accounting/invoice_services?invoice_id=N
     * يجلب تفاصيل خدمات سند للعرض داخل Modal "التفاصيل".
     */
    public function getInvoiceServices(): void
    {
        try {
            $invoiceId = isset($_GET['invoice_id']) ? (int) $_GET['invoice_id'] : 0;
            if ($invoiceId <= 0) {
                throw new InvalidArgumentException('رقم السند غير صالح.');
            }
            $services = $this->model->getInvoiceServiceDetails($invoiceId);
            $this->success(['services' => $services]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error('تعذر جلب تفاصيل السند حالياً.', 500);
        }
    }

    /**
     * POST /api/accounting/close_shift
     * body: { shift_type: 'morning'|'evening', date?: 'YYYY-MM-DD' }
     *
     * يُجري إقفال الفترة (Lock Period) بشكل ذرّي:
     *   1) تجميع كل تذاكر الفترة غير المُقفلة
     *   2) توليد سجل shifts_closures + سند A إجمالي
     *   3) ربط التذاكر بالإقفال (يمنع إعادة الإقفال)
     */
    public function closeShift($data): void
    {
        try {
            $shiftType = isset($data->shift_type) ? trim((string) $data->shift_type) : '';
            $date = isset($data->date) ? trim((string) $data->date) : '';

            if (!in_array($shiftType, ['morning', 'evening'], true)) {
                throw new InvalidArgumentException('نوع الفترة غير صالح (يجب أن يكون morning أو evening).');
            }
            if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                throw new InvalidArgumentException('صيغة التاريخ غير صالحة.');
            }

            $result = $this->model->closeShift($shiftType, $this->cashier_id, $date ?: null);

            // إشعار للمدير / لوحة التحكم (اختياري)
            try {
                $notif = new NotificationModel($this->conn);
                $shiftLabel = $shiftType === 'morning' ? 'الصباحية' : 'المسائية';
                $notif->create(
                    'مدير',
                    'تم إقفال الفترة ' . $shiftLabel,
                    'rate ' . $result['tickets_count'] . ' تذكرة - إجمالي ' . $result['total_amount'] . ' ريال - سند ' . $result['serial_number'],
                    'shift_closure',
                    (int) $result['invoice_id']
                );
            } catch (Throwable $e) {
                // لا نوقف العملية
            }

            $this->success($result, 'تم إقفال الفترة بنجاح وتوليد سند A برقم ' . $result['serial_number']);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage(), 409);
        } catch (Throwable $exception) {
            $this->error('تعذر إقفال الفترة حالياً.', 500);
        }
    }
}
