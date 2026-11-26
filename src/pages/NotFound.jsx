import { Link } from 'react-router-dom';
import usePageTitle from '../components/usePageTitle.js';

export default function NotFound() {
  usePageTitle('Page not found');
  return (
    <div className="b-wrap b-page b-empty">
      <h1>Page not found</h1>
      <p>The page you're looking for isn't here.</p>
      <Link className="b-btn" to="/">Go home</Link>
    </div>
  );
}
