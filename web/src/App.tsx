import { useQuery } from '@tanstack/react-query'
import './App.css'

interface Greeting {
  message: string
}

interface AppSummary {
  name: string
  displayName: string | null
}

async function fetchGreeting(): Promise<Greeting> {
  const res = await fetch('/api')
  if (!res.ok) throw new Error(`API responded ${res.status}`)
  return res.json() as Promise<Greeting>
}

async function fetchApps(): Promise<AppSummary[]> {
  const res = await fetch('/api/apps')
  if (!res.ok) throw new Error(`API responded ${res.status}`)
  return res.json() as Promise<AppSummary[]>
}

function App() {
  const greeting = useQuery({ queryKey: ['greeting'], queryFn: fetchGreeting })
  const apps = useQuery({ queryKey: ['apps'], queryFn: fetchApps })

  return (
    <section id="center">
      <div>
        {greeting.isPending ? (
          <h1>Loading…</h1>
        ) : greeting.isError ? (
          <>
            <h1>API unreachable</h1>
            <p>{greeting.error.message}</p>
          </>
        ) : (
          <>
            <h1>{greeting.data.message}</h1>
            <p>
              Served by the API at <code>localhost:3000</code>
            </p>
          </>
        )}
      </div>

      {apps.isError ? (
        <p className="tile-note">Could not load apps: {apps.error.message}</p>
      ) : (
        <ul className="tiles">
          {apps.data?.map((app) => (
            <li key={app.name}>
              <button type="button" className="tile">
                <img src={`/thumbnails/${app.name}.png`} alt="" />
                <span>{app.displayName ?? app.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default App
