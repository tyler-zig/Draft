import { expect, test } from '@playwright/test'

test('a keeper set by hand leaves the pool and takes its team’s pick', async ({ page }) => {
  await page.goto('/draft/demo/local?userId=you')
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible({ timeout: 60_000 })

  // The top of the board is the first name in the table, so it is both the
  // clearest keeper to pick and the easiest to prove has left the pool.
  const topPlayer = page.locator('.cc-player-name').first()
  const name = ((await topPlayer.textContent()) ?? '').trim()
  expect(name.length).toBeGreaterThan(2)

  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('navigation', { name: 'Draft Room navigation' }).getByRole('button', { name: 'Keepers' }).click()
  const dialog = page.getByRole('dialog', { name: 'Keepers' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('combobox', { name: 'Keeper round' }).count()
  await dialog.getByRole('textbox', { name: 'Search players to keep' }).fill(name.slice(0, 8))
  await dialog.getByRole('button').filter({ hasText: name }).first().click()

  const round = dialog.getByRole('combobox', { name: `Keeper round for ${name}` })
  await expect(round).toBeVisible()
  await round.click()
  await page.getByRole('option').nth(1).click()

  await page.getByRole('button', { name: 'Close Keepers' }).click()

  // Gone from the available pool, and shown as kept when the filter is off.
  await expect(page.locator('.cc-player-name').filter({ hasText: name })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Available Only' }).uncheck()
  const keptRow = page.locator('.cc-player', { hasText: name }).first()
  await expect(keptRow).toContainText('Kept')

  // And the pick it consumed is marked on the board.
  await expect(page.locator('.cc-pick.cc-keeper-pick').first()).toBeVisible()

  // The entry survives a reload -- keepers are league facts, not tab state.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.cc-pick.cc-keeper-pick').first()).toBeVisible()
})
