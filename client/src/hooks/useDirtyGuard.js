import { useEffect } from 'react';

export default function useDirtyGuard(isDirty) {
  useEffect(() => {
    const handler = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
