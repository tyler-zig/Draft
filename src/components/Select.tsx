import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ChangeEventHandler,
  type CSSProperties,
  type KeyboardEvent,
  type OptionHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import './select.css'

type SelectOption = {
  value: string
  label: string
  disabled: boolean
}

type SelectProps = {
  value: string | number
  onChange?: ChangeEventHandler<HTMLSelectElement>
  disabled?: boolean
  className?: string
  id?: string
  name?: string
  children?: ReactNode
  'aria-label'?: string
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

function optionsFrom(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== 'option') return
    const props = child.props as OptionHTMLAttributes<HTMLOptionElement>
    const label = textOf(props.children)
    const value = props.value == null ? label : String(props.value)
    options.push({
      value,
      label: label || value,
      disabled: Boolean(props.disabled),
    })
  })
  return options
}

function fireChange(onChange: ChangeEventHandler<HTMLSelectElement> | undefined, value: string) {
  onChange?.({
    target: { value },
    currentTarget: { value },
  } as ChangeEvent<HTMLSelectElement>)
}

function menuStyle(anchor: HTMLElement): CSSProperties {
  const rect = (anchor.closest('label') ?? anchor).getBoundingClientRect()
  const viewportPad = 8
  const width = Math.min(Math.max(rect.width, 148), window.innerWidth - viewportPad * 2)
  const left = Math.min(Math.max(viewportPad, rect.left), window.innerWidth - width - viewportPad)
  const spaceBelow = window.innerHeight - rect.bottom - viewportPad
  return {
    left,
    width,
    maxHeight: Math.min(280, Math.max(72, spaceBelow)),
    top: rect.bottom + 4,
  }
}

function scrollOptionIntoMenu(menu: HTMLElement, option: HTMLElement) {
  const top = option.offsetTop
  const bottom = top + option.offsetHeight
  if (top < menu.scrollTop) menu.scrollTop = top
  else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight
}

export function Select({
  value,
  onChange,
  disabled = false,
  className = '',
  id,
  name,
  children,
  'aria-label': ariaLabel,
}: SelectProps) {
  const options = useMemo(() => optionsFrom(children), [children])
  const current = String(value)
  const selected = options.find((option) => option.value === current) ?? options[0]
  const listId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(current)
  const [style, setStyle] = useState<CSSProperties>({})

  function close() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function pick(next: string) {
    if (next !== current) fireChange(onChange, next)
    close()
  }

  function moveActive(delta: number) {
    const enabled = options.filter((option) => !option.disabled)
    if (!enabled.length) return
    const from = Math.max(0, enabled.findIndex((option) => option.value === active))
    const next = enabled[(from + delta + enabled.length) % enabled.length]
    setActive(next.value)
  }

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    setStyle(menuStyle(buttonRef.current))
    setActive(current)
    const onResize = () => {
      if (buttonRef.current) setStyle(menuStyle(buttonRef.current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [current, open, options])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    const timer = window.setTimeout(() => document.addEventListener('pointerdown', onPointerDown), 0)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open || !menuRef.current) return
    const option = menuRef.current.querySelector<HTMLElement>('[data-active="true"]')
    if (option) scrollOptionIntoMenu(menuRef.current, option)
  }, [active, open])

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) {
        if (buttonRef.current) setStyle(menuStyle(buttonRef.current))
        setOpen(true)
        setActive(current)
        return
      }
      if (event.key === 'ArrowDown') moveActive(1)
      else if (event.key === 'ArrowUp') moveActive(-1)
      else pick(active)
    }
  }

  const buttonClass = className ? `app-select ${className}` : 'app-select'
  const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
    type: 'button',
    id,
    name,
    disabled,
    className: buttonClass,
    'aria-label': ariaLabel,
    'aria-haspopup': 'listbox',
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-activedescendant': open ? `${listId}-${active}` : undefined,
  }

  return (
    <div className="app-select-host">
      <button
        {...buttonProps}
        ref={buttonRef}
        role="combobox"
        value={current}
        onClick={() => {
          if (disabled) return
          if (open) {
            setOpen(false)
            return
          }
          if (buttonRef.current) setStyle(menuStyle(buttonRef.current))
          setOpen(true)
        }}
        onKeyDown={onButtonKeyDown}
      >
        <span className="app-select-value">{selected?.label ?? ''}</span>
        <span className="app-select-chevron" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.4 4.4 6 8l3.6-3.6" />
          </svg>
        </span>
      </button>
      {open
        ? createPortal(
          <ul
            ref={menuRef}
            id={listId}
            role="listbox"
            className="app-select-menu"
            style={style}
            aria-label={ariaLabel}
          >
            {options.map((option) => (
              <li key={option.value || option.label} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${option.value}`}
                  className="app-select-option"
                  disabled={option.disabled}
                  aria-selected={option.value === current}
                  data-active={option.value === active}
                  onMouseEnter={() => { if (!option.disabled) setActive(option.value) }}
                  onClick={() => pick(option.value)}
                >
                  <span>{option.label}</span>
                  {option.value === current ? <span className="app-select-check" aria-hidden="true">✓</span> : null}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
        : null}
    </div>
  )
}
