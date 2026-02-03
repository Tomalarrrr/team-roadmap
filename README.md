# Team Roadmap

A clean, minimal roadmap web app with real-time collaboration. Built with a focus on simplicity, clarity, and intuitive interactions.

## Features

**Timeline**
- Horizontally scrollable timeline with UK Financial Years (April-March)
- Zoom levels: Day / Week / Month / Year (default: 12-month rolling view)
- Vertical "Today" line showing current position
- Smooth scroll with mouse wheel or trackpad

**Projects**
- Pill-shaped bars spanning start → end dates
- Drag to move projects left/right
- Drag edges to resize (adjust start/end dates)
- Double-click to edit details
- Right-click for context menu
- Custom status colors (RGB/RGBA)

**Milestones**
- Displayed as colored segments within project bars
- Hover to see title, dates, and tags
- Double-click to edit
- Auto-blue rule: past milestones turn blue automatically
- Option to keep custom color (disable auto-blue)
- Tags for categorization

**Real-time Collaboration**
- All changes sync instantly across all users
- No sign-in required
- "Live" indicator shows connection status

## Quick Setup

### 1. Create Firebase Project (Free)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a project (disable Analytics for simplicity)
3. Go to **Build** → **Realtime Database** → Create Database
4. Choose **test mode** for quick setup
5. Go to **Project Settings** → **General** → Add web app
6. Copy the config values

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your Firebase values:

```env
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123...
VITE_FIREBASE_APP_ID=1:123...:web:abc...
```

### 3. Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Deploy to Vercel (Recommended)

1. Push to GitHub
2. Import repo at [vercel.com](https://vercel.com)
3. Add environment variables
4. Deploy

Share the URL with your team for instant collaboration.

## Usage

| Action | How |
|--------|-----|
| Add project | Click "Add Project" button |
| Add milestone | Right-click project → Add Milestone |
| Edit project | Double-click project bar |
| Edit milestone | Double-click milestone |
| Move project | Drag project bar left/right |
| Resize project | Drag left/right edge |
| Delete | Right-click → Delete |
| Change zoom | Click Day/Week/Month/Year buttons |

## Auto-blue Rule

When today's date passes a milestone's end date, it automatically turns blue to indicate completion. To keep your custom color, check "Keep this color" when editing the milestone.

## Tech Stack

- React 19 + TypeScript + Vite
- Firebase Realtime Database
- date-fns
- CSS Modules
