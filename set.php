<?php
// إظهار الأخطاء للتأكد من سير العملية بشكل صحيح
ini_set('display_errors', 1);
error_reporting(E_ALL);

require_once 'config/database.php';

try {
    $database = new Database();
    $db = $database->getConnection();

    // نص استعلام SQL الخاص بـ PostgreSQL
    $sql = "
    -- 1. تعريف الأنواع المخصصة
    DO $$ BEGIN
        CREATE TYPE gender_type AS ENUM ('Male', 'Female');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
        CREATE TYPE appointment_status_type AS ENUM ('Scheduled', 'Attended', 'Missed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
        CREATE TYPE visit_status_type AS ENUM ('Active', 'Completed', 'Cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    -- 2. جدول الأدوار
    CREATE TABLE IF NOT EXISTS Roles (
      role_id SERIAL PRIMARY KEY,
      role_name VARCHAR(50) NOT NULL,
      script_url VARCHAR(255) NOT NULL
    );

    -- 3. جدول المستخدمين
    CREATE TABLE IF NOT EXISTS Users (
      user_id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(100) NOT NULL,
      role_id INT REFERENCES Roles(role_id)
    );

    -- 4. جدول المرضى
    CREATE TABLE IF NOT EXISTS Patients (
      patient_id SERIAL PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      gender gender_type,
      birth_date DATE,
      place1 VARCHAR(50),
      place2 VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_patient_identity UNIQUE (full_name, place1, place2)
    );

    -- 5. جدول أنواع الحالات الإسعافية
    CREATE TABLE IF NOT EXISTS Emergency_Case_Types (
      case_type_id SERIAL PRIMARY KEY,
      case_name VARCHAR(100) NOT NULL
    );

    -- 6. جدول الزيارات
    CREATE TABLE IF NOT EXISTS Visits (
      visit_id SERIAL PRIMARY KEY,
      patient_id INT REFERENCES Patients(patient_id),
      doctor_id INT REFERENCES Users(user_id),
      case_type_id INT REFERENCES Emergency_Case_Types(case_type_id),
      visit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notes VARCHAR(300),
      diagnosis VARCHAR(150),
      type_case VARCHAR(60),
      status visit_status_type DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 7. منطق منع فتح زيارة جديدة (Function + Trigger)
    CREATE OR REPLACE FUNCTION check_active_visit() 
    RETURNS TRIGGER AS $func$
    BEGIN
        IF EXISTS (SELECT 1 FROM Visits WHERE patient_id = NEW.patient_id AND status = 'Active') THEN
            RAISE EXCEPTION 'لا يمكن فتح زيارة جديدة لهذا المريض لأن لديه زيارة سابقة لا تزال نشطة.';
        END IF;
        RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_check_active_visit ON Visits;
    CREATE TRIGGER trg_check_active_visit
    BEFORE INSERT ON Visits
    FOR EACH ROW EXECUTE FUNCTION check_active_visit();

    -- 8. جدول أنواع المستندات
    CREATE TABLE IF NOT EXISTS Document_Types (
      doc_type_id SERIAL PRIMARY KEY,
      doc_name VARCHAR(50) NOT NULL,
      current_serial INT DEFAULT 0
    );

    -- 9. جدول الفواتير
    CREATE TABLE IF NOT EXISTS Invoices (
      invoice_id SERIAL PRIMARY KEY,
      serial_number INT NOT NULL,
      doc_type_id INT REFERENCES Document_Types(doc_type_id),
      visit_id INT REFERENCES Visits(visit_id),
      total DECIMAL(10,2),
      exemption_value DECIMAL(10,2) DEFAULT 0.00,
      net_amount DECIMAL(10,2),
      accountant_id INT REFERENCES Users(user_id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_invoice_serial UNIQUE (serial_number, doc_type_id)
    );

    -- 10. الجداول التكميلية
    CREATE TABLE IF NOT EXISTS Service_Categories (
      category_id SERIAL PRIMARY KEY,
      category_name VARCHAR(100) NOT NULL,
      department VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Services_Master (
      service_id SERIAL PRIMARY KEY,
      category_id INT REFERENCES Service_Categories(category_id),
      service_name VARCHAR(150) NOT NULL,
      center_share DECIMAL(10,2) DEFAULT 0.00,
      ministry_share DECIMAL(10,2) DEFAULT 0.00,
      total_price DECIMAL(10,2) GENERATED ALWAYS AS (center_share + ministry_share) STORED
    );

    CREATE TABLE IF NOT EXISTS Invoice_Details (
      detail_id SERIAL PRIMARY KEY,
      invoice_id INT REFERENCES Invoices(invoice_id),
      service_id INT REFERENCES Services_Master(service_id),
      service_price_at_time DECIMAL(10,2)
    );

    CREATE TABLE IF NOT EXISTS Appointments (
      appointment_id SERIAL PRIMARY KEY,
      patient_id INT REFERENCES Patients(patient_id),
      doctor_id INT REFERENCES Users(user_id),
      appointment_date TIMESTAMP NOT NULL,
      reason TEXT,
      status appointment_status_type DEFAULT 'Scheduled',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    ";

    // تنفيذ الاستعلام
    $db->exec($sql);

    echo "<h2 style='color: green;'>✅ تم إنشاء بنية قاعدة البيانات بنجاح!</h2>";
    echo "<p>يمكنك الآن البدء باستخدام النظام وحذف هذا الملف للأمان.</p>";

} catch (PDOException $e) {
    echo "<h2 style='color: red;'>❌ فشل إنشاء قاعدة البيانات:</h2>";
    echo "<pre>" . $e->getMessage() . "</pre>";
}
?>
