import { expect, test } from '@playwright/test'

test('every fixed Draft Room control responds or is explicitly gated', async ({ page }) => {
  await page.goto('/draft/demo/local?userId=you')
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible({ timeout: 60_000 })

  await page.getByRole('button', { name: 'Menu' }).click()
  const nav = page.getByRole('navigation', { name: 'Draft Room navigation' })
  await expect(nav.getByRole('link', { name: 'Leagues' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Players' })).toBeVisible()
  await nav.getByRole('button', { name: 'Rankings' }).click()
  await expect(page.getByRole('dialog', { name: 'Rankings' })).toBeVisible()
  await page.getByRole('button', { name: 'Close rankings' }).click()

  const previousTheme = await page.locator('html').getAttribute('data-theme')
  await page.getByRole('button', { name: /Use .* theme/ }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', previousTheme ?? 'dark')

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Close Settings' }).click()

  await expect(page.getByRole('combobox', { name: 'View team roster' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Roster summary' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Positions' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Filter board to RB' }).click()
  await expect(page.getByLabelText('Position filter')).toHaveValue('RB')
  await page.getByRole('tab', { name: 'Byes' }).click()
  await expect(page.getByRole('tab', { name: 'Byes' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Positions' })).toHaveAttribute('aria-selected', 'false')

  await page.getByRole('button', { name: /Manage Queue/ }).click()
  await expect(page.getByRole('dialog', { name: 'Manage draft queue' })).toBeVisible()
  await page.getByRole('button', { name: 'Close Manage draft queue' }).click()

  await page.getByRole('button', { name: 'View full board' }).click()
  const fullBoard = page.getByRole('dialog', { name: 'Full draft board' })
  await expect(fullBoard).toBeVisible()
  await expect(fullBoard.getByText('Your team', { exact: true }).first()).toBeVisible()
  await expect(fullBoard.getByText('On the clock', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Close Full draft board' }).click()

  await page.getByRole('button', { name: 'Sort and filter' }).click()
  await expect(page.getByText('Sort & filter', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Customize' }).click()
  await expect(page.getByText('Visible columns', { exact: true })).toBeVisible()

  await expect(page.getByText('Demo · Demo controls')).toBeVisible()
  const disabledDraft = page.getByRole('button', { name: 'Waiting for your pick' })
  if (await disabledDraft.count()) await expect(disabledDraft).toHaveAttribute('title', /Wait until you are on the clock/)
})

test('FantasyPros experts can replace consensus and report sync coverage', async ({ page }) => {
  await page.goto('/draft/demo/local?userId=you')
  await expect(page.getByRole('button', { name: 'Rankings' })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Rankings' }).click()
  const drawer = page.getByRole('dialog', { name: 'Rankings' })
  await expect(drawer.getByText('Detected from your league')).toBeVisible()
  await drawer.getByRole('button', { name: 'Individual experts' }).click()
  await expect(drawer.getByText(/experts publish PPR/)).toBeVisible()
  await expect(drawer.getByText(/Oldest board synced/)).toBeVisible()

  const firstExpert = drawer.locator('.cc-expert-list > label').first()
  await expect(firstExpert).toBeVisible()
  await firstExpert.click()
  await expect(drawer.getByText('1 selected', { exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: 'Use 1 selected expert' }).click()
  await expect(drawer.getByText('1 expert board enabled.')).toBeVisible({ timeout: 30_000 })

  await drawer.getByRole('button', { name: 'Consensus', exact: true }).click()
  const consensus = drawer.getByRole('button', { name: 'Use consensus' })
  await expect(consensus).toBeEnabled()
  await consensus.click()
  await expect(drawer.getByText('PPR FantasyPros consensus enabled.')).toBeVisible({ timeout: 30_000 })
})

test('player modal exposes sourced profile, ranking provenance, and stored history', async ({ page }) => {
  await page.route('**/apis/common/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }))
  await page.goto('/draft/demo/local?userId=you')
  const firstRow = page.locator('.cc-player-table tbody tr').first()
  await expect(firstRow).toBeVisible({ timeout: 60_000 })
  const name = (await firstRow.locator('.cc-player-name').textContent())?.trim() ?? ''
  const position = (await firstRow.locator('.cc-pos').textContent())?.trim() ?? ''
  // Ranking artifacts are served from Postgres first when Supabase is
  // configured, which bypasses any URL-based stub. Force the fallback so this
  // test controls the data rather than asserting against whatever is hosted.
  await page.route('**/rest/v1/ranking_snapshots*', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  await page.route('**/rankings/history.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, generatedAt: 3, series: 'Collected ranking median', players: [{ name, position, team: null, points: [{ at: 1, rank: 9, adp: 10, low: 5, high: 13, sourceCount: 3 }, { at: 2, rank: 8, adp: 9, low: 4, high: 12, sourceCount: 4 }] }] }) }))
  await firstRow.click()
  const dialog = page.getByRole('dialog', { name: new RegExp(`${name} details`) })
  await expect(dialog.getByText('Profile source: Sleeper')).toBeVisible()
  await expect(dialog.getByText(/Sleeper rank/)).toBeVisible()
  await expect(dialog.getByRole('img', { name: /ADP history/ })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Production' })).toBeVisible()
  await expect(dialog.getByText(/Data: nflverse/).last()).toBeVisible()
})

test('mock draft settings run a small mock to the grades report and restore defaults', async ({ page }) => {
  await page.goto('/draft/demo/local?userId=you')
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('heading', { name: 'Mock draft' })).toBeVisible()
  await settings.getByRole('combobox', { name: 'Teams' }).click()
  await page.getByRole('option', { name: '4 teams' }).click()
  await settings.getByRole('combobox', { name: 'Rounds' }).click()
  await page.getByRole('option', { name: '2 rounds' }).click()
  await settings.getByRole('combobox', { name: 'Your slot' }).click()
  await page.getByRole('option', { name: 'Slot 1' }).click()
  await settings.getByRole('button', { name: 'Start new mock' }).click()

  // 4 teams x 2 rounds, auto-drafted: the room simulates to the end and the
  // grades sheet opens itself as the mock report.
  const grades = page.getByRole('dialog', { name: 'Draft grades' })
  await expect(grades).toBeVisible({ timeout: 90_000 })
  await expect(grades.locator('.cc-grades-table tbody tr')).toHaveCount(4)
  await page.getByRole('button', { name: 'Close Draft grades' }).click()

  // The demo engine is a module singleton shared by every page in this worker,
  // so put the standard 12/15/slot-5 room back for the tests that follow.
  await settings.getByRole('combobox', { name: 'Teams' }).click()
  await page.getByRole('option', { name: '12 teams' }).click()
  await settings.getByRole('combobox', { name: 'Rounds' }).click()
  await page.getByRole('option', { name: '15 rounds' }).click()
  await settings.getByRole('combobox', { name: 'Your slot' }).click()
  await page.getByRole('option', { name: 'Slot 5' }).click()
  await settings.getByRole('button', { name: 'Start new mock' }).click()
  await page.getByRole('button', { name: 'Close Settings' }).click()
})
