import * as SecureStore from "expo-secure-store";

const REFRESH_TOKEN_KEY = "familyFinance.refreshToken";

let accessToken: string | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export async function getStoredRefreshToken(): Promise<string | null> {
  let token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  if (!token) {
    token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (token) {
      await setStoredRefreshToken(token);
    }
  }
  return token;
}

export async function setStoredRefreshToken(token: string | null): Promise<void> {
  if (token) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  } else {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    }).catch(() => undefined);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => undefined);
  }
}
