import { expect, test } from '@playwright/test'

test('unsigned home does not keep leagues on the device', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Connect a draft to sit next to.' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Sign in to pin leagues')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your leagues' })).toHaveCount(0)

  await page.evaluate(() => {
    window.localStorage.setItem('draft-assistant:saved-leagues', JSON.stringify([{
      provider: 'sleeper', leagueId: 'L1', season: '2026', name: 'The Money League', draftId: 'D1',
      externalUserId: 'u1', teamName: 'My Team', scoringType: 'ppr', teamCount: 12, lastOpenedAt: 1,
    }]))
  })
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Connect a draft to sit next to.' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('The Money League')).toHaveCount(0)
})
