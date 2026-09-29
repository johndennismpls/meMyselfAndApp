import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import './HomePage.css'

interface Greeting {
  message: string
}

interface AppSummary {
  name: string
  displayName: string | null
}

/**
 * Tile registry name -> its route. An app missing from here has no route yet and
 * renders as a disabled tile rather than a dead link. Typed, so a path that is
 * not in the route tree fails the build instead of 404ing at runtime.
 */
const ROUTED_APPS: Record<string, '/wordsearch' | '/recipes'> = {
  wordsearch: '/wordsearch',
  recipebox: '/recipes',
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

export default function HomePage() {
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
          {apps.data?.map((app) => {
            const label = app.displayName ?? app.name
            const thumbnail = <img src={`/thumbnails/${app.name}.png`} alt="" />
            const route = ROUTED_APPS[app.name]
            return (
              <li key={app.name}>
                {route ? (
                  <Link to={route} className="tile">
                    {thumbnail}
                    <span>{label}</span>
                  </Link>
                ) : (
                  <span className="tile tile-disabled" aria-disabled="true" title="Coming soon">
                    {thumbnail}
                    <span>{label}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
