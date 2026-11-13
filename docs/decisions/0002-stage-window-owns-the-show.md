# 0002: The stage window owns the show

Date: 2026-11-13. Status: accepted.

**Decision.** During a show, the fullscreen stage window holds a frozen copy of the deck, opens MIDI itself, runs the mapping engine and renders. The control window becomes a presenter view that only subscribes to status and forwards button and key presses as actions. The stage window is plain TypeScript with no React.

**Why.** The audience sees the stage window. If MIDI and show state lived in the control window, a crash or hang in the presenter view (the part with the most UI code) would freeze the slides. This way it cannot.

**Consequences.**

- Edits made while a show is running do not appear on stage until the next show. That is intended.
- The two windows talk through small validated messages relayed by main. This was planned as a direct MessagePort, but nothing time-critical crosses the link, so the simpler relay was used.
- Main remembers the current slide index and reloads a dead stage renderer on that slide (up to five times).
- The control window releases MIDI when a show starts and takes it back when the show ends.
