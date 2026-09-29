CREATE TABLE "recipe_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
