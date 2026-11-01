# SO-ARM101 assembly guide - v5

Owner: Linda Sorensen (production) | Released: 2025-02-24

Printed copies on Line 1 and Line 2. Photos are in assembly_guide_v5_photos/ on the share.

## 1. Before you start
- Check servo lot labels against the incoming inspection log. Do not use servos from a lot on HOLD.
- 12 V and 7.4 V servos look identical. Check the label (12 V servos have "C018" on the sticker).

## 2. Servo prep
1. Set servo IDs 1-6 with the ID tool before mounting (1 = shoulder_pan ... 6 = gripper).
2. Fit the servo horn on the output spline, horn mark aligned with the servo case mark.

## 3. Build order
Base -> shoulder_pan -> shoulder_lift -> upper arm -> elbow_flex -> forearm -> wrist_flex -> wrist_roll -> gripper.
Route the bus cable through the clips on each link before closing the covers.

## 4. Torque table
| Joint / part                     | Screw     | Torque    |
|----------------------------------|-----------|-----------|
| Base plate to base               | M4 x 10   | 1.2 N·m   |
| Servo to bracket (all joints)    | M2 x 6    | 0.25 N·m  |
| Servo horn screw (all servos)    | M3 x 6    | 0.4 N·m   |
| Link covers                      | M2 x 8    | 0.2 N·m   |
| Gripper fixed jaw                | M3 x 10   | 0.5 N·m   |

Use the yellow torque drivers. Blue thread lock on horn screws.

## 5. Gripper assembly
1. Mount the gripper servo in the fixed jaw housing.
2. Fit the moving jaw onto the horn, check it opens fully without hitting the housing.

## 6. Final checks
- Every joint moves freely by hand with power off.
- Cable not pinched at the wrist roll.
- Label with serial (WR-101-YY-NNNN) under the base.
