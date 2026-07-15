ALTER TABLE "tasks" ADD COLUMN "client_request_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_client_request_id_unique" ON "tasks" USING btree ("client_request_id");