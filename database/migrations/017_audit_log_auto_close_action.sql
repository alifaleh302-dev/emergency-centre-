BEGIN;

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_action_check
    CHECK (
        (action)::text = ANY (ARRAY[
            'CREATE'::varchar,
            'UPDATE'::varchar,
            'DELETE'::varchar,
            'LOGIN'::varchar,
            'LOGOUT'::varchar,
            'CANCEL'::varchar,
            'EXPORT'::varchar,
            'IMPORT'::varchar,
            'VIEW'::varchar,
            'REOPEN'::varchar,
            'AUTO_CLOSE'::varchar,
            'OTHER'::varchar
        ]::text[])
    );

COMMIT;
