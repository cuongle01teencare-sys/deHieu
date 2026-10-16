CREATE TABLE "trade_settlements" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"mode" text NOT NULL,
	"winner" text NOT NULL,
	"poly_price" double precision NOT NULL,
	"book_result" text NOT NULL,
	"book_pnl" double precision NOT NULL,
	"poly_pnl" double precision NOT NULL,
	"pnl" double precision NOT NULL,
	"source" text NOT NULL,
	"by" text,
	"resolved_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trade_settlements_profile_idx" ON "trade_settlements" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "trade_attempts_empire_account_created_idx" ON "trade_attempts" USING btree ("csgoempire_account_id","created_at");--> statement-breakpoint
CREATE INDEX "trade_attempts_poly_account_created_idx" ON "trade_attempts" USING btree ("polymarket_account_id","created_at");