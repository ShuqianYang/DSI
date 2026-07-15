CREATE TABLE "aircraft_current_states" (
	"icao24" text PRIMARY KEY NOT NULL,
	"callsign" text,
	"origin_country" text,
	"longitude" double precision,
	"latitude" double precision,
	"baro_altitude" double precision,
	"velocity" double precision,
	"true_track" double precision,
	"vertical_rate" double precision,
	"on_ground" boolean DEFAULT false NOT NULL,
	"squawk" text,
	"spi" boolean DEFAULT false NOT NULL,
	"position_source" integer,
	"category" integer,
	"source_time" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"region" text DEFAULT '',
	"status" text DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX "acs_lat_idx" ON "aircraft_current_states" USING btree ("latitude");--> statement-breakpoint
CREATE INDEX "acs_lon_idx" ON "aircraft_current_states" USING btree ("longitude");--> statement-breakpoint
CREATE INDEX "acs_updated_at_idx" ON "aircraft_current_states" USING btree ("updated_at");