let accessToken: string | null = null;
let onExpired: (() => void) | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setOnAuthExpired(handler: (() => void) | null) {
  onExpired = handler;
}

export function notifyAuthExpired() {
  onExpired?.();
}
