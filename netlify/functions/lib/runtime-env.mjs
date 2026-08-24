export function runtimeEnv(context = {}) {
  const cloudflareEnv = context?.cloudflareEnv;
  if (cloudflareEnv && typeof cloudflareEnv === 'object') return cloudflareEnv;
  if (typeof process !== 'undefined' && process?.env && typeof process.env === 'object') return process.env;
  return {};
}

export function runtimePlatform(context = {}) {
  return context?.cloudflareEnv ? 'cloudflare-worker' : 'netlify-node';
}
