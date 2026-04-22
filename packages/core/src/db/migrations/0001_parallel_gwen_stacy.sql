ALTER TABLE `ideas` ADD `archived_by_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `ideas` ADD `archive_rationale` text;--> statement-breakpoint
ALTER TABLE `observations` ADD `archived_by_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `observations` ADD `archive_rationale` text;