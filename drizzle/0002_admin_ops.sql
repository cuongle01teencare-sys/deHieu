CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"principal_id" text,
	"roles" jsonb NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"path" text NOT NULL,
	"params" jsonb NOT NULL,
	"body" jsonb,
	"ok" boolean NOT NULL,
	"status" integer NOT NULL,
	"error" text,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odds_transitions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "odds_transitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone NOT NULL,
	"room" text NOT NULL,
	"tenant" text NOT NULL,
	"phase" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "ops_incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text
);
--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_principal_idx" ON "audit_log" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "odds_transitions_at_idx" ON "odds_transitions" USING btree ("at");--> statement-breakpoint
CREATE INDEX "odds_transitions_room_idx" ON "odds_transitions" USING btree ("room","at");--> statement-breakpoint
CREATE INDEX "ops_incidents_opened_at_idx" ON "ops_incidents" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "ops_incidents_key_idx" ON "ops_incidents" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ops_incidents_resolved_at_idx" ON "ops_incidents" USING btree ("resolved_at");