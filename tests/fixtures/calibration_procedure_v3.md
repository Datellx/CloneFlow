# Arm calibration procedure - v3

Owner: Avery Brooks | Station: Line 2, bench 3 | Last updated: 2024-07-12

Applies to: SO-ARM101 follower arms, 7.4 V and 12 V variants.

## Equipment
- Calibration jig (aluminum base plate with dowel pins) on bench 3
- Station laptop (LeRobot installed, env from arm-config)
- Waveshare bus servo driver board + short shielded USB cable
- 12 V / 7.4 V bench supply with selector switch
- Reference arm (on the left dowels - do not move)

## Steps
1. Set the supply selector to match the arm variant (check the label under the base).
2. Seat the arm base on the jig dowels and tighten the two thumb screws.
3. Connect the servo bus cable to the driver board and power on.
4. Put the arm in the rest pose (folded, gripper closed).
5. Run:
   `lerobot-calibrate --robot.type=so101_follower --robot.port=/dev/ttyACM0 --robot.id=<arm serial>`
6. When prompted, move the arm to the middle of its range and press Enter.
7. Move each joint slowly through its full range of motion, then press Enter.
8. Run `python tools/check_pose.py --serial <arm serial>` to compare with the reference pose.
9. Pass if every joint is within 1.5 degrees. Record the result in this week's log
   (see test_log_format.md).
10. Copy the calibration JSON to `calibration/<arm serial>.json` on the share.

## If it fails
- Re-seat the arm on the jig and repeat from step 4 once.
- Second fail: tag the arm, put it on the red shelf, write the joint in the notes column.

## Change log
- v3 (2024-07-12): moved to bench 3 jig, added check_pose.py
- v2 (2023-07-07): moved from Line 1 to Line 2
- v1 (2022-05): first version
