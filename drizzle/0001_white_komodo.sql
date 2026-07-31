CREATE TABLE "pending_authorizations" (
	"whoop_state" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
