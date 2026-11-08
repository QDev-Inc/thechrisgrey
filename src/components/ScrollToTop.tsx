import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { useLenisContext } from '../hooks/useLenis';

const positions = new Map<string, number>();

const ScrollToTop = () => {
  const { pathname, key } = useLocation();
  const navigationType = useNavigationType();
  const { lenis } = useLenisContext();

  useLayoutEffect(() => {
    const top = navigationType === 'POP' ? positions.get(key) || 0 : 0;
    const restore = () => {
      if (lenis) lenis.scrollTo(top, { immediate: true });
      else window.scrollTo({ top, left: 0, behavior: 'instant' });
    };
    restore();
    const frame = requestAnimationFrame(restore);
    const remember = () => {
      positions.set(key, window.scrollY);
      if (positions.size > 100) positions.delete(positions.keys().next().value!);
    };
    window.addEventListener('scroll', remember, { passive: true });
    if (navigationType === 'PUSH') {
      const main = document.querySelector('main');
      main?.setAttribute('tabindex', '-1');
      main?.focus({ preventScroll: true });
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', remember);
    };
  }, [pathname, key, navigationType, lenis]);

  return null;
};

export default ScrollToTop;
