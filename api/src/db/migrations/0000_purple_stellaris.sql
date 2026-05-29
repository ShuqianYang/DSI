CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"task_id" uuid,
	"task_name" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"gis_data" jsonb,
	"agent_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"content" text NOT NULL,
	"risk_level" text NOT NULL,
	"entity_id" text,
	"region_id" text,
	"sources" jsonb,
	"agent_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"execute_time" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"data_count" integer DEFAULT 0,
	"sub_tasks" jsonb,
	"agent_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"description" text NOT NULL,
	"chat_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requirement_id" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"schedule" text NOT NULL,
	"next_execute_time" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"entity_id" text,
	"region_id" text,
	"tool_type" text,
	"query_params" jsonb DEFAULT '{}'::jsonb,
	"last_execute_time" timestamp with time zone,
	"last_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"query" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"plan" jsonb,
	"actions" jsonb,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_task_id_job_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."job_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_agent_task_id_tasks_id_fk" FOREIGN KEY ("agent_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_agent_task_id_tasks_id_fk" FOREIGN KEY ("agent_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_agent_task_id_tasks_id_fk" FOREIGN KEY ("agent_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_user_id_idx" ON "events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_status_idx" ON "events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_read_idx" ON "events" USING btree ("read");--> statement-breakpoint
CREATE INDEX "events_timestamp_idx" ON "events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "insights_user_id_idx" ON "insights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "insights_category_idx" ON "insights" USING btree ("category");--> statement-breakpoint
CREATE INDEX "insights_risk_level_idx" ON "insights" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "job_tasks_user_id_idx" ON "job_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "job_tasks_status_idx" ON "job_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_tasks_agent_task_id_idx" ON "job_tasks" USING btree ("agent_task_id");--> statement-breakpoint
CREATE INDEX "requirements_user_id_idx" ON "requirements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "requirements_status_idx" ON "requirements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_tool_type_idx" ON "subscriptions" USING btree ("tool_type");--> statement-breakpoint
CREATE INDEX "task_steps_task_id_idx" ON "task_steps" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_steps_status_idx" ON "task_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_user_id_idx" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_created_at_idx" ON "tasks" USING btree ("created_at");