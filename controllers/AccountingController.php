<?php
declare(strict_types=1);
require_once __DIR__ . '/BaseController.php';


class AccountingController extends BaseController
{
    private PDO $conn;
    private AccountingModel $model;
    private int $cashier_id;

    public function __construct(int $cashier_id)
    {
        $database = new Database();
        $this->conn = $database->getConnection();
        $this->model = new AccountingModel($this->conn, $database->getDriver());
        $this->cashier_id = $cashier_id;
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

            $serialNumber = $this->model->processPayment(
                $invoiceId,
                $netAmount,
                $exemptionValue,
                $docType,
                $this->cashier_id
            );

            $this->respond([
                'success' => true,
                'message' => 'تم السداد بنجاح',
                'serial_number' => $serialNumber,
            ]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            $this->error('تعذر تنفيذ عملية السداد حالياً.', 500);
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

                if ($receipt['doc_name'] === 'A') {
                    $typeName = 'كاش';
                    $stats['total_cash'] += (float) $receipt['net_amount'];
                    $stats['count_cash']++;
                    $stats['total_payments'] += (float) $receipt['net_amount'];
                } elseif ($receipt['doc_name'] === 'C' || (float) $receipt['net_amount'] === 0.0) {
                    $typeName = 'إعفاء كلي';
                    $stats['total_full_exemption'] += (float) $receipt['exemption_value'];
                    $stats['count_full_exemption']++;
                } else {
                    $typeName = 'إعفاء جزئي';
                    $stats['total_partial_exemption'] += (float) $receipt['exemption_value'];
                    $stats['count_partial_exemption']++;
                    $stats['total_payments'] += (float) $receipt['net_amount'];
                }

                $formattedReceipts[] = [
                    'Invoice_id' => $receipt['invoice_id'],
                    'name' => $receipt['name'],
                    'amount' => $receipt['net_amount'],
                    'time' => $receipt['time'],
                    'cashier' => $receipt['cashier'],
                    'type' => $typeName,
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
}
