# Test log format (Line 2 calibration)

One CSV per ISO week: `test_logs/<year>-W<week>_line2.csv`. One row per calibration run
(re-runs get their own row).

| Column | Meaning |
|---|---|
| date | YYYY-MM-DD |
| time | HH:MM, local |
| arm_serial | WR-101-YY-NNNN |
| variant | 12V or 7V4 |
| bench | always 3 for the calibration station |
| shoulder_pan ... gripper | offset from reference pose after calibration, degrees |
| max_abs_err | largest absolute offset of the six joints |
| result | PASS if max_abs_err <= 1.5, else FAIL |
| tech | initials |
| notes | anything worth writing down (re-seated cable, lot number, etc.) |
