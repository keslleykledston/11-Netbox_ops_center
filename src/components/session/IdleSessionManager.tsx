import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_MS = 30 * 1000; // 30 seconds

export default function IdleSessionManager() {
  const [warning, setWarning] = useState(false);
  const [remaining, setRemaining] = useState<number>(Math.floor(WARNING_MS / 1000));
  const idleTimer = useRef<number | null>(null);
  const warningTimer = useRef<number | null>(null);
  const countdownTimer = useRef<number | null>(null);
  const warningDeadline = useRef<number | null>(null);

  const clearTimers = () => {
    if (idleTimer.current) { window.clearTimeout(idleTimer.current); idleTimer.current = null; }
    if (warningTimer.current) { window.clearTimeout(warningTimer.current); warningTimer.current = null; }
    if (countdownTimer.current) { window.clearInterval(countdownTimer.current); countdownTimer.current = null; }
    warningDeadline.current = null;
  };

  const scheduleIdle = () => {
    clearTimers();
    idleTimer.current = window.setTimeout(() => {
      // Trigger warning phase
      setWarning(true);
      setRemaining(Math.floor(WARNING_MS / 1000));
      warningDeadline.current = Date.now() + WARNING_MS;
      countdownTimer.current = window.setInterval(() => {
          if (!warningDeadline.current) return;
          const diff = Math.max(0, warningDeadline.current - Date.now());
          setRemaining(Math.ceil(diff / 1000));
      }, 1000);
      warningTimer.current = window.setTimeout(() => doLogout(), WARNING_MS);
    }, IDLE_TIMEOUT_MS);
  };

  const onInteract = () => {
    if (warning) {
      // Cancel warning and keep user logged in
      setWarning(false);
    }
    scheduleIdle();
  };

  const doLogout = () => {
    clearTimers();
    try { localStorage.removeItem('auth_token'); } catch {}
    if (typeof window !== 'undefined') window.location.replace('/login');
  };

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, onInteract, { passive: true }));
    scheduleIdle();
    return () => {
      events.forEach((e) => window.removeEventListener(e, onInteract as any));
      clearTimers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!warning) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center p-3">
      <div className="flex items-center gap-3 rounded-md border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-lg">
        <span className="text-sm text-foreground">
          Sessão inativa. Desconectando em {remaining}s.
        </span>
        <Button size="sm" onClick={onInteract}>
          Continuar sessão
        </Button>
        <Button size="sm" variant="destructive" onClick={doLogout}>
          Sair agora
        </Button>
      </div>
    </div>
  );
}
