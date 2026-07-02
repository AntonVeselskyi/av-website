import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import DictionaryPage from './pages/DictionaryPage'
import GraphPage from './pages/GraphPage'
import AchievementsPage from './pages/AchievementsPage'
import LearnPage from './pages/LearnPage'
import TestPage from './pages/TestPage'
import WordFormPage from './pages/WordFormPage'

const NAV = [
  { to: '/', icon: '📖', title: 'Dictionary' },
  { to: '/graph', icon: '🕸️', title: 'Graph' },
  { to: '/achievements', icon: '🏆', title: 'Achievements' },
  { to: '/learn', icon: '🎓', title: 'Learn' },
  { to: '/test', icon: '📝', title: 'Test' },
  { to: '/word/new', icon: '➕', title: 'Add word' },
]

export default function App() {
  const location = useLocation()
  const usingApi = Boolean(import.meta.env.VITE_API_URL)
  const fullBleed = location.pathname === '/graph'

  return (
    <div className="app">
      <nav className="ribbon">
        <span className="ribbon-brand" title="Mon français">
          🇫🇷
        </span>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} title={item.title} end={item.to === '/'}>
            {item.icon}
          </NavLink>
        ))}
        <span className="ribbon-spacer" />
        <span className="ribbon-mode" title={usingApi ? 'Words stored in AWS' : 'Words stored in this browser'}>
          {usingApi ? 'AWS' : 'LOCAL'}
        </span>
      </nav>
      <main className={fullBleed ? 'main full-bleed' : 'main'}>
        <Routes>
          <Route path="/" element={<DictionaryPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/achievements" element={<AchievementsPage />} />
          <Route path="/learn" element={<LearnPage />} />
          <Route path="/test" element={<TestPage />} />
          <Route path="/word/new" element={<WordFormPage />} />
          <Route path="/word/:id/edit" element={<WordFormPage />} />
        </Routes>
      </main>
    </div>
  )
}
