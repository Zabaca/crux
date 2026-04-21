CREATE TABLE `abandonments` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`rationale` text NOT NULL,
	`abandoned_by_id` text NOT NULL,
	`abandoned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`abandoned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `abandonments_problem_id_unique` ON `abandonments` (`problem_id`);--> statement-breakpoint
CREATE TABLE `decision_rejected_solutions` (
	`decision_id` text NOT NULL,
	`solution_id` text NOT NULL,
	PRIMARY KEY(`decision_id`, `solution_id`),
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`chosen_solution_id` text NOT NULL,
	`rationale` text NOT NULL,
	`context` text,
	`decided_by_id` text NOT NULL,
	`supersedes_decision_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chosen_solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `elimination_solutions` (
	`elimination_id` text NOT NULL,
	`solution_id` text NOT NULL,
	PRIMARY KEY(`elimination_id`, `solution_id`),
	FOREIGN KEY (`elimination_id`) REFERENCES `eliminations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `eliminations` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`rationale` text NOT NULL,
	`context` text,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`note` text,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `observations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_obs_problem_unique` ON `evidence` (`observation_id`,`problem_id`);--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`workstream_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`hypothesized_problem_area` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`workstream_id`) REFERENCES `workstreams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ideas_slug_unique` ON `ideas` (`slug`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`workstream_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`content` text NOT NULL,
	`source` text,
	`source_type` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`workstream_id`) REFERENCES `workstreams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `outcome_follow_up_problems` (
	`outcome_id` text NOT NULL,
	`problem_id` text NOT NULL,
	PRIMARY KEY(`outcome_id`, `problem_id`),
	FOREIGN KEY (`outcome_id`) REFERENCES `outcomes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`solution_id` text NOT NULL,
	`observed_impact` text NOT NULL,
	`expected_impact` text,
	`learnings` text,
	`recorded_by_id` text NOT NULL,
	`observed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outcomes_solution_id_unique` ON `outcomes` (`solution_id`);--> statement-breakpoint
CREATE TABLE `problems` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`workstream_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`lifecycle_status` text DEFAULT 'shaping' NOT NULL,
	`priority_tier` text,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workstream_id`) REFERENCES `workstreams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problems_slug_unique` ON `problems` (`slug`);--> statement-breakpoint
CREATE TABLE `solutions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`problem_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`effort` text,
	`originating_idea_id` text,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`originating_idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solutions_slug_unique` ON `solutions` (`slug`);--> statement-breakpoint
CREATE TABLE `theme_solutions` (
	`theme_id` text NOT NULL,
	`solution_id` text NOT NULL,
	PRIMARY KEY(`theme_id`, `solution_id`),
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`workstream_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`timeframe` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workstream_id`) REFERENCES `workstreams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `themes_slug_unique` ON `themes` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_slug_unique` ON `users` (`slug`);--> statement-breakpoint
CREATE TABLE `workstreams` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`owner_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workstreams_slug_unique` ON `workstreams` (`slug`);