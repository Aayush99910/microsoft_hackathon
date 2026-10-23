import { useEffect, useState } from 'react'

type Health = { status: string; model: string | null }

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError('Backend not reachable'))
  }, [])

  return (
    <main>
      <h1>Match Brain</h1>
      <p>Explainable match intelligence from synthetic football events.</p>
      <p className="status">
        {error ?? (health ? `Backend: ${health.status} · model: ${health.model}` : 'Checking backend…')}
      </p>
    </main>
  )
}

export default App
