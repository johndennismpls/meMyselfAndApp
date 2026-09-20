CREATE TABLE "recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text,
	"servings" integer,
	"yield_text" text,
	"prep_minutes" integer,
	"cook_minutes" integer,
	"total_minutes" integer,
	"image_filename" text,
	"image_mime_type" text,
	"request_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Home tiles come from GET /apps, so /recipes needs a row to be reachable (§9.1).
INSERT INTO "apps" ("name", "display_name") VALUES ('recipebox', 'Recipe Box');
