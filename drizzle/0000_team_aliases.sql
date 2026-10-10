CREATE TABLE "team_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"canonical" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "team_aliases_alias_uq" ON "team_aliases" USING btree ("alias");