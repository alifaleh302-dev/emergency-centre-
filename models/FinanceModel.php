<?php
declare(strict_types=1);

/**
 * ============================================================================
 * FinanceModel — قلب المركز المالي والسندي الشامل
 * ============================================================================
 *
 * هذا الموديل هو محرك "دفتر الحركات الموحّد" (Unified Ledger) الذي يجمع
 * كل أنواع الحركات المالية في النظام تحت مظلة استعلام واحد:
 *
 *   • فواتير الكاش      (A) — invoices + doc_type_id = A
 *   • فواتير الإعفاء الجزئي (B) — invoices + doc_type_id = B
 *   • فواتير الإعفاء الكلي  (C) — invoices + doc_type_id = C
 *   • تذاكر المعاينة       (T) — examination_tickets (إيراد مستقل!)
 *
 * يُقدّم كل حركة في نموذج Unified Transaction Schema الموحّد (22 حقلاً)
 * بصرف النظر عن مصدرها، مما يسمح للواجهة بفلترة وفرز وتجميع كل الحركات
 * كقائمة واحدة منسجمة.
 *
 * المسؤوليات:
 *   1. بناء استعلام UNION ALL ديناميكي مع فلاتر آمنة (parametrized).
 *   2. حساب KPIs ومجاميع الفترات الزمنية.
 *   3. تقديم بيانات الرسوم البيانية (4 charts).
 *   4. تفاصيل حركة منفردة (للـ drawer + الطباعة).
 *   5. تقرير حصة الوزارة التفصيلي.
 *   6. خيارات الفلاتر الديناميكية (dropdowns).
 *
 * كل حصص الوزارة:
 *   - للفواتير: تُحسب من invoice_details.ministry_share_at_time (موجودة).
 *   - للتذاكر: تُقرأ من system_settings (مفاتيح ticket_ministry_share_*).
 * ============================================================================
 */
class FinanceModel
{
    private PDO $conn;
    private string $driver;

    /** ذاكرة محلية لحصص الوزارة للتذاكر (تجنّب استعلام متكرر) */
    private ?float $ticketMinistryMorning = null;
    private ?float $ticketMinistryEvening = null;

    public function __construct(PDO $db, string $driver = 'pgsql')
    {
        $this->conn = $db;
        $this->driver = $driver;
    }

    // ========================================================================
    //   تحميل الإعدادات الديناميكية
    // ========================================================================

    /**
     * يحمّل حصص الوزارة للتذاكر من system_settings مرة واحدة لكل instance.
     * إن لم توجد المفاتيح يستخدم قيم افتراضية (30 / 100).
     */
    private function loadTicketMinistryShares(): void
    {
        if ($this->ticketMinistryMorning !== null && $this->ticketMinistryEvening !== null) {
            return; // مُحمّل مسبقاً
        }

        $sql = "SELECT setting_key, setting_value FROM system_settings
                WHERE setting_key IN ('ticket_ministry_share_morning', 'ticket_ministry_share_evening')";
        $stmt = $this->conn->query($sql);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $defaults = ['ticket_ministry_share_morning' => 30.0, 'ticket_ministry_share_evening' => 100.0];
        foreach ($rows as $row) {
            $defaults[$row['setting_key']] = (float) $row['setting_value'];
        }

        $this->ticketMinistryMorning = $defaults['ticket_ministry_share_morning'];
        $this->ticketMinistryEvening = $defaults['ticket_ministry_share_evening'];
    }

    public function getTicketMinistryShares(): array
    {
        $this->loadTicketMinistryShares();
        return [
            'morning' => $this->ticketMinistryMorning,
            'evening' => $this->ticketMinistryEvening,
        ];
    }

    // ========================================================================
    //   1. الـ Unified Ledger Query (قلب النظام)
    // ========================================================================

    /**
     * يبني SQL الـ UNION ALL لدفتر الحركات الموحّد.
     * يُعيد جملة SQL كنص + paramters المطلوبة للحقن الديناميكي.
     *
     * @return array { sql: string, params: array }
     */
    private function hasLineScopedFilters(array $filters): bool
    {
        return !empty($filters['service_ids'])
            || !empty($filters['category_ids'])
            || !empty($filters['department_ids']);
    }

    private function buildDetailScopeClause(array $filters, string $detailAlias = 'id', string $serviceAlias = 'sm', string $categoryAlias = 'sc'): array
    {
        $conditions = [];
        $params = [];

        if (!empty($filters['service_ids']) && is_array($filters['service_ids'])) {
            $ids = array_values(array_filter(array_map('intval', $filters['service_ids']), fn($v) => $v > 0));
            if (!empty($ids)) {
                $placeholders = [];
                foreach ($ids as $i => $id) {
                    $key = ":flt_srv_scope_$i";
                    $placeholders[] = $key;
                    $params[$key] = $id;
                }
                $conditions[] = "{$detailAlias}.service_id IN (" . implode(',', $placeholders) . ")";
            }
        }

        if (!empty($filters['category_ids']) && is_array($filters['category_ids'])) {
            $ids = array_values(array_filter(array_map('intval', $filters['category_ids']), fn($v) => $v > 0));
            if (!empty($ids)) {
                $placeholders = [];
                foreach ($ids as $i => $id) {
                    $key = ":flt_cat_scope_$i";
                    $placeholders[] = $key;
                    $params[$key] = $id;
                }
                $conditions[] = "{$serviceAlias}.category_id IN (" . implode(',', $placeholders) . ")";
            }
        }

        if (!empty($filters['department_ids']) && is_array($filters['department_ids'])) {
            $ids = array_values(array_filter(array_map('intval', $filters['department_ids']), fn($v) => $v > 0));
            if (!empty($ids)) {
                $placeholders = [];
                foreach ($ids as $i => $id) {
                    $key = ":flt_dep_scope_$i";
                    $placeholders[] = $key;
                    $params[$key] = $id;
                }
                $conditions[] = "{$categoryAlias}.department_id IN (" . implode(',', $placeholders) . ")";
            }
        }

        return [
            'sql' => empty($conditions) ? '' : ' AND ' . implode(' AND ', $conditions),
            'params' => $params,
        ];
    }

    private function buildInvoiceReportFilters(
        array $filters,
        string $invoiceAlias = 'i',
        string $visitAlias = 'v',
        string $patientAlias = 'p',
        string $detailAlias = 'id',
        string $serviceAlias = 'sm',
        string $categoryAlias = 'sc',
        string $documentAlias = 'dt'
    ): array {
        $conditions = [
            "{$invoiceAlias}.doc_type_id IS NOT NULL",
            "{$invoiceAlias}.cancelled_at IS NULL",
        ];
        $params = [];

        if (!empty($filters['from'])) {
            $conditions[] = "COALESCE({$invoiceAlias}.paid_at, {$invoiceAlias}.created_at) >= :inv_from";
            $params[':inv_from'] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $conditions[] = "COALESCE({$invoiceAlias}.paid_at, {$invoiceAlias}.created_at) <= :inv_to";
            $params[':inv_to'] = $filters['to'];
        }

        if (!empty($filters['doc_codes']) && is_array($filters['doc_codes'])) {
            $codes = array_values(array_filter($filters['doc_codes'], fn($c) => in_array($c, ['A', 'B', 'C'], true)));
            if (empty($codes)) {
                $conditions[] = '1 = 0';
            } else {
                $placeholders = [];
                foreach ($codes as $i => $code) {
                    $key = ":inv_doc_$i";
                    $placeholders[] = $key;
                    $params[$key] = $code;
                }
                $conditions[] = "{$documentAlias}.doc_name IN (" . implode(',', $placeholders) . ")";
            }
        }

        if (!empty($filters['statuses']) && is_array($filters['statuses'])) {
            $statuses = array_values(array_filter($filters['statuses'], fn($s) => in_array($s, ['paid', 'issued', 'cancelled'], true)));
            if (!empty($statuses) && !in_array('paid', $statuses, true)) {
                $conditions[] = '1 = 0';
            }
        }

        if (!empty($filters['accountant_ids']) && is_array($filters['accountant_ids'])) {
            $ids = array_values(array_filter(array_map('intval', $filters['accountant_ids']), fn($v) => $v > 0));
            if (!empty($ids)) {
                $placeholders = [];
                foreach ($ids as $i => $id) {
                    $key = ":inv_acc_$i";
                    $placeholders[] = $key;
                    $params[$key] = $id;
                }
                $conditions[] = "{$invoiceAlias}.accountant_id IN (" . implode(',', $placeholders) . ")";
            }
        }

        if (!empty($filters['doctor_ids']) && is_array($filters['doctor_ids'])) {
            $ids = array_values(array_filter(array_map('intval', $filters['doctor_ids']), fn($v) => $v > 0));
            if (!empty($ids)) {
                $placeholders = [];
                foreach ($ids as $i => $id) {
                    $key = ":inv_doc_id_$i";
                    $placeholders[] = $key;
                    $params[$key] = $id;
                }
                $conditions[] = "{$visitAlias}.doctor_id IN (" . implode(',', $placeholders) . ")";
            }
        }

        $detailScope = $this->buildDetailScopeClause($filters, $detailAlias, $serviceAlias, $categoryAlias);
        if ($detailScope['sql'] !== '') {
            $conditions[] = '1 = 1' . $detailScope['sql'];
            $params = array_merge($params, $detailScope['params']);
        }

        if (isset($filters['amount_min']) && is_numeric($filters['amount_min'])) {
            $conditions[] = "{$invoiceAlias}.total >= :inv_amount_min";
            $params[':inv_amount_min'] = (float) $filters['amount_min'];
        }
        if (isset($filters['amount_max']) && is_numeric($filters['amount_max'])) {
            $conditions[] = "{$invoiceAlias}.total <= :inv_amount_max";
            $params[':inv_amount_max'] = (float) $filters['amount_max'];
        }
        if (!empty($filters['has_ministry_share'])) {
            $conditions[] = "{$detailAlias}.ministry_share_at_time > 0";
        }

        if (!empty($filters['query'])) {
            $q = trim((string) $filters['query']);
            if ($q !== '') {
                $like = $this->driver === 'pgsql' ? 'ILIKE' : 'LIKE';
                $params[':inv_query1'] = '%' . $q . '%';
                $params[':inv_query2'] = '%' . $q . '%';
                $params[':inv_query3'] = '%' . $q . '%';
                $conditions[] = "({$patientAlias}.full_name {$like} :inv_query1 OR CAST({$invoiceAlias}.serial_number AS TEXT) {$like} :inv_query2 OR CAST({$invoiceAlias}.invoice_id AS TEXT) {$like} :inv_query3)";
            }
        }

        return [
            'where_sql' => 'WHERE ' . implode(' AND ', $conditions),
            'params' => $params,
        ];
    }

    /**
     * يبني SQL الـ UNION ALL لدفتر الحركات الموحّد.
     * يُعيد جملة SQL كنص + paramters المطلوبة للحقن الديناميكي.
     *
     * @return array{sql:string, params:array}
     */
    private function buildUnifiedLedgerSql(array $filters = []): array
    {
        $this->loadTicketMinistryShares();
        $hasLineScope = $this->hasLineScopedFilters($filters);

        if ($hasLineScope) {
            $detailScope = $this->buildDetailScopeClause($filters, 'sid', 'ssm', 'ssc');
            $scopedParams = $detailScope['params'];
            $detailScopeSql = $detailScope['sql'];

            $invoicesSql = "
                SELECT
                    'INV-' || i.invoice_id::TEXT          AS txn_id,
                    'invoices'                            AS source_table,
                    i.invoice_id                          AS source_id,
                    CASE dt.doc_name
                        WHEN 'A' THEN 'cash'
                        WHEN 'B' THEN 'partial_exempt'
                        WHEN 'C' THEN 'full_exempt'
                        ELSE 'other'
                    END                                   AS txn_type,
                    CASE dt.doc_name
                        WHEN 'A' THEN 'كاش'
                        WHEN 'B' THEN 'إعفاء جزئي'
                        WHEN 'C' THEN 'إعفاء كلي'
                        ELSE dt.doc_name
                    END                                   AS txn_type_label,
                    dt.doc_name                           AS doc_code,
                    i.serial_number                       AS serial_number,
                    p.patient_id                          AS patient_id,
                    p.full_name                           AS patient_name,
                    i.visit_id                            AS visit_id,
                    CASE
                        WHEN dt.doc_name = 'A' THEN (
                            COALESCE(
                                CASE
                                    WHEN COALESCE(all_totals.raw_ministry_total, 0) > 0
                                        THEN COALESCE(scoped.matched_raw_ministry, 0) / NULLIF(all_totals.raw_ministry_total, 0)
                                             * LEAST(COALESCE(all_totals.raw_ministry_total, 0), i.net_amount)
                                    ELSE 0
                                END,
                            0) +
                            COALESCE(
                                CASE
                                    WHEN COALESCE(all_totals.raw_center_total, 0) > 0
                                        THEN COALESCE(scoped.matched_raw_center, 0) / NULLIF(all_totals.raw_center_total, 0)
                                             * GREATEST(i.net_amount - LEAST(COALESCE(all_totals.raw_ministry_total, 0), i.net_amount), 0)
                                    ELSE 0
                                END,
                            0)
                        )
                        ELSE COALESCE(i.total * COALESCE(scoped.matched_gross_total, 0) / NULLIF(all_totals.gross_total, 0), 0)
                    END                                   AS total,
                    CASE
                        WHEN dt.doc_name = 'A' THEN (
                            COALESCE(
                                CASE
                                    WHEN COALESCE(all_totals.raw_ministry_total, 0) > 0
                                        THEN COALESCE(scoped.matched_raw_ministry, 0) / NULLIF(all_totals.raw_ministry_total, 0)
                                             * LEAST(COALESCE(all_totals.raw_ministry_total, 0), i.net_amount)
                                    ELSE 0
                                END,
                            0) +
                            COALESCE(
                                CASE
                                    WHEN COALESCE(all_totals.raw_center_total, 0) > 0
                                        THEN COALESCE(scoped.matched_raw_center, 0) / NULLIF(all_totals.raw_center_total, 0)
                                             * GREATEST(i.net_amount - LEAST(COALESCE(all_totals.raw_ministry_total, 0), i.net_amount), 0)
                                    ELSE 0
                                END,
                            0)
                        )
                        ELSE 0::NUMERIC
                    END                                   AS cash_amount,
                    CASE
                        WHEN dt.doc_name IN ('B', 'C')
                            THEN COALESCE(i.exemption_value * COALESCE(scoped.matched_gross_total, 0) / NULLIF(all_totals.gross_total, 0), 0)
                        ELSE 0::NUMERIC
                    END                                   AS exempt_amount,
                    CASE
                        WHEN dt.doc_name = 'A'
                            THEN COALESCE(
                                CASE
                                    WHEN COALESCE(all_totals.raw_center_total, 0) > 0
                                        THEN COALESCE(scoped.matched_raw_center, 0) / NULLIF(all_totals.raw_center_total, 0)
                                             * GREATEST(i.net_amount - LEAST(COALESCE(all_totals.raw_ministry_total, 0), i.net_amount), 0)
                                    ELSE 0
                                END,
                            0)
                        ELSE 0::NUMERIC
                    END                                   AS center_share,
                    CASE
                        WHEN dt.doc_name = 'A'
                            THEN COALESCE(
                                CASE
                                    WHEN COALESCE(all_totals.raw_ministry_total, 0) > 0
                                        THEN COALESCE(scoped.matched_raw_ministry, 0) / NULLIF(all_totals.raw_ministry_total, 0)
                                             * LEAST(COALESCE(all_totals.raw_ministry_total, 0), i.net_amount)
                                    ELSE 0
                                END,
                            0)
                        ELSE 0::NUMERIC
                    END                                   AS ministry_share,
                    i.accountant_id                       AS accountant_id,
                    u.full_name                           AS accountant_name,
                    v.doctor_id                           AS doctor_id,
                    du.full_name                          AS doctor_name,
                    COALESCE(i.paid_at, i.created_at)     AS txn_timestamp,
                    CASE
                        WHEN i.cancelled_at IS NOT NULL THEN 'cancelled'
                        ELSE 'paid'
                    END                                   AS status,
                    i.related_invoice_id                  AS related_id,
                    i.cancel_reason                       AS cancel_reason
                FROM invoices i
                JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
                JOIN visits v          ON i.visit_id    = v.visit_id
                JOIN patients p        ON v.patient_id  = p.patient_id
                LEFT JOIN users u      ON i.accountant_id = u.user_id
                LEFT JOIN users du     ON v.doctor_id    = du.user_id
                LEFT JOIN LATERAL (
                    SELECT CASE
                        WHEN EXISTS (SELECT 1 FROM invoice_details own WHERE own.invoice_id = i.invoice_id)
                            THEN i.invoice_id
                        ELSE i.related_invoice_id
                    END AS detail_invoice_id
                ) detail_link ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                        COALESCE(SUM(aid.service_price_at_time * aid.quantity), 0) AS gross_total,
                        COALESCE(SUM(aid.ministry_share_at_time), 0)                AS raw_ministry_total,
                        COALESCE(SUM(GREATEST((aid.service_price_at_time * aid.quantity) - aid.ministry_share_at_time, 0)), 0) AS raw_center_total
                    FROM invoice_details aid
                    WHERE aid.invoice_id = detail_link.detail_invoice_id
                ) all_totals ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                        COUNT(*) AS matched_details_count,
                        COALESCE(SUM(sid.service_price_at_time * sid.quantity), 0) AS matched_gross_total,
                        COALESCE(SUM(sid.ministry_share_at_time), 0)                AS matched_raw_ministry,
                        COALESCE(SUM(GREATEST((sid.service_price_at_time * sid.quantity) - sid.ministry_share_at_time, 0)), 0) AS matched_raw_center
                    FROM invoice_details sid
                    JOIN services_master ssm ON sid.service_id = ssm.service_id
                    LEFT JOIN service_categories ssc ON ssm.category_id = ssc.category_id
                    WHERE sid.invoice_id = detail_link.detail_invoice_id
                    {$detailScopeSql}
                ) scoped ON TRUE
                WHERE i.doc_type_id IS NOT NULL
                  AND COALESCE(scoped.matched_details_count, 0) > 0
            ";
        } else {
            $scopedParams = [];
            $invoicesSql = "
                SELECT
                    'INV-' || i.invoice_id::TEXT          AS txn_id,
                    'invoices'                            AS source_table,
                    i.invoice_id                          AS source_id,
                    CASE dt.doc_name
                        WHEN 'A' THEN 'cash'
                        WHEN 'B' THEN 'partial_exempt'
                        WHEN 'C' THEN 'full_exempt'
                        ELSE 'other'
                    END                                   AS txn_type,
                    CASE dt.doc_name
                        WHEN 'A' THEN 'كاش'
                        WHEN 'B' THEN 'إعفاء جزئي'
                        WHEN 'C' THEN 'إعفاء كلي'
                        ELSE dt.doc_name
                    END                                   AS txn_type_label,
                    dt.doc_name                           AS doc_code,
                    i.serial_number                       AS serial_number,
                    p.patient_id                          AS patient_id,
                    p.full_name                           AS patient_name,
                    i.visit_id                            AS visit_id,
                    i.total                               AS total,
                    i.net_amount                          AS cash_amount,
                    i.exemption_value                     AS exempt_amount,
                    CASE
                        WHEN dt.doc_name = 'A' THEN GREATEST(i.net_amount - LEAST(COALESCE(ml.ministry_share, 0), i.net_amount), 0)
                        ELSE 0::NUMERIC
                    END                                   AS center_share,
                    CASE
                        WHEN dt.doc_name = 'A' THEN LEAST(COALESCE(ml.ministry_share, 0), i.net_amount)
                        ELSE 0::NUMERIC
                    END                                   AS ministry_share,
                    i.accountant_id                       AS accountant_id,
                    u.full_name                           AS accountant_name,
                    v.doctor_id                           AS doctor_id,
                    du.full_name                          AS doctor_name,
                    COALESCE(i.paid_at, i.created_at)     AS txn_timestamp,
                    CASE
                        WHEN i.cancelled_at IS NOT NULL THEN 'cancelled'
                        ELSE 'paid'
                    END                                   AS status,
                    i.related_invoice_id                  AS related_id,
                    i.cancel_reason                       AS cancel_reason
                FROM invoices i
                JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
                JOIN visits v          ON i.visit_id    = v.visit_id
                JOIN patients p        ON v.patient_id  = p.patient_id
                LEFT JOIN users u      ON i.accountant_id = u.user_id
                LEFT JOIN users du     ON v.doctor_id    = du.user_id
                LEFT JOIN LATERAL (
                    SELECT SUM(id.ministry_share_at_time) AS ministry_share
                    FROM invoice_details id
                    WHERE id.invoice_id = i.invoice_id
                ) ml ON TRUE
                WHERE i.doc_type_id IS NOT NULL
            ";
        }

        $ticketsSql = "
            SELECT
                'TKT-' || t.ticket_id::TEXT           AS txn_id,
                'examination_tickets'                 AS source_table,
                t.ticket_id                           AS source_id,
                'ticket'                              AS txn_type,
                'تذكرة معاينة'                         AS txn_type_label,
                'T'                                   AS doc_code,
                t.serial_number                       AS serial_number,
                p.patient_id                          AS patient_id,
                p.full_name                           AS patient_name,
                t.visit_id                            AS visit_id,
                t.amount                              AS total,
                t.amount                              AS cash_amount,
                0::NUMERIC                            AS exempt_amount,
                GREATEST(
                    t.amount - LEAST(
                        CASE t.ticket_type
                            WHEN 'morning' THEN :tk_min_morning
                            WHEN 'evening' THEN :tk_min_evening
                            ELSE 0
                        END,
                        t.amount
                    ),
                    0
                )                                     AS center_share,
                LEAST(
                    CASE t.ticket_type
                        WHEN 'morning' THEN :tk_min_morning_2
                        WHEN 'evening' THEN :tk_min_evening_2
                        ELSE 0
                    END,
                    t.amount
                )                                     AS ministry_share,
                t.issued_by                           AS accountant_id,
                ui.full_name                          AS accountant_name,
                v.doctor_id                           AS doctor_id,
                du.full_name                          AS doctor_name,
                t.created_at                          AS txn_timestamp,
                'issued'                              AS status,
                NULL::INTEGER                         AS related_id,
                NULL::VARCHAR                         AS cancel_reason
            FROM examination_tickets t
            JOIN visits v       ON t.visit_id   = v.visit_id
            JOIN patients p     ON v.patient_id = p.patient_id
            LEFT JOIN users ui  ON t.issued_by  = ui.user_id
            LEFT JOIN users du  ON v.doctor_id  = du.user_id
        ";

        $sql = "({$invoicesSql}) UNION ALL ({$ticketsSql})";

        $params = array_merge($scopedParams, [
            ':tk_min_morning'   => $this->ticketMinistryMorning,
            ':tk_min_evening'   => $this->ticketMinistryEvening,
            ':tk_min_morning_2' => $this->ticketMinistryMorning,
            ':tk_min_evening_2' => $this->ticketMinistryEvening,
        ]);

        return ['sql' => $sql, 'params' => $params];
    }

    /**
     * يبني فقرة WHERE الديناميكية من مصفوفة الفلاتر المُمررة.
     * يعمل على الـ alias الخارجي 'u' الذي نُسمّيه دائماً عند الـ wrapping.
     *
     * يدعم 12 معيار فلترة:
     *   from, to                    - الزمن
     *   doc_codes[]                 - أنواع السندات (A,B,C,T)
     *   statuses[]                  - الحالات (paid, issued, cancelled)
     *   accountant_ids[]            - المحاسبون
     *   doctor_ids[]                - الأطباء
     *   service_ids[]               - الخدمات
     *   category_ids[]              - تصنيفات الخدمات
     *   department_ids[]            - الأقسام
     *   amount_min, amount_max      - نطاق المبلغ
     *   has_ministry_share          - حصة الوزارة فقط
     *   query                       - بحث نصي حر
     *
     * @return array { where_sql: string, params: array, joins: array<string> }
     */
    private function buildWhereClause(array $filters, string $alias = 'u'): array
    {
        $conditions = [];
        $params = [];
        $needsServiceJoin = false;

        // 1. الفلترة الزمنية
        if (!empty($filters['from'])) {
            $conditions[] = "{$alias}.txn_timestamp >= :flt_from";
            $params[':flt_from'] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $conditions[] = "{$alias}.txn_timestamp <= :flt_to";
            $params[':flt_to'] = $filters['to'];
        }

        // 2. أنواع السندات
        if (!empty($filters['doc_codes']) && is_array($filters['doc_codes'])) {
            $codes = array_values(array_filter($filters['doc_codes'], fn($c) => in_array($c, ['A','B','C','T'], true)));
            if (!empty($codes)) {
                $placeholders = [];
                foreach ($codes as $i => $c) {
                    $key = ":flt_doc_$i";
                    $placeholders[] = $key;
                    $params[$key] = $c;
                }
                $conditions[] = "{$alias}.doc_code IN (" . implode(',', $placeholders) . ")";
            }
        }

        // 3. الحالات
        if (!empty($filters['statuses']) && is_array($filters['statuses'])) {
            $statuses = array_values(array_filter($filters['statuses'], fn($s) => in_array($s, ['paid','issued','cancelled'], true)));
            if (!empty($statuses)) {
                $placeholders = [];
                foreach ($statuses as $i => $s) {
                    $key = ":flt_status_$i";
                    $placeholders[] = $key;
                    $params[$key] = $s;
                }
                $conditions[] = "{$alias}.status IN (" . implode(',', $placeholders) . ")";
            }
        }

        // 4. المحاسبون
        if (!empty($filters['accountant_ids']) && is_array($filters['accountant_ids'])) {
            $ids = array_values(array_filter(array_map('intval', $filters['accountant_ids']), fn($v) => $v > 0));
            if (!empty($ids)) {
                $placeholders = [];
                foreach ($ids as $i => $id) {
                    $key = ":flt_acc_$i";
                    $placeholders[] = $key;
                    $params[$key] = $id;
                }
                $conditions[] = "{$alias}.accountant_id IN (" . implode(',', $placeholders) . ")";
            }
        }

        // 5. الأطباء
        if (!empty($filters['doctor_ids']) && is_array($filters['doctor_ids'])) {
            $ids = array_values(array_filter(array_map('intval', $filters['doctor_ids']), fn($v) => $v > 0));
            if (!empty($ids)) {
                $placeholders = [];
                foreach ($ids as $i => $id) {
                    $key = ":flt_doc_id_$i";
                    $placeholders[] = $key;
                    $params[$key] = $id;
                }
                $conditions[] = "{$alias}.doctor_id IN (" . implode(',', $placeholders) . ")";
            }
        }

        // 6-8. فلترة الخدمة/التصنيف/القسم أصبحت تُطبّق داخل buildUnifiedLedgerSql
        // على مستوى تفاصيل الفاتورة نفسها، حتى لا يتم احتساب خدمات غير مطابقة
        // عند وجود أكثر من خدمة داخل نفس السند، وكذلك لدعم سند B المرتبط.

        // 9. نطاق المبلغ
        if (isset($filters['amount_min']) && is_numeric($filters['amount_min'])) {
            $conditions[] = "{$alias}.total >= :flt_amount_min";
            $params[':flt_amount_min'] = (float) $filters['amount_min'];
        }
        if (isset($filters['amount_max']) && is_numeric($filters['amount_max'])) {
            $conditions[] = "{$alias}.total <= :flt_amount_max";
            $params[':flt_amount_max'] = (float) $filters['amount_max'];
        }

        // 10. حصة الوزارة فقط
        if (!empty($filters['has_ministry_share'])) {
            $conditions[] = "{$alias}.ministry_share > 0";
        }

        // 11. البحث النصي الحر
        if (!empty($filters['query'])) {
            $q = trim((string) $filters['query']);
            if ($q !== '') {
                $params[':flt_query']  = '%' . $q . '%';
                $params[':flt_query2'] = '%' . $q . '%';
                $params[':flt_query3'] = '%' . $q . '%';
                $like = $this->driver === 'pgsql' ? 'ILIKE' : 'LIKE';
                $conditions[] = "(
                    {$alias}.patient_name {$like} :flt_query
                    OR CAST({$alias}.serial_number AS TEXT) {$like} :flt_query2
                    OR {$alias}.txn_id {$like} :flt_query3
                )";
            }
        }

        // 12. Scope محاسب (يُحدد المتحكم لا الواجهة)
        if (!empty($filters['_scope_accountant_id'])) {
            $params[':flt_scope_acc'] = (int) $filters['_scope_accountant_id'];
            $conditions[] = "({$alias}.accountant_id = :flt_scope_acc OR {$alias}.accountant_id IS NULL)";
        }

        $whereSql = empty($conditions) ? '' : 'WHERE ' . implode(' AND ', $conditions);
        return ['where_sql' => $whereSql, 'params' => $params];
    }

    /**
     * يجلب صفحة من دفتر الحركات الموحّد مع total_count والمجاميع.
     *
     * @param array $filters فلاتر المستخدم
     * @param int $page الصفحة (1-based)
     * @param int $perPage حجم الصفحة
     * @param string $sortBy حقل الفرز
     * @param string $sortDir ASC | DESC
     * @return array { rows, total_count, page_total }
     */
    public function getTransactions(array $filters, int $page = 1, int $perPage = 50, string $sortBy = 'txn_timestamp', string $sortDir = 'DESC'): array
    {
        $unified = $this->buildUnifiedLedgerSql($filters);
        $where   = $this->buildWhereClause($filters, 'u');

        // التحقق من sortBy للحماية من SQL Injection
        $allowedSorts = [
            'txn_timestamp', 'serial_number', 'source_id', 'visit_id', 'txn_id',
            'total', 'cash_amount', 'exempt_amount', 'ministry_share', 'center_share',
            'patient_name', 'doc_code', 'txn_type', 'txn_type_label', 'status',
            'accountant_name', 'doctor_name',
        ];
        if (!in_array($sortBy, $allowedSorts, true)) {
            $sortBy = 'txn_timestamp';
        }
        $sortDir = strtoupper($sortDir) === 'ASC' ? 'ASC' : 'DESC';

        $page = max(1, $page);
        $perPage = max(1, min(500, $perPage));
        $offset = ($page - 1) * $perPage;

        // الاستعلام الرئيسي: rows + total_count بطلب واحد عبر window function
        $rowsSql = "
            WITH unified AS ({$unified['sql']})
            SELECT u.*, COUNT(*) OVER() AS _total_count
            FROM unified u
            {$where['where_sql']}
            ORDER BY u.{$sortBy} {$sortDir}, u.txn_timestamp DESC
            LIMIT :_limit OFFSET :_offset
        ";

        $rowsParams = array_merge($unified['params'], $where['params'], [
            ':_limit'  => $perPage,
            ':_offset' => $offset,
        ]);

        $stmt = $this->conn->prepare($rowsSql);
        foreach ($rowsParams as $k => $v) {
            $type = is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR;
            $stmt->bindValue($k, $v, $type);
        }
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $totalCount = !empty($rows) ? (int) $rows[0]['_total_count'] : 0;
        foreach ($rows as &$row) {
            unset($row['_total_count']);
            // تطبيع الأنواع الرقمية لـ float صريح للعرض
            $row['total']          = (float) $row['total'];
            $row['cash_amount']    = (float) $row['cash_amount'];
            $row['exempt_amount']  = (float) $row['exempt_amount'];
            $row['center_share']   = (float) $row['center_share'];
            $row['ministry_share'] = (float) $row['ministry_share'];
            $row['serial_number']  = (int) $row['serial_number'];
        }
        unset($row);

        // مجموع الصفحة الحالية (للـ footer)
        $pageTotal = [
            'total'          => 0.0,
            'cash_amount'    => 0.0,
            'exempt_amount'  => 0.0,
            'center_share'   => 0.0,
            'ministry_share' => 0.0,
        ];
        foreach ($rows as $r) {
            if (($r['status'] ?? '') === 'cancelled') {
                continue;
            }
            $pageTotal['total']          += (float) $r['total'];
            $pageTotal['cash_amount']    += (float) $r['cash_amount'];
            $pageTotal['exempt_amount']  += (float) $r['exempt_amount'];
            $pageTotal['center_share']   += (float) $r['center_share'];
            $pageTotal['ministry_share'] += (float) $r['ministry_share'];
        }

        return [
            'rows'        => $rows,
            'total_count' => $totalCount,
            'page'        => $page,
            'per_page'    => $perPage,
            'page_total'  => $pageTotal,
        ];
    }

    /**
     * يحسب مجاميع كاملة (لكل النتائج التي تطابق الفلاتر، ليس صفحة فقط).
     * يُستخدم للـ KPIs والصف الإجمالي والتصدير.
     */
    public function getTotals(array $filters): array
    {
        $unified = $this->buildUnifiedLedgerSql($filters);
        $where   = $this->buildWhereClause($filters, 'u');

        $sql = "
            WITH unified AS ({$unified['sql']})
            SELECT
                COUNT(CASE WHEN u.status <> 'cancelled' THEN 1 END)     AS row_count,
                COALESCE(SUM(CASE WHEN u.status <> 'cancelled' THEN u.total ELSE 0 END), 0)          AS sum_total,
                COALESCE(SUM(CASE WHEN u.status <> 'cancelled' THEN u.cash_amount ELSE 0 END), 0)    AS sum_cash,
                COALESCE(SUM(CASE WHEN u.status <> 'cancelled' THEN u.exempt_amount ELSE 0 END), 0)  AS sum_exempt,
                COALESCE(SUM(CASE WHEN u.status <> 'cancelled' THEN u.center_share ELSE 0 END), 0)   AS sum_center,
                COALESCE(SUM(CASE WHEN u.status <> 'cancelled' THEN u.ministry_share ELSE 0 END), 0) AS sum_ministry,
                COALESCE(SUM(CASE WHEN u.doc_code = 'A' AND u.status <> 'cancelled' THEN u.cash_amount ELSE 0 END), 0)   AS sum_cash_only,
                COALESCE(SUM(CASE WHEN u.doc_code = 'B' AND u.status <> 'cancelled' THEN u.exempt_amount ELSE 0 END), 0) AS sum_partial,
                COALESCE(SUM(CASE WHEN u.doc_code = 'C' AND u.status <> 'cancelled' THEN u.exempt_amount ELSE 0 END), 0) AS sum_full,
                COALESCE(SUM(CASE WHEN u.doc_code = 'T' AND u.status <> 'cancelled' THEN u.cash_amount ELSE 0 END), 0)   AS sum_tickets,
                COUNT(CASE WHEN u.doc_code = 'A' AND u.status <> 'cancelled' THEN 1 END)            AS count_cash,
                COUNT(CASE WHEN u.doc_code = 'B' AND u.status <> 'cancelled' THEN 1 END)            AS count_partial,
                COUNT(CASE WHEN u.doc_code = 'C' AND u.status <> 'cancelled' THEN 1 END)            AS count_full,
                COUNT(CASE WHEN u.doc_code = 'T' AND u.status <> 'cancelled' THEN 1 END)            AS count_tickets,
                COUNT(CASE WHEN u.status = 'cancelled' THEN 1 END)                                   AS count_cancelled
            FROM unified u
            {$where['where_sql']}
        ";

        $stmt = $this->conn->prepare($sql);
        $params = array_merge($unified['params'], $where['params']);
        foreach ($params as $k => $v) {
            $type = is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR;
            $stmt->bindValue($k, $v, $type);
        }
        $stmt->execute();
        $result = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

        // تحويل لـ float/int
        foreach ($result as $k => $v) {
            if (strpos($k, 'sum_') === 0) {
                $result[$k] = (float) $v;
            } else {
                $result[$k] = (int) $v;
            }
        }
        return $result;
    }

    // ========================================================================
    //   2. KPIs المالية (Overview)
    // ========================================================================

    /**
     * يحسب KPIs لفترتين: اليوم + الشهر الحالي.
     * الإخراج: مصفوفة جاهزة للعرض في 6 بطاقات.
     */
    public function getKpis(?array $userScope = null): array
    {
        $todayFilters = [];
        $monthFilters = [];

        if ($this->driver === 'pgsql') {
            $today = (new DateTime('now'))->format('Y-m-d');
            $monthStart = (new DateTime('now'))->format('Y-m-01');
        } else {
            $today = date('Y-m-d');
            $monthStart = date('Y-m-01');
        }

        $todayFilters['from'] = $today . ' 00:00:00';
        $todayFilters['to']   = $today . ' 23:59:59';

        $monthFilters['from'] = $monthStart . ' 00:00:00';
        $monthFilters['to']   = date('Y-m-d') . ' 23:59:59';

        if ($userScope !== null) {
            $todayFilters = array_merge($todayFilters, $userScope);
            $monthFilters = array_merge($monthFilters, $userScope);
        }

        $todayFilters['statuses'] = ['paid', 'issued'];
        $monthFilters['statuses'] = ['paid', 'issued'];

        $todayStats = $this->getTotals($todayFilters);
        $monthStats = $this->getTotals($monthFilters);

        return [
            'today' => [
                'total'           => $todayStats['sum_total'],
                'cash'            => $todayStats['sum_cash'],
                'exempts'         => $todayStats['sum_exempt'],
                'tickets_amount'  => $todayStats['sum_tickets'],
                'tickets_count'   => $todayStats['count_tickets'],
                'ministry_share'  => $todayStats['sum_ministry'],
                'center_share'    => $todayStats['sum_center'],
                'count_cash'      => $todayStats['count_cash'],
                'count_partial'   => $todayStats['count_partial'],
                'count_full'      => $todayStats['count_full'],
                'count_cancelled' => $todayStats['count_cancelled'],
            ],
            'month' => [
                'total'           => $monthStats['sum_total'],
                'cash'            => $monthStats['sum_cash'],
                'exempts'         => $monthStats['sum_exempt'],
                'tickets_amount'  => $monthStats['sum_tickets'],
                'tickets_count'   => $monthStats['count_tickets'],
                'ministry_share'  => $monthStats['sum_ministry'],
                'center_share'    => $monthStats['sum_center'],
                'row_count'       => $monthStats['row_count'],
            ],
        ];
    }

    // ========================================================================
    //   3. بيانات الرسوم البيانية
    // ========================================================================

    /**
     * إيراد آخر 30 يوم (Line Chart) — يجمع كل أنواع الحركات.
     */
    public function getRevenue30Days(?array $userScope = null): array
    {
        $scopeFilters = $userScope ?? [];
        $unified = $this->buildUnifiedLedgerSql($scopeFilters);
        $scope   = $this->buildWhereClause($scopeFilters, 'u');

        // إذا كان هناك scope filters، نضيف شروطها (نزيل "WHERE " من البداية)
        $extraScopeConditions = $scope['where_sql'] !== ''
            ? ' AND ' . substr($scope['where_sql'], 6)
            : '';

        $sql = "
            WITH unified AS ({$unified['sql']})
            SELECT
                DATE(u.txn_timestamp)        AS day,
                COALESCE(SUM(u.total), 0)    AS amount,
                COALESCE(SUM(u.cash_amount + u.exempt_amount), 0) AS gross,
                COUNT(*)                     AS txn_count
            FROM unified u
            WHERE u.txn_timestamp >= CURRENT_DATE - INTERVAL '29 days'
              AND u.status <> 'cancelled'
              {$extraScopeConditions}
            GROUP BY DATE(u.txn_timestamp)
            ORDER BY day ASC
        ";

        $stmt = $this->conn->prepare($sql);
        $params = array_merge($unified['params'], $scope['params']);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        return array_map(fn($r) => [
            'day'       => $r['day'],
            'amount'    => (float) $r['amount'],
            'txn_count' => (int)   $r['txn_count'],
        ], $rows);
    }

    /**
     * توزيع الإيراد حسب نوع السند (Doughnut Chart).
     */
    public function getTypeDistribution(?array $filters = null): array
    {
        $filters = $filters ?? [];
        $unified = $this->buildUnifiedLedgerSql($filters);
        $where   = $this->buildWhereClause($filters, 'u');

        // دمج شرط استبعاد الملغاة مع الـ WHERE القائم
        $combinedWhere = $where['where_sql'] === ''
            ? "WHERE u.status <> 'cancelled'"
            : $where['where_sql'] . " AND u.status <> 'cancelled'";

        $sql = "
            WITH unified AS ({$unified['sql']})
            SELECT
                u.doc_code,
                u.txn_type_label  AS label,
                COUNT(*)          AS count,
                COALESCE(SUM(u.total), 0) AS value
            FROM unified u
            {$combinedWhere}
            GROUP BY u.doc_code, u.txn_type_label
            ORDER BY value DESC
        ";

        $stmt = $this->conn->prepare($sql);
        $params = array_merge($unified['params'], $where['params']);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        return array_map(fn($r) => [
            'doc_code' => $r['doc_code'],
            'label'    => $r['label'],
            'count'    => (int)   $r['count'],
            'value'    => (float) $r['value'],
        ], $rows);
    }

    /**
     * أعلى 10 خدمات (Bar Chart).
     */
    public function getTopServices(?array $filters = null, int $limit = 10): array
    {
        $activeFilters = $filters ?? [];
        $reportFilters = $this->buildInvoiceReportFilters($activeFilters, 'i', 'v', 'p', 'id', 'sm', 'sc', 'dt');

        $sql = "
            SELECT
                sm.service_id,
                sm.service_name,
                COUNT(*)                                                       AS count,
                COALESCE(SUM(id.service_price_at_time * id.quantity), 0)       AS revenue,
                COALESCE(SUM(id.ministry_share_at_time), 0)                    AS ministry_share
            FROM invoice_details id
            JOIN services_master sm ON id.service_id = sm.service_id
            LEFT JOIN service_categories sc ON sm.category_id = sc.category_id
            JOIN invoices i ON id.invoice_id = i.invoice_id
            JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
            JOIN visits v ON i.visit_id = v.visit_id
            JOIN patients p ON v.patient_id = p.patient_id
            {$reportFilters['where_sql']}
            GROUP BY sm.service_id, sm.service_name
            ORDER BY revenue DESC, sm.service_name ASC
            LIMIT :_limit
        ";

        $stmt = $this->conn->prepare($sql);
        foreach ($reportFilters['params'] as $k => $v) {
            $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $stmt->bindValue(':_limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        return array_map(fn($r) => [
            'service_id'     => (int)   $r['service_id'],
            'service_name'   => $r['service_name'],
            'count'          => (int)   $r['count'],
            'revenue'        => (float) $r['revenue'],
            'ministry_share' => (float) $r['ministry_share'],
        ], $rows);
    }

    /**
     * أداء المحاسبين (Bar Chart).
     */
    public function getAccountantsPerformance(?array $filters = null): array
    {
        $activeFilters = $filters ?? [];
        $unified = $this->buildUnifiedLedgerSql($activeFilters);
        $where   = $this->buildWhereClause($activeFilters, 'u');

        // دمج فلاتر إضافية مع الـ WHERE
        $extraConditions = "u.accountant_id IS NOT NULL AND u.status <> 'cancelled'";
        $combinedWhere = $where['where_sql'] === ''
            ? "WHERE {$extraConditions}"
            : $where['where_sql'] . " AND {$extraConditions}";

        $sql = "
            WITH unified AS ({$unified['sql']})
            SELECT
                u.accountant_id,
                u.accountant_name,
                COUNT(*)                                  AS txn_count,
                COALESCE(SUM(u.cash_amount), 0)           AS cash_collected,
                COALESCE(SUM(u.exempt_amount), 0)         AS exempts_processed,
                COALESCE(SUM(u.total), 0)                 AS total
            FROM unified u
            {$combinedWhere}
            GROUP BY u.accountant_id, u.accountant_name
            ORDER BY cash_collected DESC
            LIMIT 10
        ";

        $stmt = $this->conn->prepare($sql);
        $params = array_merge($unified['params'], $where['params']);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        return array_map(fn($r) => [
            'accountant_id'      => (int)   $r['accountant_id'],
            'accountant_name'    => $r['accountant_name'],
            'txn_count'          => (int)   $r['txn_count'],
            'cash_collected'     => (float) $r['cash_collected'],
            'exempts_processed'  => (float) $r['exempts_processed'],
            'total'              => (float) $r['total'],
        ], $rows);
    }

    // ========================================================================
    //   4. تفاصيل حركة منفردة (للـ Drawer + الطباعة)
    // ========================================================================

    /**
     * يجلب تفاصيل حركة بناءً على txn_id (مثل "INV-62" أو "TKT-9").
     */
    public function getTransactionDetail(string $txnId): ?array
    {
        if (!preg_match('/^(INV|TKT)-(\d+)$/', $txnId, $matches)) {
            return null;
        }
        $type = $matches[1];
        $id   = (int) $matches[2];

        if ($type === 'INV') {
            return $this->getInvoiceDetail($id);
        }
        return $this->getTicketDetail($id);
    }

    private function getInvoiceDetail(int $invoiceId): ?array
    {
        $this->loadTicketMinistryShares();

        $sql = "
            SELECT
                i.invoice_id, i.serial_number, i.total, i.net_amount, i.exemption_value,
                i.paid_at, i.created_at, i.cancelled_at, i.cancel_reason,
                i.related_invoice_id,
                dt.doc_name AS doc_code,
                p.patient_id, p.full_name AS patient_name, p.phone AS patient_phone,
                p.national_id, p.gender, p.birth_date,
                v.visit_id, v.diagnosis, v.notes AS visit_notes,
                u.full_name AS accountant_name,
                du.full_name AS doctor_name,
                et.case_name AS case_type_name
            FROM invoices i
            JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
            JOIN visits v          ON i.visit_id    = v.visit_id
            JOIN patients p        ON v.patient_id  = p.patient_id
            LEFT JOIN users u      ON i.accountant_id = u.user_id
            LEFT JOIN users du     ON v.doctor_id    = du.user_id
            LEFT JOIN emergency_case_types et ON v.case_type_id = et.case_type_id
            WHERE i.invoice_id = :iid
            LIMIT 1
        ";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':iid' => $invoiceId]);
        $invoice = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$invoice) return null;

        // تفاصيل الخدمات
        $servicesSql = "
            SELECT
                id.detail_id, id.service_id, id.service_price_at_time AS price,
                id.quantity, id.ministry_share_at_time AS ministry_share,
                sm.service_name,
                sc.category_name,
                d.department_name
            FROM invoice_details id
            JOIN services_master sm ON id.service_id = sm.service_id
            LEFT JOIN service_categories sc ON sm.category_id = sc.category_id
            LEFT JOIN departments d ON sc.department_id = d.department_id
            WHERE id.invoice_id = :iid
            ORDER BY id.detail_id
        ";
        $stmt = $this->conn->prepare($servicesSql);
        $stmt->execute([':iid' => $invoiceId]);
        $services = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $cashAmount = (float) ($invoice['net_amount'] ?? 0);
        $docCode = (string) ($invoice['doc_code'] ?? '');

        $services = array_map(function (array $row): array {
            $price = (float) ($row['price'] ?? 0);
            $quantity = (float) ($row['quantity'] ?? 0);
            $ministryShare = (float) ($row['ministry_share'] ?? 0);

            $row['price'] = $price;
            $row['quantity'] = $quantity;
            $row['ministry_share'] = $ministryShare;
            $row['_original_center_share'] = max(($price * $quantity) - $ministryShare, 0.0);
            return $row;
        }, $services);

        $originalMinistryTotal = array_sum(array_column($services, 'ministry_share'));
        $originalCenterTotal = array_sum(array_column($services, '_original_center_share'));
        $appliedMinistryTotal = $docCode === 'A' ? min($originalMinistryTotal, $cashAmount) : 0.0;
        $appliedCenterTotal = $docCode === 'A' ? max($cashAmount - $appliedMinistryTotal, 0.0) : 0.0;
        $remainingMinistry = $appliedMinistryTotal;
        $remainingCenter = $appliedCenterTotal;
        $lastIndex = count($services) - 1;

        foreach ($services as $idx => &$service) {
            $originalMinistry = (float) ($service['ministry_share'] ?? 0);
            $originalCenter = (float) ($service['_original_center_share'] ?? 0);

            if ($docCode !== 'A') {
                $service['ministry_share'] = 0.0;
                $service['center_share'] = 0.0;
                unset($service['_original_center_share']);
                continue;
            }

            if ($idx === $lastIndex) {
                $serviceMinistry = $remainingMinistry;
                $serviceCenter = $remainingCenter;
            } else {
                $serviceMinistry = $originalMinistryTotal > 0
                    ? round(($originalMinistry / $originalMinistryTotal) * $appliedMinistryTotal, 2)
                    : 0.0;
                $serviceCenter = $originalCenterTotal > 0
                    ? round(($originalCenter / $originalCenterTotal) * $appliedCenterTotal, 2)
                    : 0.0;
                $remainingMinistry -= $serviceMinistry;
                $remainingCenter -= $serviceCenter;
            }

            $service['ministry_share'] = max((float) $serviceMinistry, 0.0);
            $service['center_share'] = max((float) $serviceCenter, 0.0);
            unset($service['_original_center_share']);
        }
        unset($service);

        // السند المرتبط (إن وجد)
        $related = null;
        if (!empty($invoice['related_invoice_id'])) {
            $rstmt = $this->conn->prepare("
                SELECT i.invoice_id, i.serial_number, dt.doc_name AS doc_code,
                       i.total, i.net_amount, i.exemption_value
                FROM invoices i
                JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
                WHERE i.invoice_id = :rid LIMIT 1
            ");
            $rstmt->execute([':rid' => $invoice['related_invoice_id']]);
            $related = $rstmt->fetch(PDO::FETCH_ASSOC) ?: null;
        }

        return [
            'txn_id'        => 'INV-' . $invoiceId,
            'source_type'   => 'invoice',
            'invoice'       => $invoice,
            'services'      => $services,
            'related'       => $related,
            'totals'        => [
                'total'          => (float) $invoice['total'],
                'cash'           => (float) $invoice['net_amount'],
                'exempt'         => (float) $invoice['exemption_value'],
                'ministry_share' => (float) $appliedMinistryTotal,
                'center_share'   => (float) $appliedCenterTotal,
            ],
        ];
    }

    private function getTicketDetail(int $ticketId): ?array
    {
        $this->loadTicketMinistryShares();

        $sql = "
            SELECT
                t.ticket_id, t.serial_number, t.ticket_type, t.amount, t.notes,
                t.created_at,
                p.patient_id, p.full_name AS patient_name, p.phone AS patient_phone,
                p.national_id, p.gender, p.birth_date,
                v.visit_id, v.diagnosis,
                u.full_name AS issued_by_name,
                du.full_name AS doctor_name
            FROM examination_tickets t
            JOIN visits v       ON t.visit_id   = v.visit_id
            JOIN patients p     ON v.patient_id = p.patient_id
            LEFT JOIN users u   ON t.issued_by  = u.user_id
            LEFT JOIN users du  ON v.doctor_id  = du.user_id
            WHERE t.ticket_id = :tid
            LIMIT 1
        ";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':tid' => $ticketId]);
        $ticket = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$ticket) return null;

        $configuredMinistryShare = $ticket['ticket_type'] === 'morning'
            ? $this->ticketMinistryMorning
            : $this->ticketMinistryEvening;
        $ministryShare = min((float) $ticket['amount'], (float) $configuredMinistryShare);

        return [
            'txn_id'      => 'TKT-' . $ticketId,
            'source_type' => 'ticket',
            'ticket'      => $ticket,
            'totals'      => [
                'total'          => (float) $ticket['amount'],
                'cash'           => (float) $ticket['amount'],
                'exempt'         => 0.0,
                'ministry_share' => $ministryShare,
                'center_share'   => max((float) $ticket['amount'] - $ministryShare, 0.0),
            ],
        ];
    }

    // ========================================================================
    //   5. تقرير حصة الوزارة التفصيلي
    // ========================================================================

    /**
     * يجلب تفاصيل حصة الوزارة لفترة محددة:
     *   - حصة الوزارة من الفواتير (موزّعة بالخدمات + الأقسام)
     *   - حصة الوزارة من التذاكر (مجمّعة بالنوع صباحي/مسائي)
     */
    public function getMinistryShareReport(array $filters, ?int $accountantId = null): array
    {
        $this->loadTicketMinistryShares();

        $reportFilters = $this->buildInvoiceReportFilters($filters, 'i', 'v', 'p', 'id', 'sm', 'sc', 'dt');
        if ($accountantId !== null) {
            $reportFilters['where_sql'] .= " AND i.accountant_id = :min_acc";
            $reportFilters['params'][':min_acc'] = $accountantId;
        }
        $reportFilters['where_sql'] .= " AND id.ministry_share_at_time > 0";

        $servicesSql = "
            SELECT
                sm.service_id,
                sm.service_name,
                sc.category_name,
                d.department_name,
                COUNT(*)                                                AS count,
                COALESCE(SUM(
                    id.ministry_share_at_time * LEAST(
                        1,
                        COALESCE(i.net_amount / NULLIF(inv_totals.total_ministry, 0), 0)
                    )
                ), 0)                                                   AS ministry_share,
                COALESCE(SUM(id.service_price_at_time * id.quantity), 0) AS total_revenue
            FROM invoice_details id
            JOIN services_master sm ON id.service_id = sm.service_id
            LEFT JOIN service_categories sc ON sm.category_id = sc.category_id
            LEFT JOIN departments d ON sc.department_id = d.department_id
            JOIN invoices i ON id.invoice_id = i.invoice_id
            JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
            JOIN visits v ON i.visit_id = v.visit_id
            JOIN patients p ON v.patient_id = p.patient_id
            LEFT JOIN LATERAL (
                SELECT SUM(id2.ministry_share_at_time) AS total_ministry
                FROM invoice_details id2
                WHERE id2.invoice_id = i.invoice_id
            ) inv_totals ON TRUE
            {$reportFilters['where_sql']}
            GROUP BY sm.service_id, sm.service_name, sc.category_name, d.department_name
            ORDER BY ministry_share DESC, sm.service_name ASC
        ";
        $stmt = $this->conn->prepare($servicesSql);
        foreach ($reportFilters['params'] as $k => $v) {
            $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $stmt->execute();
        $byService = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $ticketAllowed = true;
        if (!empty($filters['doc_codes']) && is_array($filters['doc_codes']) && !in_array('T', $filters['doc_codes'], true)) {
            $ticketAllowed = false;
        }
        if (!empty($filters['statuses']) && is_array($filters['statuses']) && !in_array('issued', $filters['statuses'], true)) {
            $ticketAllowed = false;
        }
        if ($this->hasLineScopedFilters($filters)) {
            $ticketAllowed = false;
        }

        $byTicket = [];
        if ($ticketAllowed) {
            $ticketWhere = ['1 = 1'];
            $ticketParams = [
                ':ms_morning'   => $this->ticketMinistryMorning,
                ':ms_evening'   => $this->ticketMinistryEvening,
                ':ms_morning_2' => $this->ticketMinistryMorning,
                ':ms_evening_2' => $this->ticketMinistryEvening,
            ];

            if (!empty($filters['from'])) {
                $ticketWhere[] = 't.created_at >= :tk_from';
                $ticketParams[':tk_from'] = $filters['from'];
            }
            if (!empty($filters['to'])) {
                $ticketWhere[] = 't.created_at <= :tk_to';
                $ticketParams[':tk_to'] = $filters['to'];
            }
            if ($accountantId !== null) {
                $ticketWhere[] = 't.issued_by = :tk_acc';
                $ticketParams[':tk_acc'] = $accountantId;
            }
            if (!empty($filters['accountant_ids']) && is_array($filters['accountant_ids'])) {
                $ids = array_values(array_filter(array_map('intval', $filters['accountant_ids']), fn($v) => $v > 0));
                if (!empty($ids)) {
                    $placeholders = [];
                    foreach ($ids as $i => $id) {
                        $key = ":tk_acc_scope_$i";
                        $placeholders[] = $key;
                        $ticketParams[$key] = $id;
                    }
                    $ticketWhere[] = 't.issued_by IN (' . implode(',', $placeholders) . ')';
                }
            }
            if (!empty($filters['doctor_ids']) && is_array($filters['doctor_ids'])) {
                $ids = array_values(array_filter(array_map('intval', $filters['doctor_ids']), fn($v) => $v > 0));
                if (!empty($ids)) {
                    $placeholders = [];
                    foreach ($ids as $i => $id) {
                        $key = ":tk_doc_$i";
                        $placeholders[] = $key;
                        $ticketParams[$key] = $id;
                    }
                    $ticketWhere[] = 'v.doctor_id IN (' . implode(',', $placeholders) . ')';
                }
            }
            if (!empty($filters['query'])) {
                $q = trim((string) $filters['query']);
                if ($q !== '') {
                    $like = $this->driver === 'pgsql' ? 'ILIKE' : 'LIKE';
                    $ticketWhere[] = "(p.full_name {$like} :tk_query1 OR CAST(t.serial_number AS TEXT) {$like} :tk_query2 OR CAST(t.ticket_id AS TEXT) {$like} :tk_query3)";
                    $ticketParams[':tk_query1'] = '%' . $q . '%';
                    $ticketParams[':tk_query2'] = '%' . $q . '%';
                    $ticketParams[':tk_query3'] = '%' . $q . '%';
                }
            }
            if (isset($filters['amount_min']) && is_numeric($filters['amount_min'])) {
                $ticketWhere[] = 't.amount >= :tk_amount_min';
                $ticketParams[':tk_amount_min'] = (float) $filters['amount_min'];
            }
            if (isset($filters['amount_max']) && is_numeric($filters['amount_max'])) {
                $ticketWhere[] = 't.amount <= :tk_amount_max';
                $ticketParams[':tk_amount_max'] = (float) $filters['amount_max'];
            }
            if (!empty($filters['has_ministry_share'])) {
                $ticketWhere[] = "LEAST(t.amount, CASE t.ticket_type WHEN 'morning' THEN :ms_morning_2 WHEN 'evening' THEN :ms_evening_2 ELSE 0 END) > 0";
            }

            $ticketsSql = "
                SELECT
                    t.ticket_type,
                    COUNT(*) AS count,
                    LEAST(
                        CASE t.ticket_type
                            WHEN 'morning' THEN :ms_morning
                            WHEN 'evening' THEN :ms_evening
                            ELSE 0
                        END,
                        MIN(t.amount)
                    ) AS unit_share,
                    COALESCE(SUM(LEAST(
                        t.amount,
                        CASE t.ticket_type
                            WHEN 'morning' THEN :ms_morning_2
                            WHEN 'evening' THEN :ms_evening_2
                            ELSE 0
                        END
                    )), 0) AS ministry_share,
                    COALESCE(SUM(t.amount), 0) AS total_revenue
                FROM examination_tickets t
                JOIN visits v ON t.visit_id = v.visit_id
                JOIN patients p ON v.patient_id = p.patient_id
                WHERE " . implode(' AND ', $ticketWhere) . "
                GROUP BY t.ticket_type
                ORDER BY ministry_share DESC
            ";
            $stmt = $this->conn->prepare($ticketsSql);
            foreach ($ticketParams as $k => $v) {
                $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
            }
            $stmt->execute();
            $byTicket = $stmt->fetchAll(PDO::FETCH_ASSOC);
        }

        $totalFromServices = array_sum(array_column($byService, 'ministry_share'));
        $totalFromTickets  = array_sum(array_column($byTicket, 'ministry_share'));

        return [
            'period' => ['from' => $filters['from'] ?? null, 'to' => $filters['to'] ?? null],
            'by_service' => array_map(fn($r) => [
                'service_id'     => (int) $r['service_id'],
                'service_name'   => $r['service_name'],
                'category_name'  => $r['category_name'],
                'department_name'=> $r['department_name'],
                'count'          => (int)   $r['count'],
                'ministry_share' => (float) $r['ministry_share'],
                'total_revenue'  => (float) $r['total_revenue'],
            ], $byService),
            'by_ticket' => array_map(fn($r) => [
                'ticket_type'       => $r['ticket_type'],
                'ticket_type_label' => $r['ticket_type'] === 'morning' ? 'صباحي' : 'مسائي',
                'count'             => (int)   $r['count'],
                'unit_share'        => (float) $r['unit_share'],
                'ministry_share'    => (float) $r['ministry_share'],
                'total_revenue'     => (float) $r['total_revenue'],
            ], $byTicket),
            'totals' => [
                'from_services' => (float) $totalFromServices,
                'from_tickets'  => (float) $totalFromTickets,
                'grand_total'   => (float) ($totalFromServices + $totalFromTickets),
            ],
        ];
    }

    // ========================================================================
    //   6. خيارات الفلاتر (Dropdowns)
    // ========================================================================

    public function getFilterOptions(): array
    {
        // المحاسبون (role_code = 2)
        $accountants = $this->conn->query("
            SELECT u.user_id, u.full_name
            FROM users u
            JOIN roles r ON u.role_id = r.role_id
            WHERE r.role_code = 2 AND u.is_active = TRUE
            ORDER BY u.full_name
        ")->fetchAll(PDO::FETCH_ASSOC);

        // المدير قد يحصّل أيضاً، نضمّه إلى قائمة المحاسبين المحتملين الذين ظهروا في invoices
        $extraStmt = $this->conn->query("
            SELECT DISTINCT u.user_id, u.full_name
            FROM invoices i
            JOIN users u ON i.accountant_id = u.user_id
            WHERE i.accountant_id IS NOT NULL
            ORDER BY u.full_name
        ");
        $accountantsFromInvoices = $extraStmt->fetchAll(PDO::FETCH_ASSOC);
        // دمج فريد
        $merged = [];
        foreach (array_merge($accountants, $accountantsFromInvoices) as $a) {
            $merged[(int) $a['user_id']] = $a;
        }
        $accountants = array_values($merged);

        // الأطباء (role_code = 1)
        $doctors = $this->conn->query("
            SELECT u.user_id, u.full_name
            FROM users u
            JOIN roles r ON u.role_id = r.role_id
            WHERE r.role_code = 1 AND u.is_active = TRUE
            ORDER BY u.full_name
        ")->fetchAll(PDO::FETCH_ASSOC);

        // الأقسام
        $departments = $this->conn->query("
            SELECT department_id, department_name
            FROM departments
            WHERE is_active = TRUE
            ORDER BY sort_order, department_name
        ")->fetchAll(PDO::FETCH_ASSOC);

        // تصنيفات الخدمات
        $categories = $this->conn->query("
            SELECT sc.category_id, sc.category_name, sc.department_id, d.department_name
            FROM service_categories sc
            LEFT JOIN departments d ON sc.department_id = d.department_id
            WHERE sc.is_active = TRUE
            ORDER BY d.sort_order, sc.category_name
        ")->fetchAll(PDO::FETCH_ASSOC);

        // الخدمات
        $services = $this->conn->query("
            SELECT
                sm.service_id, sm.service_name, sm.category_id,
                sc.category_name, sc.department_id, d.department_name,
                sm.total_price, sm.ministry_share
            FROM services_master sm
            LEFT JOIN service_categories sc ON sm.category_id = sc.category_id
            LEFT JOIN departments d ON sc.department_id = d.department_id
            WHERE sm.is_active = TRUE
            ORDER BY sc.category_name, sm.service_name
        ")->fetchAll(PDO::FETCH_ASSOC);

        return [
            'doc_types' => [
                ['code' => 'A', 'name' => 'كاش'],
                ['code' => 'B', 'name' => 'إعفاء جزئي'],
                ['code' => 'C', 'name' => 'إعفاء كلي'],
                ['code' => 'T', 'name' => 'تذكرة معاينة'],
            ],
            'statuses' => [
                ['code' => 'paid',      'name' => 'محصّل'],
                ['code' => 'issued',    'name' => 'مُصدَر'],
                ['code' => 'cancelled', 'name' => 'ملغى'],
            ],
            'accountants' => array_map(fn($r) => [
                'id' => (int) $r['user_id'], 'name' => $r['full_name'],
            ], $accountants),
            'doctors' => array_map(fn($r) => [
                'id' => (int) $r['user_id'], 'name' => $r['full_name'],
            ], $doctors),
            'departments' => array_map(fn($r) => [
                'id' => (int) $r['department_id'], 'name' => $r['department_name'],
            ], $departments),
            'categories' => array_map(fn($r) => [
                'id'              => (int) $r['category_id'],
                'name'            => $r['category_name'],
                'department_id'   => $r['department_id'] !== null ? (int) $r['department_id'] : null,
                'department_name' => $r['department_name'] ?? null,
            ], $categories),
            'services' => array_map(fn($r) => [
                'id'              => (int) $r['service_id'],
                'name'            => $r['service_name'],
                'category_id'     => $r['category_id'] !== null ? (int) $r['category_id'] : null,
                'category_name'   => $r['category_name'] ?? null,
                'department_id'   => $r['department_id'] !== null ? (int) $r['department_id'] : null,
                'department_name' => $r['department_name'] ?? null,
                'total_price'     => (float) ($r['total_price'] ?? 0),
                'ministry_share'  => (float) ($r['ministry_share'] ?? 0),
            ], $services),
            'ticket_ministry_shares' => $this->getTicketMinistryShares(),
        ];
    }
}
