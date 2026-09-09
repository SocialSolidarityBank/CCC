-- Paired with SQLite 0056_schedule_display.sql (D88 / ADR-0047).
ALTER TABLE counseling_schedules ADD COLUMN all_day bigint NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1));
ALTER TABLE counseling_schedules ADD COLUMN display_color text
  CHECK (display_color IS NULL OR display_color IN ('mint', 'lavender', 'coral', 'cyan', 'light-magenta'));
