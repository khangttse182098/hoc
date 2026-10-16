import { useEffect, useState } from 'react';

export type Route =
  | { view: 'home' }
  | { view: 'author'; examId: string }
  | { view: 'student'; examId: string }
  | { view: 'results'; examId: string; attemptId: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'author' && parts[1]) return { view: 'author', examId: parts[1] };
  if (parts[0] === 'student' && parts[1]) return { view: 'student', examId: parts[1] };
  if (parts[0] === 'results' && parts[1] && parts[2]) return { view: 'results', examId: parts[1], attemptId: parts[2] };
  return { view: 'home' };
}

export function routeToHash(route: Route): string {
  switch (route.view) {
    case 'home':
      return '#/';
    case 'author':
      return `#/author/${encodeURIComponent(route.examId)}`;
    case 'student':
      return `#/student/${encodeURIComponent(route.examId)}`;
    case 'results':
      return `#/results/${encodeURIComponent(route.examId)}/${encodeURIComponent(route.attemptId)}`;
  }
}

export function navigate(route: Route) {
  window.location.hash = routeToHash(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
