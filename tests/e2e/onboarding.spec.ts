import { test, expect, type BrowserContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seedSession, seedCreator, seedPersona, findPersonaProfile, wipe } from './helpers/seed'

const SESSION_COOKIE_NAME = 'authjs.session-token'
const BASE_URL = 'http://localhost:3000'
const WIZARD_TIMEOUT_MS = 90_000
// Deviation (in-scope, see task report): default 30s test timeout is too tight for a
// FIRST navigation to /onboarding — that route's module graph (mongodb driver,
// @auth/mongodb-adapter, twitch provider, UI form bundle) pays a one-time Next.js
// dev-mode compile cost on top of the page's own async auth()/getPersonaProfile()
// calls, observed exceeding 30s even for the plain anon-redirect case. Raised per-file
// rather than shrinking any test.
const FILE_TIMEOUT_MS = 60_000

async function authenticate(context: BrowserContext, sessionToken: string): Promise<void> {
  await context.addCookies([{ name: SESSION_COOKIE_NAME, value: sessionToken, url: BASE_URL }])
}

test.describe.configure({ mode: 'serial', timeout: FILE_TIMEOUT_MS })

test.beforeEach(async () => {
  await wipe()
})

test('anon landing page renders without crashing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Creator Coach' })).toBeVisible()
})

test('anon visiting /onboarding is redirected to /', async ({ page }) => {
  await page.goto('/onboarding')
  await expect(page).toHaveURL(`${BASE_URL}/`)
})

test('seeded session with creator but no persona redirects / to /onboarding', async ({
  page,
  context,
}) => {
  const { sessionToken, userId } = await seedSession()
  await seedCreator(userId)
  await authenticate(context, sessionToken)

  await page.goto('/')
  await expect(page).toHaveURL(`${BASE_URL}/onboarding`)
})

test('seeded session with an existing persona redirects /onboarding to /', async ({
  page,
  context,
}) => {
  const { sessionToken, userId } = await seedSession()
  const creatorId = await seedCreator(userId)
  await seedPersona(creatorId)
  await authenticate(context, sessionToken)

  await page.goto('/onboarding')
  await expect(page).toHaveURL(`${BASE_URL}/`)
})

test('full wizard walk persists a persona profile and re-gates onboarding', async ({
  page,
  context,
}) => {
  test.setTimeout(WIZARD_TIMEOUT_MS)
  const { sessionToken, userId } = await seedSession()
  const creatorId = await seedCreator(userId)
  await authenticate(context, sessionToken)

  await page.goto('/onboarding')

  // Step 1: Identity
  await page.getByLabel('Main draw').fill('community heart')
  await page.getByLabel('Archetype').fill('community-heart')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 2: Content pillars
  await page.getByLabel('Anchor name').fill('CS2')
  await page.getByLabel('Anchor mode').fill('ranked + squad nights')
  await page.getByLabel('Rotation').fill('Valorant')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 3: Voice
  await page.getByLabel('Tone words').fill('calm')
  await page.getByLabel('Sample lines').fill('gg')
  await page.getByLabel('Dos').fill('uplift')
  await page.getByLabel("Don'ts").fill('rage')
  await page.getByLabel('Wildcard dial').fill('6')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 4: Philosophy
  await page.getByLabel('Values').fill('care')
  await page.getByLabel('Statement').fill('people first')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 5: Audience
  await page.getByLabel('Description').fill('the campfire')
  await page.getByLabel('Serves who').fill('regulars')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 6: Constraints
  await page.getByLabel('Timezone').fill('Europe/London')
  await page.getByLabel('Weekly schedule').fill('eves')
  await page.getByLabel('Collab availability').fill('weekends')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 7: Sustainability
  await page.getByLabel('Energy patterns').fill('morning low')
  await page.getByLabel('Burnout triggers').fill('over-streaming')
  await page.getByLabel('Rest needs').fill('1 day/wk')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 8: Platforms
  await page.getByLabel('Platform type').fill('twitch')
  await page.getByLabel('Handle').fill('x')
  await page.getByLabel('Clip targets').fill('tiktok')
  await page.getByRole('button', { name: 'Submit' }).click()

  await expect(page).toHaveURL(`${BASE_URL}/`)

  const savedProfile = await findPersonaProfile(creatorId)
  expect(savedProfile).not.toBeNull()
  expect(savedProfile?.creatorId).toBe(creatorId)

  await page.goto('/onboarding')
  await expect(page).toHaveURL(`${BASE_URL}/`)
})

test('axe: anon landing page has zero violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('axe: authed onboarding wizard has zero violations', async ({ page, context }) => {
  const { sessionToken, userId } = await seedSession()
  await seedCreator(userId)
  await authenticate(context, sessionToken)

  await page.goto('/onboarding')
  await expect(page.getByLabel('Main draw')).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})
