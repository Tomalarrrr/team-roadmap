// Local dev preview harness for Slugs (scratch, not shipped). Mounts the game
// on its own, without the roadmap or its lock. Open /slugs-preview.html under
// `npm run dev`; ?slugs=CODE is passed through as an invite, and ?as=NAME
// makes this tab its own person, so two tabs can be the two players.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { SlugsGame } from './components/slugs/SlugsGame';

const query = new URLSearchParams(window.location.search);
const invite = query.get('slugs');
const as = query.get('as');
if (as) {
  sessionStorage.setItem('roadmap-user-id', `preview-${as}`);
  sessionStorage.setItem('roadmap-user-name', as);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SlugsGame onClose={() => {}} isSearchOpen={false} inviteCode={invite} />
  </StrictMode>
);
