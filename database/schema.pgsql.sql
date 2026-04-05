BEGIN;

CREATE TABLE IF NOT EXISTS Roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(120) NOT NULL UNIQUE,
    script_url VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS Users (
    user_id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL REFERENCES Roles(role_id) ON DELETE RESTRICT,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Patients (
    patient_id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    gender VARCHAR(20) NOT NULL,
    birth_date DATE,
    place1 VARCHAR(150) DEFAULT '',
    place2 VARCHAR(150) DEFAULT '',
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Emergency_Case_Types (
    case_type_id SERIAL PRIMARY KEY,
    case_name VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS Visits (
    visit_id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES Patients(patient_id) ON DELETE CASCADE,
    doctor_id INTEGER NOT NULL REFERENCES Users(user_id) ON DELETE RESTRICT,
    case_type_id INTEGER REFERENCES Emergency_Case_Types(case_type_id) ON DELETE SET NULL,
    type_case VARCHAR(120) NOT NULL,
    diagnosis VARCHAR(255) DEFAULT '',
    notes TEXT DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Document_Types (
    doc_type_id SERIAL PRIMARY KEY,
    doc_name VARCHAR(10) NOT NULL UNIQUE,
    current_serial INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Service_Categories (
    category_id SERIAL PRIMARY KEY,
    department VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS Services_Master (
    service_id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES Service_Categories(category_id) ON DELETE RESTRICT,
    service_name VARCHAR(150) NOT NULL,
    total_price NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Invoices (
    invoice_id SERIAL PRIMARY KEY,
    serial_number INTEGER NOT NULL DEFAULT 0,
    visit_id INTEGER NOT NULL REFERENCES Visits(visit_id) ON DELETE CASCADE,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    exemption_value NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    doc_type_id INTEGER REFERENCES Document_Types(doc_type_id) ON DELETE SET NULL,
    accountant_id INTEGER REFERENCES Users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Invoice_Details (
    detail_id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES Invoices(invoice_id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES Services_Master(service_id) ON DELETE RESTRICT,
    service_price_at_time NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Medical_Results (
    result_id SERIAL PRIMARY KEY,
    visit_id INTEGER NOT NULL REFERENCES Visits(visit_id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES Services_Master(service_id) ON DELETE RESTRICT,
    result_text TEXT DEFAULT '',
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON Users(username);
CREATE INDEX IF NOT EXISTS idx_patients_full_name ON Patients(full_name);
CREATE INDEX IF NOT EXISTS idx_visits_patient_id ON Visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_doctor_id_status ON Visits(doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_visit_id ON Invoices(visit_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON Invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoice_details_invoice_id ON Invoice_Details(invoice_id);
CREATE INDEX IF NOT EXISTS idx_medical_results_visit_service ON Medical_Results(visit_id, service_id);

INSERT INTO Roles (role_name, script_url)
VALUES
    ('طبيب عام', 'doctor_module.js'),
    ('أمين صندوق', 'accounting_module.js')
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO Document_Types (doc_name, current_serial)
VALUES ('A', 0), ('B', 0), ('C', 0)
ON CONFLICT (doc_name) DO NOTHING;

COMMIT;
