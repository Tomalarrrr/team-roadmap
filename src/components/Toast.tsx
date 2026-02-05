import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './Toast.module.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  duration?: number;
}

interface ToastOptions {
  type?: ToastType;
  action?: ToastAction;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, typeOrOptions?: ToastType | ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, typeOrOptions?: ToastType | ToastOptions) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Handle both old API (type string) and new API (options object)
    let type: ToastType = 'info';
    let action: ToastAction | undefined;
    let duration: number | undefined;

    if (typeof typeOrOptions === 'string') {
      type = typeOrOptions;
    } else if (typeOrOptions) {
      type = typeOrOptions.type || 'info';
      action = typeOrOptions.action;
      duration = typeOrOptions.duration;
    }

    setToasts(prev => [...prev, { id, message, type, action, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <div className={styles.container} role="region" aria-live="polite" aria-label="Notifications">
          {toasts.map(toast => (
            <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  toast: ToastMessage;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Custom duration, or default: errors 4s, toasts with actions 5s, others 2.5s
    const duration = toast.duration ||
      (toast.type === 'error' ? 4000 : toast.action ? 5000 : 2500);
    const timer = setTimeout(() => {
      setIsExiting(true);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.type, toast.action, toast.duration]);

  useEffect(() => {
    if (isExiting) {
      const timer = setTimeout(() => {
        onRemove(toast.id);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isExiting, onRemove, toast.id]);

  const handleAction = () => {
    if (toast.action) {
      toast.action.onClick();
      setIsExiting(true);
    }
  };

  const icon = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  }[toast.type];

  return (
    <div
      className={`${styles.toast} ${styles[toast.type]} ${isExiting ? styles.exiting : ''}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
    >
      <span className={styles.icon}>{icon}</span>
      <span className={styles.message}>{toast.message}</span>
      {toast.action && (
        <button className={styles.actionBtn} onClick={handleAction}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
