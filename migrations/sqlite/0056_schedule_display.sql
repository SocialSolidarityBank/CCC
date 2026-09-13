-- D88 / ADR-0047: all-day is independent of the stored appointment time.
ALTER TABLE counseling_schedules ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1));
ALTER TABLE counseling_schedules ADD COLUMN display_color TEXT
  CHECK (display_color IS NULL OR display_color IN ('mint', 'lavender', 'coral', 'cyan', 'light-magenta'));
