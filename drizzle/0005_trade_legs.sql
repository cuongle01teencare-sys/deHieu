CREATE TABLE "trade_legs" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"mode" text NOT NULL,
	"venue" text NOT NULL,
	"account_id" text,
	"side" integer NOT NULL,
	"pick" text NOT NULL,
	"signal_price" double precision NOT NULL,
	"requested_price" double precision NOT NULL,
	"requested_amount" double precision NOT NULL,
	"filled_amount" double precision NOT NULL,
	"avg_price" double precision NOT NULL,
	"fee" double precision NOT NULL,
	"cost" double precision NOT NULL,
	"status" text NOT NULL,
	"market_ref" text,
	"order_ref" text,
	"sent_at" timestamp with time zone,
	"acked_at" timestamp with time zone,
	"filled_at" timestamp with time zone,
	"error" text,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trade_attempts" ADD COLUMN "csgoempire_account_id" text;--> statement-breakpoint
ALTER TABLE "trade_attempts" ADD COLUMN "polymarket_account_id" text;--> statement-breakpoint
ALTER TABLE "trade_attempts" ADD COLUMN "signal_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trade_attempts" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trade_attempts" ADD COLUMN "market_data_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trade_attempts" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "trade_legs_attempt_idx" ON "trade_legs" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "trade_legs_venue_created_idx" ON "trade_legs" USING btree ("venue","created_at");--> statement-breakpoint
CREATE INDEX "trade_legs_account_created_idx" ON "trade_legs" USING btree ("account_id","created_at");