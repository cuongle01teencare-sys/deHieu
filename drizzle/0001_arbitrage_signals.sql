CREATE TABLE "arbitrage_signals" (
	"signal_id" text PRIMARY KEY NOT NULL,
	"room" text NOT NULL,
	"sport" text NOT NULL,
	"market" text NOT NULL,
	"phase" text NOT NULL,
	"combo_id" text NOT NULL,
	"teams" jsonb NOT NULL,
	"margin" double precision NOT NULL,
	"legs" jsonb NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"refresh_count" integer DEFAULT 0 NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"status" text NOT NULL,
	"status_reason" text,
	"closed_at" timestamp with time zone,
	"superseded_by" text
);
--> statement-breakpoint
CREATE INDEX "arbitrage_signals_issued_at_idx" ON "arbitrage_signals" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "arbitrage_signals_status_idx" ON "arbitrage_signals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "arbitrage_signals_room_idx" ON "arbitrage_signals" USING btree ("room");