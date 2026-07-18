-- The historical v0.5.0 migration is frozen. Rebase an untouched sequence
-- for new installations without changing UIDs that have already been public.
DO $$
DECLARE
    current_last_value BIGINT;
    current_is_called BOOLEAN;
    largest_existing_uid BIGINT;
BEGIN
    SELECT last_value, is_called
    INTO current_last_value, current_is_called
    FROM "users_uid_seq";

    SELECT MAX("uid")
    INTO largest_existing_uid
    FROM "users";

    IF largest_existing_uid IS NULL
       AND current_last_value = 1000
       AND NOT current_is_called THEN
        PERFORM setval('users_uid_seq', 1, false);
    ELSE
        PERFORM setval(
            'users_uid_seq',
            GREATEST(current_last_value, COALESCE(largest_existing_uid, 0)),
            current_is_called OR largest_existing_uid IS NOT NULL
        );
    END IF;
END;
$$;

ALTER TABLE "users"
    ADD CONSTRAINT "users_uid_positive" CHECK ("uid" > 0);
