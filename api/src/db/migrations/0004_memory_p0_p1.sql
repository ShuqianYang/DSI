-- ============================================
-- Memory System P0+P1 Migration
-- task_conversation_snapshot + episodic_memories
-- ============================================

CREATE TABLE "task_conversation_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"query" text NOT NULL,
	"final_answer" text NOT NULL,
	"messages" jsonb NOT NULL,
	"tool_summary" jsonb DEFAULT '[]',
	"summary" text,
	"turns" integer NOT NULL,
	"stopped_by" text NOT NULL,
	"scenario" text,
	"entities" text[] DEFAULT '{}',
	"embedding" vector(1024),
	"is_checkpoint" boolean NOT NULL DEFAULT false,
	"checkpoint_turn" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_conversation_snapshot" ADD CONSTRAINT "task_conversation_snapshot_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_conv_snapshot_task_id_idx" ON "task_conversation_snapshot" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_conv_snapshot_user_id_idx" ON "task_conversation_snapshot" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_conv_snapshot_checkpoint_idx" ON "task_conversation_snapshot" USING btree ("task_id", "is_checkpoint");--> statement-breakpoint
CREATE INDEX "task_conv_snapshot_embedding_idx" ON "task_conversation_snapshot" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);--> statement-breakpoint

CREATE TABLE "episodic_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"user_id" text NOT NULL,
	"scene" text,
	"user_query" text NOT NULL,
	"tool_sequence" jsonb DEFAULT '[]',
	"final_result" text,
	"importance" double precision DEFAULT 0.5,
	"tags" text[] DEFAULT '{}',
	"related_entities" text[] DEFAULT '{}',
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episodic_memories" ADD CONSTRAINT "episodic_memories_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episodic_memories_user_id_idx" ON "episodic_memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "episodic_memories_scene_idx" ON "episodic_memories" USING btree ("scene");--> statement-breakpoint
CREATE INDEX "episodic_memories_embedding_idx" ON "episodic_memories" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
