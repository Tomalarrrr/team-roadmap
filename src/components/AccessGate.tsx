// Imports needed when PIN authentication is enabled
// import { useState, useEffect } from 'react';
// import styles from './AccessGate.module.css';

interface AccessGateProps {
  children: React.ReactNode;
}

// PIN configuration - disabled for now
// const TEAM_PIN = import.meta.env.VITE_TEAM_PIN || 'TEAM2024';
// const STORAGE_KEY = 'roadmap-team-access';

export function AccessGate({ children }: AccessGateProps) {
  // PIN authentication disabled for now
  // To re-enable: uncomment the imports/constants above and the code below, then remove the direct return

  return <>{children}</>;

  /* PIN AUTHENTICATION - CURRENTLY DISABLED
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if already authenticated
    const storedAccess = sessionStorage.getItem(STORAGE_KEY);
    if (storedAccess === 'granted') {
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (pin.toUpperCase().trim() === TEAM_PIN) {
      sessionStorage.setItem(STORAGE_KEY, 'granted');
      setIsAuthenticated(true);
      setError('');
    } else {
      setError('Invalid team PIN. Please try again.');
      setPin('');
    }
  };

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className={styles.gate}>
        <div className={styles.card}>
          <div className={styles.header}>
            <h1>Digital Roadmap Overview</h1>
            <p>Team Access Required</p>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="pin">Enter Team PIN</label>
              <input
                id="pin"
                type="text"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN"
                autoFocus
                autoComplete="off"
                className={styles.input}
              />
              {error && <span className={styles.error}>{error}</span>}
            </div>

            <button type="submit" className={styles.button}>
              Access Roadmap
            </button>
          </form>

          <div className={styles.footer}>
            <p>Need access? Contact your team lead for the PIN.</p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
  */
}
