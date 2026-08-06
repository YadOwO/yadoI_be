CREATE SCHEMA "yadoi";
--> statement-breakpoint
CREATE TABLE "yadoi"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "yadoi"."items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"icon_type" text,
	"icon_value" text,
	"status" text DEFAULT 'in_service' NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"note" text,
	"purchase_price" numeric(12, 2),
	"sale_price" numeric(12, 2),
	"purchased_at" date,
	"sold_at" date,
	"warranty_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "items_icon_pair_ck" CHECK (("yadoi"."items"."icon_type" is null) = ("yadoi"."items"."icon_value" is null))
);
--> statement-breakpoint
ALTER TABLE "yadoi"."items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "yadoi"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_user_updated_idx" ON "yadoi"."categories" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_uniq" ON "yadoi"."categories" USING btree ("user_id","name") WHERE "yadoi"."categories"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "items_user_updated_idx" ON "yadoi"."items" USING btree ("user_id","updated_at");