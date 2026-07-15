CREATE TABLE "agent_loop_log_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"session_id" text,
	"request_id" text,
	"user_id" text,
	"file_path" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_loop_log_files" ADD CONSTRAINT "agent_loop_log_files_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_loop_log_files_task_id_idx" ON "agent_loop_log_files" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_loop_log_files_file_path_idx" ON "agent_loop_log_files" USING btree ("file_path");--> statement-breakpoint
CREATE INDEX "agent_loop_log_files_status_idx" ON "agent_loop_log_files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_loop_log_files_created_at_idx" ON "agent_loop_log_files" USING btree ("created_at");