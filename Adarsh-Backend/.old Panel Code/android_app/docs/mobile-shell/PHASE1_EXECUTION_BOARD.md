# Phase 1 Execution Board - Mobile PWA Shell

## Timeline Target
- Planned duration: 4 working days

## Work Items
### Day 1: Decision Freeze
- [ ] Confirm Capacitor shell strategy
- [ ] Confirm app package/bundle naming
- [ ] Confirm production PWA entry URL
- [ ] Confirm owner list and approvals path

### Day 2: Behavior Matrix
- [ ] Define launch and navigation rules
- [ ] Define auth/session edge-case UX
- [ ] Define offline and reconnect UX
- [ ] Define Android back-button behavior

### Day 3: Compliance and Store Inputs
- [ ] Draft Play data safety content
- [ ] Draft iOS privacy labels content
- [ ] Draft app listing copy and support details
- [ ] Draft reviewer notes + demo-account plan

### Day 4: Sign-Off and Phase 2 Handoff
- [ ] Select native value-add for v1
- [ ] Record unresolved risks
- [ ] Approve Phase 2 backlog and estimates
- [ ] Mark Phase 1 exit gate as complete

## Open Questions
1. Do we need push notifications in v1 or v1.1?
2. Do we require biometric lock at launch or later?
3. Should app permit only production domain, or also staging in internal builds?
4. Who owns release notes and screenshot assets each sprint?

## Risks
1. iOS review may reject if app appears only as website wrapper without native value.
2. Session/cookie behavior may differ in embedded webview.
3. Store metadata delays can block release even when code is ready.

## Blockers Log
- None recorded yet.
