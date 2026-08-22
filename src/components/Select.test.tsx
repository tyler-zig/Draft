import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Select } from './Select'

function SeasonSelect() {
  const [season, setSeason] = useState('2026')
  return (
    <Select aria-label="Season" value={season} onChange={(event) => setSeason(event.target.value)}>
      <option value="2026">2026</option>
      <option value="2025">2025</option>
      <option value="2024">2024</option>
    </Select>
  )
}

describe('Select', () => {
  it('opens a themed list and changes the value from an option click', async () => {
    const user = userEvent.setup()
    render(<SeasonSelect />)
    const control = screen.getByRole('combobox', { name: 'Season' })
    expect(control).toHaveValue('2026')
    await user.click(control)
    const list = screen.getByRole('listbox', { name: 'Season' })
    expect(list).toHaveClass('app-select-menu')
    await user.click(screen.getByRole('option', { name: '2025' }))
    expect(control).toHaveValue('2025')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
