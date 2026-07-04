import React, { useRef, useEffect } from 'react'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export const OtpInput: React.FC<OtpInputProps> = ({ value, onChange, disabled }) => {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])
  
  // Parse digits array from value prop
  const digits = value.split('').concat(Array(6).fill('')).slice(0, 6)

  useEffect(() => {
    // Focus first input on mount
    inputsRef.current[0]?.focus()
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const val = e.target.value
    if (!/^\d*$/.test(val)) return // Digits only

    const newDigits = [...digits]
    // Take only the last character entered
    newDigits[index] = val.slice(-1)
    
    const newValue = newDigits.join('')
    onChange(newValue)

    // Move focus forward if we entered a digit
    if (val && index < 5) {
      inputsRef.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      const newDigits = [...digits]
      
      if (!digits[index] && index > 0) {
        // If current is empty, erase previous and focus it
        newDigits[index - 1] = ''
        const newValue = newDigits.join('')
        onChange(newValue)
        inputsRef.current[index - 1]?.focus()
      } else {
        // Just erase current
        newDigits[index] = ''
        const newValue = newDigits.join('')
        onChange(newValue)
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputsRef.current[index + 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text').trim()
    if (!/^\d+$/.test(pastedText)) return

    const pastedDigits = pastedText.slice(0, 6).split('')
    const newDigits = [...digits]
    
    pastedDigits.forEach((char, idx) => {
      if (idx < 6) {
        newDigits[idx] = char
      }
    })

    const newValue = newDigits.join('')
    onChange(newValue)

    // Focus last filled digit or final input
    const focusIdx = Math.min(pastedDigits.length, 5)
    inputsRef.current[focusIdx]?.focus()
  }

  return (
    <div className="flex gap-2 justify-center my-4">
      {Array.from({ length: 6 }).map((_, idx) => (
        <input
          key={idx}
          ref={(el) => (inputsRef.current[idx] = el)}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={digits[idx] || ''}
          onChange={(e) => handleChange(e, idx)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          onPaste={handlePaste}
          disabled={disabled}
          className="w-11 h-12 text-center text-md font-bold bg-neutral-900 border border-border/80 rounded-xs focus:border-primary focus:ring-1 focus:ring-primary/45 outline-none transition-all text-foreground"
          aria-label={`Digit ${idx + 1}`}
        />
      ))}
    </div>
  )
}
