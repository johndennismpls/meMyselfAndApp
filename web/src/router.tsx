import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import HomePage from './HomePage'
import WordSearchPage from './apps/wordsearch/WordSearchPage'
import { validateWordSearchSearch } from './apps/wordsearch/search'

const rootRoute = createRootRoute({ component: Outlet })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const wordSearchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wordsearch',
  component: WordSearchPage,
  // Anything malformed falls back to its default rather than erroring the route.
  validateSearch: validateWordSearchSearch,
})

const routeTree = rootRoute.addChildren([homeRoute, wordSearchRoute])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
