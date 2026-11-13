# 0003: New decks start as draft bundles

Date: 2026-11-13. Status: accepted.

**Decision.** A new deck is created immediately as a bundle in the app data folder (`drafts/Untitled-<timestamp>.stagekeys`). Save As copies the bundle to the chosen place and deletes the draft.

**Why.** Autosave and image import both need a folder to write into. Giving every deck one from the first second means there is no "unsaved, nowhere to autosave" state, and crash recovery is simply "list the drafts".

**Consequences.**

- The welcome screen lists edited drafts so nothing is lost if the app is closed without saving.
- A draft that was never edited is deleted when you open or create another deck, or quit. Edited drafts are never deleted automatically.
