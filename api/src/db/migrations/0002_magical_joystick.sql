CREATE TABLE "agent_transcript_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"turn" integer NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"message" jsonb,
	"messages" jsonb,
	"final_answer" text,
	"error" text,
	"stopped_by" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ais_current_states" (
	"mmsi" text PRIMARY KEY NOT NULL,
	"ship_name" text,
	"call_sign" text,
	"ship_type" integer,
	"longitude" double precision,
	"latitude" double precision,
	"sog" double precision,
	"cog" double precision,
	"heading" double precision,
	"navigational_status" integer,
	"destination" text,
	"source_time" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_transcript_entries" ADD CONSTRAINT "agent_transcript_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_transcript_entries_task_seq_idx" ON "agent_transcript_entries" USING btree ("task_id","sequence");--> statement-breakpoint
CREATE INDEX "agent_transcript_entries_task_kind_idx" ON "agent_transcript_entries" USING btree ("task_id","kind");--> statement-breakpoint
CREATE INDEX "agent_transcript_entries_created_at_idx" ON "agent_transcript_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ais_lat_idx" ON "ais_current_states" USING btree ("latitude");--> statement-breakpoint
CREATE INDEX "ais_lon_idx" ON "ais_current_states" USING btree ("longitude");--> statement-breakpoint
CREATE INDEX "ais_updated_at_idx" ON "ais_current_states" USING btree ("updated_at");