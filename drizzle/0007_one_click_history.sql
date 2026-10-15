CREATE TABLE "one_click_history" (
	"profile_id" text NOT NULL,
	"signal_id" text NOT NULL,
	"room" text NOT NULL,
	"sport" text NOT NULL,
	"market" text NOT NULL,
	"phase" text NOT NULL,
	"combo_id" text NOT NULL,
	"teams" jsonb NOT NULL,
	"signal_margin" double precision NOT NULL,
	"tier_name" text,
	"min_ask" double precision,
	"threshold" double precision,
	"analysis" jsonb NOT NULL,
	"updates" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"entered_by" text,
	CONSTRAINT "one_click_history_profile_id_signal_id_pk" PRIMARY KEY("profile_id","signal_id")
);
--> statement-breakpoint
CREATE INDEX "one_click_history_profile_first_idx" ON "one_click_history" USING btree ("profile_id","first_at");--> statement-breakpoint
CREATE INDEX "one_click_history_first_idx" ON "one_click_history" USING btree ("first_at");