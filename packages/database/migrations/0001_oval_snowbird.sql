CREATE TABLE `dev_port_slots` (
	`sandbox_id` text PRIMARY KEY NOT NULL,
	`slot` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dev_port_slots_slot_unique` ON `dev_port_slots` (`slot`);--> statement-breakpoint
CREATE INDEX `dev_port_slots_slot_idx` ON `dev_port_slots` (`slot`);