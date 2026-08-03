import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OtpInput } from '../components/OtpInput'

describe('OtpInput Component', () => {
  it('should render 6 input boxes', () => {
    render(<OtpInput value="" onChange={() => {}} />)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(6)
  })

  it('should display characters passed in value prop', () => {
    render(<OtpInput value="123" onChange={() => {}} />)
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs[0].value).toBe('1')
    expect(inputs[1].value).toBe('2')
    expect(inputs[2].value).toBe('3')
    expect(inputs[3].value).toBe('')
  })

  it('should invoke onChange when a digit is entered', () => {
    const handleChange = vi.fn()
    render(<OtpInput value="" onChange={handleChange} />)
    
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: '5' } })
    
    expect(handleChange).toHaveBeenCalledWith('5')
  })

  it('should support clipboard pasting of digits', () => {
    const handleChange = vi.fn()
    render(<OtpInput value="" onChange={handleChange} />)
    
    const inputs = screen.getAllByRole('textbox')
    const pasteEvent = {
      clipboardData: {
        getData: () => '987654'
      },
      preventDefault: vi.fn()
    }
    
    fireEvent.paste(inputs[0], pasteEvent)
    expect(handleChange).toHaveBeenCalledWith('987654')
  })
})
