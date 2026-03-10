/**
 * PM2 Ecosystem Config — Agent Arcade
 *
 * Zero-downtime deployment. All services auto-restart on crash.
 * Only stops when YOU stop it: pm2 stop all
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 status
 *   pm2 logs
 *   pm2 stop all
 *   pm2 restart all
 */
module.exports = {
  apps: [
    {
      name: 'arcade-gateway',
      cwd: './packages/gateway',
      script: 'src/index.ts',
      interpreter: 'bun',
      env: {
        PORT: 8787,
        ALLOWED_ORIGINS: '*',
        RATE_MAX: 60,
        RATE_WINDOW_MS: 1000,
        MAX_EVENTS: 200,
        NODE_ENV: 'production',
      },
      // Auto-restart on crash with exponential backoff
      autorestart: true,
      max_restarts: 100,
      min_uptime: '5s',
      restart_delay: 1000,
      exp_backoff_restart_delay: 500,
      // Never stop for memory — we manage it server-side
      max_memory_restart: '512M',
      // Logging
      error_file: './logs/gateway-error.log',
      out_file: './logs/gateway-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 10000,
      // Health
      watch: false,
    },
    {
      name: 'arcade-web',
      cwd: './packages/web',
      script: 'node_modules/.bin/next',
      args: 'start',
      env: {
        PORT: 3000,
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 100,
      min_uptime: '5s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '1G',
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      kill_timeout: 10000,
      listen_timeout: 15000,
      watch: false,
    },
    {
      name: 'arcade-watcher',
      script: 'examples/copilot-live.ts',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      env: {
        GATEWAY_URL: 'http://localhost:8787',
      },
      autorestart: true,
      max_restarts: 100,
      min_uptime: '5s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 1000,
      error_file: './logs/watcher-error.log',
      out_file: './logs/watcher-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      kill_timeout: 5000,
      // Start after gateway is up
      wait_ready: false,
      watch: false,
    },
  ],
}
