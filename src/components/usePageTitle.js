import { useEffect } from 'react';

export default function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | Blendy` : 'Blendy — Real fruit smoothies';
  }, [title]);
}
