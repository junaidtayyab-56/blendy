import { Link } from 'react-router-dom';
import usePageTitle from '../components/usePageTitle.js';
import ProductArt from '../components/ProductArt.jsx';
import { useSettings } from '../store/settings.jsx';

const DEFAULT_ABOUT = `Blendy started with a simple idea: smoothies should taste like fruit, not syrup. Every bottle is blended from whole fruit, with nothing artificial added.

We blend in small batches so every bottle is fresh, and we deliver straight to your door.`;

const VALUES = [
  ['Real fruit', 'Whole fruit in every bottle. No concentrates, no added sugar.'],
  ['Blended fresh', 'Small batches made close to delivery, so it tastes like it should.'],
  ['Delivered to you', 'Order online and pay in cash when your smoothies arrive.'],
];

export default function About() {
  usePageTitle('About us');
  const { settings } = useSettings();
  const text = settings.about || DEFAULT_ABOUT;
  return (
    <div className="b-page">
      <section className="b-hero-band" style={{ background: '#C2B0DC' }}>
        <div className="b-wrap b-band-in">
          <div>
            <h1>About {settings.store_name || 'Blendy'}</h1>
            <p className="b-lead">{settings.tagline || 'Real fruit smoothies'}</p>
          </div>
          <div className="b-band-art">
            {['berry', 'kiwi', 'banana', 'strawberry'].map((s) => <ProductArt key={s} product={{ slug: s, name: s }} size="sm" />)}
          </div>
        </div>
      </section>
      <div className="b-wrap b-narrow b-prose">
        {text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
      </div>
      <div className="b-wrap b-values">
        {VALUES.map(([t, d]) => <div key={t} className="b-panel"><h3>{t}</h3><p className="b-muted">{d}</p></div>)}
      </div>
      <div className="b-wrap b-center b-cta"><Link className="b-btn" to="/shop">Shop smoothies</Link></div>
    </div>
  );
}
