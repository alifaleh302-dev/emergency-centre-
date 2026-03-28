<?php
// controllers/DoctorController.php
require_once '../config/database.php';
require_once '../models/DoctorModel.php';

class DoctorController {
    private $model;
    private $doctor_id;

    public function __construct($doctor_id) {
        $db = (new Database())->getConnection();
        $this->model = new DoctorModel($db);
        $this->doctor_id = $doctor_id; // يتم تمريره من الـ AuthMiddleware
    }

    // 1. مسار إضافة مريض جديد
    public function newPatient($data) {
        try {
            // حساب تاريخ الميلاد تقريبياً من العمر
            $birth_date = date('Y-m-d', strtotime('-' . intval($data->age) . ' years'));
            $gender = isset($data->gender) ? ($data->gender == 'ذكر' ? 'Male' : 'Female') : 'Male';

            // إدخال المريض
            $patient_id = $this->model->createPatient($data->name, $gender, $birth_date, $data->place1, $data->place2);
            
            // جلب معرّف نوع الحالة
            $case_type_id = $this->model->getCaseTypeId($data->type_case);
            if (!$case_type_id) {
                // افتراضي في حال لم يتطابق الاسم
                $case_type_id = 1; 
            }

            // فتح الزيارة
            // داخل DoctorController.php في دالة newPatient
     try {
    // ... الكود السابق ...
          $this->model->createVisit($patient_id, $this->doctor_id, $case_type_id, $data->diagnosis, $data->note, $data->type_case);
          echo json_encode(["success" => true, "message" => "تم تسجيل المريض وفتح الزيارة بنجاح"]);
       } catch (Exception $e) {
    // التقاط خطأ الـ Trigger الخاص بالزيارة النشطة أو تكرار المريض
    $errorMsg = $e->getMessage();
    if (strpos($errorMsg, 'زيارة سابقة لا تزال نشطة') !== false) {
        $errorMsg = "لا يمكن فتح زيارة جديدة؛ المريض لديه زيارة نشطة حالياً.";
    } elseif (strpos($errorMsg, 'unique_patient_identity') !== false) {
        $errorMsg = "هذا المريض مسجل مسبقاً بنفس الاسم والعنوان.";
    }
    echo json_encode(["success" => false, "message" => $errorMsg]);
}

            echo json_encode(["success" => true, "message" => "تم إضافة المريض وفتح الزيارة بنجاح"]);
       
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }

    // 2. مسار فتح زيارة لمريض سابق
    public function existingPatientVisit($data) {
        try {
            $case_type_id = $this->model->getCaseTypeId($data->type_case) ?? 1;
            
            // تأكد من أن الـ id_pat يتم إرساله من الواجهة كأرقام، أو قم باستخراجه إذا كان يحوي حروفاً (مثل PAT-1)
            $patient_id = preg_replace('/[^0-9]/', '', $data->id_pat); 

            $this->model->createVisit($patient_id, $this->doctor_id, $case_type_id, $data->diagnosis, $data->note, $data->type_case);
            echo json_encode(["success" => true, "message" => "تم فتح الزيارة بنجاح"]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }

    // 3. مسار جلب قائمة الانتظار
    public function getWaitingList() {
        try {
            $list = $this->model->getWaitingList($this->doctor_id);
            
            // تعديل بسيط لمعرف الزيارة ليتوافق مع الواجهة
            foreach ($list as &$item) {
                $item['visit'] = 'VIS-' . $item['visit'];
            }
            echo json_encode(["success" => true, "data" => $list]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }


    // 5. مسار التشخيص النهائي وإغلاق الزيارة
    public function finalDiagnosis($data) {
        try {
            $visit_id = preg_replace('/[^0-9]/', '', $data->id_vis);
            $this->model->updateFinalDiagnosis($visit_id, $data->diagnosis);
            
            echo json_encode(["success" => true, "message" => "تم حفظ التشخيص وإغلاق الزيارة"]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }
        // مسار البحث الذكي
    public function searchPatient($data) {
        try {
            $query = isset($data->query) ? $data->query : '';
            if (strlen($query) < 2) {
                echo json_encode(["success" => true, "data" => []]);
                return;
            }
            
            $results = $this->model->searchPatient($query);
            echo json_encode(["success" => true, "data" => $results]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }

// مسار جلب الطلبات المرسلة وتفاصيلها
    public function getSentOrders() {
        try {
            $visits = $this->model->getSentOrders($this->doctor_id);
            $result = [];
            
            foreach ($visits as $v) {
                // جلب التفاصيل لكل زيارة
                $details = $this->model->getOrderDetails($v['visit_id']);
                
                $result[] = [
                    "visit" => 'VIS-' . $v['visit_id'], // <- إضافة البادئة هنا ضروري جداً
                    "name" => $v['name'],
                    "type_case" => $v['type_case'],
                    "order_count" => $v['order_count'],
                    "details" => $details
                ];
            }
            
            echo json_encode(["success" => true, "data" => $result]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }
    // 1. إضافة دالة جلب وترتيب الخدمات
    public function getServicesList() {
        try {
            $services = $this->model->getAvailableServices();
            
            // تهيئة المصفوفات لتطابق هيكلة الواجهة الأمامية
            $grouped = ['lab' => [], 'ray' => [], 'sur' => []];
            
            foreach ($services as $s) {
                $item = ['id' => $s['service_id'], 'name' => $s['service_name']];
                $dept = mb_strtolower($s['department']);
                
                // تصنيف الخدمات بناءً على القسم
                if (strpos($dept, 'laboratory') !== false || strpos($dept, 'مختبر') !== false) {
                    $grouped['lab'][] = $item;
                } elseif (strpos($dept, 'radiology') !== false || strpos($dept, 'أشعة') !== false) {
                    $grouped['ray'][] = $item;
                } elseif (strpos($dept, 'nursing') !== false || strpos($dept, 'تمريض') !== false) {
                    $grouped['sur'][] = $item;
                }
            }
            
            echo json_encode(["success" => true, "data" => $grouped]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }

    // 2. تحديث دالة إرسال الطلبات (تستقبل IDs بدلاً من أسماء)
    public function sendOrders($data) {
        try {
            $visit_id = preg_replace('/[^0-9]/', '', $data->id_vis);
            $total_invoice_price = 0;

            $invoice_id = $this->model->createPendingInvoice($visit_id);

            $all_orders_ids = array_merge($data->order->lab ?? [], $data->order->ray ?? [], $data->order->sur ?? []);

            foreach ($all_orders_ids as $service_id) {
                // نستخدم الدالة المحدثة التي تبحث بالـ ID
                $service = $this->model->getServiceDetailsById($service_id);
                if ($service) {
                    $price = $service['total_price'];
                    $this->model->addInvoiceDetail($invoice_id, $service['service_id'], $price);
                    $total_invoice_price += $price;
                }
            }

            if ($total_invoice_price > 0) {
                $this->model->updateInvoiceTotal($invoice_id, $total_invoice_price);
            }

            echo json_encode(["success" => true, "message" => "تم إرسال الطلبات وحفظها بنجاح"]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }
    
    // مسار السجل الطبي (الأرشيف)
    public function getMedicalArchive() {
        try {
            $patients = $this->model->getMedicalArchive();
            $result = [];
            
            foreach ($patients as $p) {
                // جلب الملف الطبي المفصل لكل مريض
                $medical_file = $this->model->getPatientMedicalFile($p['patient_id']);
                
                // معالجة القيم الفارغة (إذا كانت الزيارة بدون فحوصات/إجراءات)
                foreach($medical_file as &$file) {
                    $file['procedures'] = $file['procedures'] ?? 'لا يوجد إجراءات';
                }
                
                $result[] = [
                    "id_pat" => $p['patient_id'],
                    "name" => $p['name'],
                    "visit_num" => $p['visit_num'],
                    "last_visit_date" => $p['last_visit_date'],
                    "medical_file" => $medical_file
                ];
            }
            
            echo json_encode(["success" => true, "data" => $result]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }
}
?>
