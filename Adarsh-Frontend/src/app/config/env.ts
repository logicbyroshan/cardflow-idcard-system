/**
 * System Configuration Tokens
 */
export const ENV = {
  API_URL: import.meta.env.VITE_API_URL || '/api',
  WS_URL: import.meta.env.VITE_WS_URL || '/ws',
  NODE_ENV: import.meta.env.MODE || 'development',
  IS_DEV: import.meta.env.DEV,
  IS_PROD: import.meta.env.PROD,
  APP_NAME: "Adarsh ID Management System",
} as const

export type EnvConfig = typeof ENV
