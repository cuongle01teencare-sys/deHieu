CREATE TABLE "trade_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"mode" text NOT NULL,
	"signal_id" text NOT NULL,
	"room" text NOT NULL,
	"sport" text NOT NULL,
	"market" text NOT NULL,
	"teams" jsonb NOT NULL,
	"phase" text NOT NULL,
	"combo_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"signal_margin" double precision NOT NULL,
	"tier_name" text,
	"book" jsonb,
	"polymarket" jsonb,
	"total_cost" double precision NOT NULL,
	"payout" double precision NOT NULL,
	"profit" double precision NOT NULL,
	"net_margin" double precision NOT NULL,
	"latency_ms" double precision NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mode" text NOT NULL,
	"csgoempire_account_id" text NOT NULL,
	"polymarket_account_id" text NOT NULL,
	"stake_plan" jsonb NOT NULL,
	"strategy" jsonb NOT NULL,
	"risk" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"secret_cipher" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trade_attempts_profile_created_idx" ON "trade_attempts" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "trade_attempts_created_idx" ON "trade_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trade_attempts_signal_idx" ON "trade_attempts" USING btree ("signal_id");