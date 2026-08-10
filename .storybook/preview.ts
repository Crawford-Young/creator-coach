import { createElement } from 'react'
import type { Decorator, Preview } from '@storybook/nextjs-vite'
import '../src/app/globals.css'

const withDarkTheme: Decorator = (Story) => {
  // Dark-first workspace default (repo CLAUDE.md) — every story renders dark
  // unless a future story opts out explicitly.
  document.documentElement.classList.add('dark')
  return createElement(Story)
}

const preview: Preview = {
  decorators: [withDarkTheme],
}

export default preview
