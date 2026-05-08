---
title: "implement: portal data structure with destination times and stubbed lit/dark (REQ-005 / REQ-009 / REQ-010)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T02:53:20.194320-05:00"
---

Introduce a Portal type pairing each Door (N/E/S/W) with a destination normalized time and a stubbed lit/dark flag. Add src/sim/portals.ts exporting a PortalConfig and a default config matching the GDD's 5:00 timeline (REQ-013/REQ-014: South lit -> 12:00, East lit -> 6:00, North dark, West dark). The lit/dark field is a stub for this slice; the dynamic computation from arrivals (REQ-011) lands later. Wire the door render to read its lit/dark stub from the portal config so REQ-027 doors visibly differentiate. Tests: portal lookup by direction returns expected destination and lit state; default config matches the GDD's 5:00 anchors. Verify: npm test, npm run build, em-dash grep, git diff --check.
