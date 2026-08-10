import type { StorybookConfig } from '@storybook/nextjs-vite'

const config: StorybookConfig = {
  framework: '@storybook/nextjs-vite',
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
}

export default config
