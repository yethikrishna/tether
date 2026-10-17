# Pip - static fallback assets

Pre-rendered PNG frames of Pip, one per mascot state, exported from the
live component (`src/client/pip/pip.js`) at 256px on transparency.

| File | Mascot state | App states (from `getMascotState` in `src/domain.js`) |
|---|---|---|
| `pip-idle.png` | `idle` | `draft` |
| `pip-notice.png` | `notice` | `dispatching` |
| `pip-thinking.png` | `thinking` | `working` |
| `pip-needs_you.png` | `needs_you` | `waiting_for_user` |
| `pip-success_soft.png` | `success_soft` | `completed_fo_reported` |
| `pip-uncertain.png` | `uncertain` | `failed_fo_reported`, `connection_interrupted`, `outcome_unknown` |
| `pip-sleep.png` | `sleep` | `locally_stopped_observing` |

Use these when animation, JavaScript, or SVG SMIL/CSS motion is
unavailable, or when the user enables "Keep Pip still" /
`prefers-reduced-motion`. The live component already falls back to a
static pose under reduced motion; these files are for non-JS contexts
(email digests, notifications, README, marketing).

Pip is an original character created for this hackathon project. It is
not derived from Wajo, Meta/Muse, Aave, or any other mascot. No
trademark search has been performed on the name "Pip" (provisional).

A Blender-authored GLB remains the preferred long-term asset
(directive §4.2); this SVG/PNG character is the deliberately designed
low-poly-equivalent fallback the directive sanctions when a polished 3D
model cannot be made inside the sprint.
