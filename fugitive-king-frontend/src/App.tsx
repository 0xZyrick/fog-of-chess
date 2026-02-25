// Inside App.tsx

import { useState } from 'react';
import LoadingScreen from './games/fugitive-king/LoadingScreen';
import LanternChess from './games/fugitive-king/LanternChess';

export default function App() {
  const [loaded, setLoaded] = useState(false);
  return loaded
    ? <LanternChess />
    : <LoadingScreen onComplete={() => setLoaded(true)} />;
}