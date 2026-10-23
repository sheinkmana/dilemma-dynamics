import { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './dilemma.css';
import { StudyReplay } from './StudyReplay.js';
import { StudyResults } from './StudyResults.js';

// This entry imports only the recorded study UI, never the local server controls.
function pageFromHash() {
  return window.location.hash === '#results' ? 'results' : 'replay';
}

function PublicDemo() {
  const [page, setPage] = useState(pageFromHash);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('game-field-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    const navigate = () => setPage(pageFromHash());
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0c1225' : '#e9eaf0');
    try {
      localStorage.setItem('game-field-theme', theme);
    } catch {}
  }, [theme]);

  const navigation = (
    <nav className="domain-nav" aria-label="Project sections">
      <button
        aria-pressed={page === 'replay'}
        onClick={() => {
          window.location.hash = 'replay';
        }}
      >
        Study replay
      </button>
      <button
        aria-pressed={page === 'results'}
        onClick={() => {
          window.location.hash = 'results';
        }}
      >
        Results
      </button>
    </nav>
  );
  const props = { navigation, theme, setTheme };
  return page === 'results' ? <StudyResults {...props} /> : <StudyReplay {...props} />;
}

createRoot(document.getElementById('root')!).render(<PublicDemo />);
