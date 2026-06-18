CREATE TABLE "persona_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"archetype" text NOT NULL,
	"timezone" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "persona_profile_creator_id_unique" UNIQUE("creator_id")
);
--> statement-breakpoint
ALTER TABLE "persona_profile" ADD CONSTRAINT "persona_profile_creator_id_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator"("id") ON DELETE cascade ON UPDATE no action;