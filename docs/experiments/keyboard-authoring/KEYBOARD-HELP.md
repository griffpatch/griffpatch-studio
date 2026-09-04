# Keyboard guide

The first explicit activation (Keyboard button, Alt+K, or Shift-click) opens a native modal guide. The Alt+K hint is also an accessible Keyboard help button that reopens it without toggling the mode. Escape or Got it closes the guide and returns to the existing draft or structural caret.

The guide has five tabs: Quick start, Navigation, Typing, Editing, and Find & return. Each opening starts at the short quick-start summary. The panel is capped at 500px high; only the selected topic scrolls, keeping tabs and dismissal visible. Tabs support Left/Right and Home/End. It uses current theme colours and a narrow-screen single-column layout. The guide does not alter blocks or native history. Content and modal lifecycle are isolated in keyboard-help.js; the controller only supplies activation and focus handoff.

Acknowledgement is stored in localStorage per origin. If storage is blocked, it lasts for this controller session. A new review port is a new origin and therefore shows onboarding again. The hint always permits reopening. New shortcuts should update the guide alongside their implementation.

Verification: two lifecycle unit tests; two real-browser light/dark first-use, dismissal, reopen, draft preservation and narrow bounds cases; Shift-click entry and compact toolbar regression cases; three branding/editor smoke cases. No full unrelated regression suite was run. Screenshots are in .tmp/keyboard-help-evidence. The public About description also no longer mentions cross-UI visual undo/redo.
