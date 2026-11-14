---
brand:
  name: MaiStudio
color:
  light:
    background: '#f3f4f8'
    surface: '#ffffff'
    text: '#182033'
    muted: '#596477'
    border: '#dce1eb'
    accent: '#4f46e5'
  dark:
    background: '#10121a'
    surface: '#191d2a'
    text: '#edf0f8'
    muted: '#a7b1c6'
    border: '#31384b'
    accent: '#a5a1ff'
typography:
  family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
  body: 14px
  title: 24px
spacing:
  unit: 4px
  panel: 24px
radius:
  control: 8px
  panel: 16px
motion:
  duration: 160ms
---

# Production workspace

Use a narrow navigation rail, a clear project toolbar and a dense but legible production canvas. Indigo marks the current primary action; status always includes a text label. Keep dark/light tokens centralized. Use local system fonts and icons built from simple inline SVG, avoiding network font dependencies.

Panels have subtle borders rather than large shadows; dialogs alone use elevation. Inputs have visible labels, 40px minimum action height, keyboard focus rings and explicit error text. Task tables scroll within their panel; the document must never overflow horizontally.

At 900px collapse the navigation to a drawer; at 640px stack the composer and task list and use cards for dense data. Test 1440×900 and 390×844 in both themes. Honor reduced motion. Dialogs trap focus, close on Escape, restore focus, and destructive actions require confirmation. Preview uses lazy media loading and does not auto-play.
