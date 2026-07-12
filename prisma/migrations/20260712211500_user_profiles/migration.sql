CREATE SEQUENCE "users_uid_seq" START 1000 INCREMENT 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER TABLE "users"
    ADD COLUMN "uid" INTEGER,
    ADD COLUMN "username" VARCHAR(24),
    ADD COLUMN "username_changed_at" TIMESTAMPTZ(6),
    ADD COLUMN "deletion_requested_at" TIMESTAMPTZ(6),
    ADD COLUMN "deletion_scheduled_at" TIMESTAMPTZ(6);

UPDATE "users" SET "uid" = nextval('users_uid_seq');
UPDATE "users" SET "username" = 'user_' || "uid";

ALTER TABLE "users"
    ALTER COLUMN "uid" SET DEFAULT nextval('users_uid_seq'),
    ALTER COLUMN "uid" SET NOT NULL,
    ALTER COLUMN "username" SET NOT NULL;

ALTER SEQUENCE "users_uid_seq" OWNED BY "users"."uid";

CREATE UNIQUE INDEX "users_uid_key" ON "users"("uid");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "bio" VARCHAR(500) NOT NULL DEFAULT '',
    "website" VARCHAR(2048),
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "show_activity" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "username_aliases" (
    "id" UUID NOT NULL,
    "username" VARCHAR(24) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "username_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "username_aliases_username_key" ON "username_aliases"("username");
CREATE INDEX "username_aliases_user_created_idx" ON "username_aliases"("user_id", "created_at");

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "username_aliases" ADD CONSTRAINT "username_aliases_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION nextbuf_enforce_user_username_claim() RETURNS trigger AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."username", 1312969806));
    IF EXISTS (
        SELECT 1 FROM "username_aliases"
        WHERE "username" = NEW."username" AND "user_id" <> NEW."id"
    ) THEN
        RAISE EXCEPTION 'username is already claimed'
            USING ERRCODE = 'unique_violation', CONSTRAINT = 'users_username_namespace_key';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION nextbuf_enforce_alias_username_claim() RETURNS trigger AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."username", 1312969806));
    IF EXISTS (
        SELECT 1 FROM "users"
        WHERE "username" = NEW."username" AND "id" <> NEW."user_id"
    ) THEN
        RAISE EXCEPTION 'username is already claimed'
            USING ERRCODE = 'unique_violation', CONSTRAINT = 'username_aliases_namespace_key';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_enforce_username_claim"
BEFORE INSERT OR UPDATE OF "username" ON "users"
FOR EACH ROW EXECUTE FUNCTION nextbuf_enforce_user_username_claim();

CREATE TRIGGER "username_aliases_enforce_claim"
BEFORE INSERT OR UPDATE OF "username", "user_id" ON "username_aliases"
FOR EACH ROW EXECUTE FUNCTION nextbuf_enforce_alias_username_claim();

CREATE FUNCTION nextbuf_create_profile() RETURNS trigger AS $$
BEGIN
    INSERT INTO "profiles" ("user_id", "updated_at") VALUES (NEW."id", CURRENT_TIMESTAMP);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_create_profile"
AFTER INSERT ON "users"
FOR EACH ROW EXECUTE FUNCTION nextbuf_create_profile();

INSERT INTO "profiles" ("user_id", "updated_at")
SELECT "id", CURRENT_TIMESTAMP FROM "users"
ON CONFLICT ("user_id") DO NOTHING;
