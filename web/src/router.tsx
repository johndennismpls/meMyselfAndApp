import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import HomePage from './HomePage'
import RecipeListPage from './apps/recipebox/RecipeListPage'
import RecipePage from './apps/recipebox/RecipePage'
import SettingsPage from './apps/recipebox/SettingsPage'
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

const recipeListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recipes',
  component: RecipeListPage,
})

// Static, so it outranks /recipes/$id however the two are ordered here.
const recipeSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recipes/settings',
  component: SettingsPage,
})

// The identifier is the serial id — /recipes/42. No slug, so no slug-vs-title
// drift when a recipe is renamed.
const recipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recipes/$id',
  component: RecipePage,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  wordSearchRoute,
  recipeListRoute,
  recipeSettingsRoute,
  recipeRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
