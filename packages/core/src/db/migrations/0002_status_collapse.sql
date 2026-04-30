ALTER TABLE `problems` ADD `status` text;--> statement-breakpoint
UPDATE `problems` SET `status` = 'done' WHERE `lifecycle_status` = 'shipped';--> statement-breakpoint
UPDATE `problems` SET `status` = 'abandoned' WHERE `lifecycle_status` = 'abandoned';--> statement-breakpoint
UPDATE `problems` SET `status` = 'done'
WHERE `lifecycle_status` = 'committed'
  AND `id` IN (
    SELECT DISTINCT s.problem_id FROM solutions s
    INNER JOIN outcomes o ON o.solution_id = s.id
    WHERE s.status = 'shipped'
  );--> statement-breakpoint
UPDATE `problems` SET `status` = 'now' WHERE `lifecycle_status` = 'committed' AND `status` IS NULL;--> statement-breakpoint
UPDATE `problems` SET `status` = 'now' WHERE `lifecycle_status` = 'shipping' AND `status` IS NULL;--> statement-breakpoint
ALTER TABLE `problems` DROP COLUMN `lifecycle_status`;--> statement-breakpoint
ALTER TABLE `problems` DROP COLUMN `priority_tier`;